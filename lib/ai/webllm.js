/**
 * WebGPU 本地补全引擎（WebLLM）：模型在浏览器内推理，无需网络与 API Key。
 *
 * - 引擎按 modelId 单例：设置页「加载模型」与补全请求共用，切换模型自动卸载旧的
 * - 权重经 Cache API 持久化（首次下载后离线可用，二次加载秒级）
 * - raw completion + FIM 模板（复用 fimTemplates 的 prompt/stops），绕开 chat 模板
 * - 模型清单与 @mlc-ai/web-llm 0.2.87 的 prebuiltAppConfig 对齐
 *   （Qwen2.5-Coder Instruct；q4f16_1 为主，q4f32_1 供不支持 shader-f16 的设备兜底）
 * - 全链路日志（tag: ai/webllm）：WebGPU 预检、加载各阶段、补全耗时、停止/卸载
 */

import { buildFim } from './fimTemplates.js';
import { createLogger } from './logger.js';

const log = createLogger('ai/webllm');

// 预置可选模型（id 必须与 prebuiltAppConfig.model_list 一致）
export const WEBLLM_MODELS = [
  { id: 'Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5-Coder 0.5B（约 0.5GB，最快）' },
  { id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5-Coder 1.5B（约 1.1GB，推荐）' },
  { id: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5-Coder 3B（约 2.1GB）' },
  { id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC', label: 'Qwen2.5-Coder 7B（约 4.6GB，需大显存）' },
  { id: 'Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC', label: 'Qwen2.5-Coder 0.5B · f32 兼容版（约 0.6GB，设备不支持 f16 时选这个）' },
];

let engine = null;
let engineModelId = null;
let loadPromise = null;
let loadModelId = null; // 正在加载的目标模型（状态展示用）
let loadProgress = null; // {progress, text}
let stopRequested = false;
let version = 0;
const listeners = new Set();
let lastPreflight = null; // 最近一次 WebGPU 预检结果（缓存，避免重复探测）

function notify() {
  version += 1;
  for (const cb of listeners) {
    try { cb(); } catch {}
  }
}

/** 订阅引擎状态变化（加载开始/进度/就绪/停止），返回取消订阅函数。 */
export function subscribeWebllmStatus(cb) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * 当前引擎状态：
 *  {state:'ready', modelId} | {state:'loading', modelId, progress} | {state:'idle'}
 */
export function getWebllmStatus() {
  if (engine && engineModelId) return { state: 'ready', modelId: engineModelId };
  if (loadPromise) return { state: 'loading', modelId: loadModelId, progress: loadProgress };
  return { state: 'idle' };
}

/** 引擎是否已就绪（避免补全请求触发隐式加载时的重复状态展示）。 */
export function isWebllmReady(modelId) {
  return !!engine && engineModelId === modelId;
}

/** 最近一次 WebGPU 预检结果（null = 尚未检测）。 */
export function getWebllmPreflight() {
  return lastPreflight;
}

/* ---------------- 权重下载源（huggingface.co 在国内不可直连） ---------------- */

const HF_HOST = 'https://huggingface.co';
const HF_MIRROR_HOST = 'https://hf-mirror.com';
const MS_HOST = 'https://modelscope.cn';
let hfProbe = null; // { reachable, ms, at }（会话内缓存 5 分钟）

/**
 * 探测 huggingface.co 直连可达性（GET 小文件，4s 超时）。
 * 手机/国内网络通常不可达 → 自动改走魔搭 ModelScope。
 */
export async function probeHf(timeoutMs = 4000) {
  if (hfProbe && Date.now() - hfProbe.at < 5 * 60 * 1000) return hfProbe;
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('probe timeout')), timeoutMs);
  let reachable = false;
  try {
    const res = await fetch(`${HF_HOST}/Qwen/Qwen2.5-Coder-0.5B-Instruct/resolve/main/config.json`, {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
    });
    reachable = res.ok;
    try { await res.body?.cancel(); } catch {}
  } catch {
    reachable = false;
  }
  clearTimeout(timer);
  hfProbe = { reachable, ms: Math.round(performance.now() - t0), at: Date.now() };
  log.info('HF 直连探测', { 结果: reachable ? '可达' : '不可达（改用 hf-mirror.com）', 耗时ms: hfProbe.ms });
  return hfProbe;
}

/**
 * 探测 hf-mirror.com 是否直出内容。
 * hf-mirror 对海外出口 IP 会 308 回源 huggingface.co（且 308 无 CORS 头），
 * 浏览器 fetch 会瞬间 "Failed to fetch" —— 用 redirect:'manual' 拿到
 * opaqueredirect 即可提前识别并给出明确指引。
 * @returns true = 国内直出可用；false = 回源（海外出口），浏览器不可用
 */
async function probeHfMirror(timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('probe timeout')), timeoutMs);
  let bounced = false;
  try {
    const res = await fetch(`${HF_MIRROR_HOST}/mlc-ai/Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json`, {
      signal: ctrl.signal, redirect: 'manual', cache: 'no-store',
    });
    bounced = res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
    try { await res.body?.cancel(); } catch {}
  } catch {
    bounced = false; // 网络错误不在此判定，交给引擎创建阶段的报错与看门狗
  }
  clearTimeout(timer);
  log.info('hf-mirror 探测', bounced
    ? { 结果: '回源重定向（当前出口为海外）—— 浏览器无法跟随，建议改用 ModelScope 或自动探测' }
    : { 结果: '直出（可用）' });
  return !bounced;
}

/**
 * 解析下载源模式 → 实际使用的源。
 * @param mode 'auto'（探测）| 'direct' | 'modelscope' | 'hfmirror'
 * @returns 'direct' | 'modelscope' | 'hfmirror'
 */
async function resolveSource(mode) {
  if (mode === 'direct') return 'direct';
  if (mode === 'modelscope') return 'modelscope';
  if (mode === 'hfmirror') {
    const ok = await probeHfMirror();
    if (!ok) {
      throw new Error('hf-mirror.com 当前会把请求回源 huggingface.co（你的网络出口为海外），浏览器无法使用 —— 请把「权重下载源」改为「魔搭 ModelScope」或「自动探测」');
    }
    return 'hfmirror';
  }
  // auto：直连可达 → 直连；不可达 → 魔搭 ModelScope
  // （国内 CDN，5 个 Qwen2.5-Coder-MLC 仓库全镜像、/resolve/main/ 路径兼容、CORS 全开、大文件直出）
  const probe = await probeHf();
  return probe.reachable ? 'direct' : 'modelscope';
}

/** 克隆 prebuiltAppConfig 并按下载源改写权重 URL（仅 `model` 字段；
 *  wasm 库在 raw.githubusercontent.com，与编译器运行时同源，国内外都可达，不需要动）。
 *  web-llm 0.2.x 的字段名是 `model`（旧版叫 modelURL），两种都兜住。 */
function buildSourceAppConfig(webllm, source) {
  const cfg = JSON.parse(JSON.stringify(webllm.prebuiltAppConfig));
  let n = 0;
  for (const m of cfg.model_list ?? []) {
    for (const key of ['model', 'modelURL']) {
      if (typeof m[key] !== 'string') continue;
      if (source === 'modelscope' && m[key].startsWith(HF_HOST + '/mlc-ai/')) {
        m[key] = MS_HOST + '/models/' + m[key].slice((HF_HOST + '/').length);
        n += 1;
      } else if (source === 'hfmirror' && m[key].startsWith(HF_HOST)) {
        m[key] = HF_MIRROR_HOST + m[key].slice(HF_HOST.length);
        n += 1;
      }
    }
  }
  log.debug('下载源 appConfig 构建完成', { 源: source, 改写条目数: n, 模型总数: cfg.model_list?.length ?? 0 });
  return cfg;
}

/**
 * WebGPU 环境预检：逐项探测并写日志——手机端加载失败时，这里给出确切原因。
 * @returns {{ok:boolean, reason?:string, adapterInfo?:object, f16?:boolean}}
 */
export async function webllmPreflight() {
  const t0 = performance.now();
  const fail = (reason) => {
    lastPreflight = { ok: false, reason, at: Date.now() };
    log.error('WebGPU 预检未通过', { reason, 耗时ms: Math.round(performance.now() - t0) });
    return lastPreflight;
  };
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return fail('此浏览器没有 WebGPU（navigator.gpu 不存在）。需 Chrome/Edge 113+、Android Chrome 121+（部分国产浏览器/微信内置浏览器不支持）、Safari 26+；旧版 iOS 一律不可用');
  }
  log.debug('navigator.gpu 存在，请求适配器…');
  let adapter;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch (exn) {
    return fail(`requestAdapter() 抛异常：${exn?.message ?? exn}`);
  }
  if (!adapter) {
    return fail('requestAdapter() 返回 null：GPU 适配器不可用（浏览器设置禁用了 GPU / 远程调试模式 / 驱动过旧 / 系统低电量模式拦截）');
  }
  const f16 = typeof adapter.features?.has === 'function' ? adapter.features.has('shader-f16') : false;
  const info = (() => {
    try { return adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null; } catch { return null; }
  })();
  const limits = (() => {
    try {
      const l = adapter.limits ?? {};
      return { maxBufferMB: Math.round((l.maxBufferSize ?? 0) / 1024 / 1024), maxStorageBufferMB: Math.round((l.maxStorageBufferBindingSize ?? 0) / 1024 / 1024) };
    } catch { return null; }
  })();
  lastPreflight = { ok: true, f16, adapterInfo: info, at: Date.now() };
  log.info('WebGPU 预检通过', { 耗时ms: Math.round(performance.now() - t0), shaderF16: f16, adapter: info, limits, 备注: f16 ? undefined : '不支持 shader-f16 —— q4f16 模型无法运行，请选 f32 兼容版' });
  if (!f16) log.warn('设备缺少 shader-f16 特性：q4f16_1 模型会加载失败，请改用 q4f32_1 兼容版');
  return lastPreflight;
}

/**
 * 获取（必要时创建）modelId 对应的引擎。
 * 加载期间被 stopWebllmEngine() 叫停时返回 null（WebLLM 无法真正取消创建，
 * 以「完成后立即卸载」兑现停止语义）。
 * @param onProgress (report: {progress, text}) => void，仅首次创建时回调
 * @param opts.downloadSource 'auto' | 'direct' | 'modelscope' | 'hfmirror'（权重下载源）
 */
export async function getWebllmEngine(modelId, onProgress, opts = {}) {
  if (engine && engineModelId === modelId) return engine;
  if (loadPromise) await loadPromise.catch(() => {}); // 串行化并发加载
  if (stopRequested) return null;
  if (engine && engineModelId !== modelId) {
    log.info('切换模型，卸载旧引擎', { 旧模型: engineModelId });
    try { await engine.unload(); } catch (exn) { log.warn('卸载旧引擎报错（忽略）', exn); }
    engine = null;
    engineModelId = null;
  }

  // 创建前预检：环境不支持时快速失败并给出明确原因（替代 WebLLM 的笼统报错）
  const pre = lastPreflight?.ok ? lastPreflight : await webllmPreflight();
  if (!pre.ok) {
    log.error('取消加载：环境不支持 WebGPU', { modelId });
    throw new Error(pre.reason);
  }
  if (modelId.includes('q4f16') && pre.f16 === false) {
    const msg = '设备不支持 shader-f16，q4f16 模型无法运行 —— 请在模型下拉选择「f32 兼容版」';
    log.error('取消加载：量化格式与设备能力不匹配', { modelId, shaderF16: false });
    throw new Error(msg);
  }

  loadModelId = modelId;
  loadProgress = null;
  notify(); // → loading

  // 解析权重下载源（国内手机网络直连 huggingface.co 不可达是「卡在 0%」的头号原因）
  const source = await resolveSource(opts.downloadSource ?? 'auto');
  log.info('开始创建引擎', {
    modelId,
    shaderF16: pre.f16,
    下载源: source === 'direct' ? 'huggingface.co 直连' : source === 'modelscope' ? '魔搭 ModelScope（国内）' : 'hf-mirror.com（国内）',
    模式: opts.downloadSource ?? 'auto',
  });

  const t0 = performance.now();
  let lastPct = -1;
  let lastProgressAt = Date.now();
  let stalled30 = false;
  let stalled90 = false;
  // 停滞看门狗：下载挂起时给出明确指引（WebLLM 无法中断下载，只能换源重试）
  const stallTimer = setInterval(() => {
    const silent = Date.now() - lastProgressAt;
    if (silent > 30000 && !stalled30) {
      stalled30 = true;
      log.warn('加载进度停滞 30s —— 可能为网络不通（huggingface.co 被墙）。请在设置把「权重下载源」切到「魔搭 ModelScope」，点「⏹ 停止」后重新加载', { 停在: loadProgress?.text ?? '（无进度）' });
    }
    if (silent > 90000 && !stalled90) {
      stalled90 = true;
      log.error('加载进度停滞 90s —— 下载已挂起，本次无法中断（完成后可停止）。请把「权重下载源」切到「魔搭 ModelScope」后重试', { 停在: loadProgress?.text ?? '（无进度）' });
    }
  }, 5000);

  loadPromise = (async () => {
    const tImport = performance.now();
    const webllm = await import('@mlc-ai/web-llm');
    log.debug('web-llm 模块加载完成', { 耗时ms: Math.round(performance.now() - tImport) });
    engine = await webllm.CreateMLCEngine(modelId, {
      ...(source !== 'direct' ? { appConfig: buildSourceAppConfig(webllm, source) } : {}),
      initProgressCallback: (r) => {
        lastProgressAt = Date.now();
        loadProgress = { progress: r.progress, text: r.text };
        onProgress?.(r);
        // 每跨 10% 记一条里程碑（debug 流水在导出里也有，但里程碑保证一眼看到卡点）
        const pct = Math.floor((r.progress || 0) * 100 / 10) * 10;
        if (pct > lastPct) {
          lastPct = pct;
          log.info(`加载 ${pct}%`, { text: r.text });
        } else {
          log.debug('加载进度', { progress: r.progress, text: r.text });
        }
      },
    });
    engineModelId = modelId;
    log.info('引擎创建完成', { modelId, 总耗时ms: Math.round(performance.now() - t0) });
    if (stopRequested) {
      // 停止发生在加载中：创建不可取消，加载完成后立即卸载
      log.info('加载完成但用户已请求停止 → 立即卸载');
      try { await engine.unload(); } catch (exn) { log.warn('卸载报错（忽略）', exn); }
      engine = null;
      engineModelId = null;
    }
  })();
  try {
    await loadPromise;
  } catch (exn) {
    log.error('引擎创建失败', {
      modelId,
      已进行到: loadProgress?.text ?? '（无进度回调）',
      提示: String(exn).includes('Failed to fetch')
        ? '网络请求被拒（被墙或 CORS）—— 请把「权重下载源」改为「魔搭 ModelScope」后重试'
        : undefined,
    });
    log.error('引擎创建失败（原始异常）', exn);
    engine = null;
    engineModelId = null;
    throw exn;
  } finally {
    clearInterval(stallTimer);
    loadPromise = null;
    loadModelId = null;
    loadProgress = null;
    notify(); // → ready / idle
  }
  return engine;
}

/**
 * 一键停止本地模型：中断正在进行的生成 + 卸载引擎（释放显存/内存）。
 * 加载中调用则等创建流程收尾后立即卸载。之后首次补全会按需自动重新加载。
 */
export async function stopWebllmEngine() {
  log.info('一键停止：中断生成并卸载引擎', { 当前: engineModelId ?? loadModelId ?? '（无）' });
  stopRequested = true;
  try { engine?.interruptGenerate?.(); } catch {}
  if (loadPromise) await loadPromise.catch(() => {});
  if (engine) {
    try { await engine.unload(); } catch (exn) { log.warn('卸载报错（忽略）', exn); }
    engine = null;
    engineModelId = null;
  }
  stopRequested = false;
  loadProgress = null;
  notify();
}

/** 本地 FIM 补全：返回 { text, usage }（usage 为真实 token 数，供统计入账）。 */
export async function requestWebllmCompletion(ai, { prefix, suffix, signal, onProgress }) {
  const { prompt, stops } = buildFim(ai, prefix, suffix);
  const eng = await getWebllmEngine(ai.model, onProgress, { downloadSource: ai.downloadSource ?? 'auto' });
  if (!eng) {
    log.warn('补全放弃：引擎在加载期间被停止', { modelId: ai.model });
    return { text: '', usage: null };
  }
  const onAbort = () => {
    log.info('补全被取消（新键入/Tab/Esc）→ interruptGenerate');
    try { eng.interruptGenerate(); } catch {}
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort);
  }
  const t0 = performance.now();
  log.debug('补全请求', { modelId: ai.model, prompt长度: prompt.length, prefix长度: prefix.length, suffix长度: suffix.length, maxTokens: Number(ai.maxTokens) || 256 });
  try {
    const res = await eng.completions.create({
      prompt,
      max_tokens: Number(ai.maxTokens) || 256,
      temperature: Number(ai.temperature) || 0.2,
      stop: [...new Set([...stops, '<|endoftext|>', '<|fim_pad|>'])],
      stream: false,
    });
    const usage = res.usage
      ? { prompt_tokens: Number(res.usage.prompt_tokens) || 0, completion_tokens: Number(res.usage.completion_tokens) || 0 }
      : null;
    log.info('补全完成', {
      耗时ms: Math.round(performance.now() - t0),
      输出长度: res.choices?.[0]?.text?.length ?? 0,
      finishReason: res.choices?.[0]?.finish_reason ?? null,
      usage,
    });
    return { text: res.choices?.[0]?.text ?? '', usage };
  } catch (exn) {
    log.error('补全失败', { 耗时ms: Math.round(performance.now() - t0) });
    log.error('补全失败（原始异常）', exn);
    throw exn;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
