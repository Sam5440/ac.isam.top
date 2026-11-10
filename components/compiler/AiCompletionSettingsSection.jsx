"use client";

/**
 * 「AI 代码补全」行为配置区块（内嵌于设置 →「AI 服务商」分区的子标签页）。
 * 移植自 ACM-IDE-online 的 SettingsModal（AI 部分）：多平台配置方案
 * （添加/切换/删除）+ 快速预设（API 类型预设）、API 类型、WebGPU 本地模型
 * （WebLLM：预检/下载源/加载/停止）、FIM 模板、触发方式，以及 AI Token 用量
 * 统计与诊断日志查看器。
 *
 * 连接信息（baseUrl/apiKey/model/思考深度/本站转发）自 m:2 起统一由
 * 「AI 服务商 → 功能模块挑选」承担，本分区只保留行为偏好；状态持久化在
 * lib/ai/ai-settings.js（ysc-ai-settings-v1），与编译器偏好、翻译设置互不干扰；
 * 编辑器侧经 CompilerDock 传入的 getAi 每次实时读取。
 */

import { useEffect, useState } from "react";
import {
  AI_PRESETS,
  fetchModelList,
} from "@/lib/ai/providers";
import { FIM_TEMPLATES } from "@/lib/ai/fimTemplates";
import {
  WEBLLM_MODELS,
  getWebllmEngine,
  getWebllmPreflight,
  getWebllmStatus,
  isWebllmReady,
  stopWebllmEngine,
  subscribeWebllmStatus,
  webllmPreflight,
} from "@/lib/ai/webllm";
import {
  getTokenStats,
  resetTokenStats,
  subscribeTokenStats,
  fmtTokens,
} from "@/lib/ai/tokenStats";
import {
  clearLogs,
  exportLogsText,
  getLogEntries,
  logTags,
  subscribeLogs,
} from "@/lib/ai/logger";
import {
  loadAiSettings,
  saveAiSettings,
  makeProfileId,
  PROFILE_FIELDS,
} from "@/lib/ai/ai-settings";
import { truncate } from "@/lib/compiler/diff";
import { toast } from "@/lib/toast";

const inputCls =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/60";
const btnCls =
  "rounded-md border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50";
const btnGhostCls =
  "rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground";

/** 新建平台方案的空白字段（连接字段已不在方案内，仅行为偏好）。 */
const BLANK_PROFILE = {
  apiType: "openai-chat",
  fimTemplate: "qwen25",
  customTemplate: "",
  temperature: 0.2,
  maxTokens: 256,
};

const pickProfile = (p) =>
  Object.fromEntries(
    // webllm 方案额外保留 model（本地模型 id）；其余类型连接字段由全局 assign 注入
    (p?.apiType === "webllm" ? [...PROFILE_FIELDS, "model"] : PROFILE_FIELDS).map((k) => [
      k,
      p[k] ?? BLANK_PROFILE[k] ?? "",
    ]),
  );

/** AI Token 用量统计表：按平台方案累计 + 合计 + 清零（估算部分以 ≈ 标注）。 */
function TokenStatsSection({ activeId }) {
  // 订阅统计变化保持实时（渲染时读快照）
  const [, setVer] = useState(0);
  useEffect(() => subscribeTokenStats(() => setVer((v) => v + 1)), []);
  const stats = getTokenStats();
  const rows = Object.entries(stats.profiles)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const total = rows.reduce(
    (acc, p) => ({
      prompt: acc.prompt + p.prompt,
      completion: acc.completion + p.completion,
      promptEst: acc.promptEst + p.promptEst,
      completionEst: acc.completionEst + p.completionEst,
      requests: acc.requests + p.requests,
      errors: acc.errors + p.errors,
    }),
    { prompt: 0, completion: 0, promptEst: 0, completionEst: 0, requests: 0, errors: 0 },
  );
  const totalTok = total.prompt + total.completion + total.promptEst + total.completionEst;

  const doReset = (id) => {
    const label = id
      ? rows.find((r) => r.id === id)?.name || "该方案"
      : "全部方案的 Token 统计";
    if (!window.confirm(`确定清零${label}？此操作不可撤销。`)) return;
    resetTokenStats(id);
  };

  const num = (n, est) => (
    <span title={est ? `其中 ${est} tokens 来自本地估算（响应未上报 usage）` : undefined}>
      {est ? "≈" : ""}
      {fmtTokens((n || 0) + (est || 0))}
    </span>
  );

  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <p className="text-xs font-medium">AI Token 用量统计</p>
      {rows.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          尚无用量记录 —— 配置并使用 AI 补全后，这里会按平台方案累计消耗。
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">方案</th>
                  <th className="py-1 pr-2 font-medium">模型</th>
                  <th className="py-1 pr-2 font-medium">请求</th>
                  <th className="py-1 pr-2 font-medium">失败</th>
                  <th className="py-1 pr-2 font-medium">提示 tok</th>
                  <th className="py-1 pr-2 font-medium">补全 tok</th>
                  <th className="py-1 pr-2 font-medium">合计</th>
                  <th className="py-1 pr-2 font-medium">最近延迟</th>
                  <th className="py-1 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={`border-t ${p.id === activeId ? "text-foreground" : "text-muted-foreground"}`}>
                    <td className="py-1 pr-2">
                      {p.name || "未命名"}
                      {p.id === activeId && (
                        <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-foreground">使用中</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 font-mono">{p.model || "—"}</td>
                    <td className="py-1 pr-2">{p.requests}</td>
                    <td className={`py-1 pr-2 ${p.errors ? "text-red-500" : ""}`}>{p.errors || "—"}</td>
                    <td className="py-1 pr-2">{num(p.prompt, p.promptEst)}</td>
                    <td className="py-1 pr-2">{num(p.completion, p.completionEst)}</td>
                    <td className="py-1 pr-2 font-medium">
                      {fmtTokens((p.prompt || 0) + (p.completion || 0) + (p.promptEst || 0) + (p.completionEst || 0))}
                    </td>
                    <td className="py-1 pr-2">{p.lastLatencyMs ? `${p.lastLatencyMs}ms` : "—"}</td>
                    <td className="py-1">
                      <button type="button" className={btnGhostCls} onClick={() => doReset(p.id)} title="清零该方案统计">
                        清零
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t text-muted-foreground">
                  <td className="py-1 pr-2" colSpan={2}>合计</td>
                  <td className="py-1 pr-2">{total.requests}</td>
                  <td className={`py-1 pr-2 ${total.errors ? "text-red-500" : ""}`}>{total.errors || "—"}</td>
                  <td className="py-1 pr-2">{num(total.prompt, total.promptEst)}</td>
                  <td className="py-1 pr-2">{num(total.completion, total.completionEst)}</td>
                  <td className="py-1 pr-2 font-medium">{fmtTokens(totalTok)}</td>
                  <td className="py-1 pr-2" colSpan={2}>
                    自 {new Date(stats.since || Date.now()).toLocaleDateString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={btnCls} onClick={() => doReset(null)}>
              🧹 清零全部
            </button>
            <span className="text-[11px] text-muted-foreground">
              「≈」= 该响应未上报 usage，按字符数本地估算；其余为 API 返回的真实用量。
            </span>
          </div>
        </>
      )}
    </div>
  );
}

const LV_LABEL = { debug: "调试", info: "信息", warn: "警告", error: "错误" };

function fmtLogTime(ts) {
  const d = new Date(ts);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** 诊断日志查看器：每模块独立 tag（ai/webllm / ai/provider / ai/inline …），
 *  可按模块与级别过滤；「复制全部」导出纯文本（手机端没有 devtools 的排障入口）。 */
function LogViewerSection() {
  const [, setVer] = useState(0);
  useEffect(() => subscribeLogs(() => setVer((v) => v + 1)), []);
  const [tag, setTag] = useState("");
  const [level, setLevel] = useState("");
  const [copyMsg, setCopyMsg] = useState(null);
  const all = getLogEntries({ tag: tag || undefined, level: level || undefined });
  const shown = all.slice(-150).reverse(); // 最新在上，最多显示 150 条
  const tags = logTags();

  const doCopy = async () => {
    const text = exportLogsText();
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg({ ok: true, msg: `已复制 ${all.length} 条日志到剪贴板` });
    } catch {
      setCopyMsg({ ok: false, msg: "自动复制失败 —— 请手动选中下方日志文本复制" });
    }
    setTimeout(() => setCopyMsg(null), 3000);
  };
  const doClear = () => {
    if (!window.confirm(`确定清空全部诊断日志（共 ${getLogEntries().length} 条）？`)) return;
    clearLogs();
  };

  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <p className="text-xs font-medium">诊断日志（AI 补全）</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        各模块独立记录：<code>ai/webllm</code>（本地模型：WebGPU 预检/加载每 10% 里程碑/补全耗时）、
        <code>ai/provider</code>、<code>ai/inline</code>。自动保存最近 1200 条（刷新页面不丢）。
        手机上遇到问题时：复现一次 → 点「复制全部日志」→ 粘贴发出即可定位。
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <select className={`${inputCls} w-auto`} value={tag} onChange={(e) => setTag(e.target.value)} title="按模块过滤">
          <option value="">全部模块</option>
          {tags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className={`${inputCls} w-auto`} value={level} onChange={(e) => setLevel(e.target.value)} title="按级别过滤">
          <option value="">全部级别</option>
          {Object.entries(LV_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground">{all.length} 条</span>
        <button type="button" className={btnCls} onClick={doCopy}>📋 复制全部日志</button>
        <button type="button" className={btnGhostCls} onClick={doClear}>清空</button>
      </div>
      {copyMsg && (
        <p className={`text-[11px] ${copyMsg.ok ? "text-green-600" : "text-red-500"}`}>{copyMsg.msg}</p>
      )}
      <pre className="max-h-48 overflow-auto rounded border bg-background p-2 font-mono text-[10px] leading-relaxed">
        {shown.length === 0
          ? "（暂无日志 —— 使用编辑器/补全后这里会出现记录）"
          : shown.map((e, i) => (
              <div key={`${e.ts}-${i}`}>
                <span className="text-muted-foreground">{fmtLogTime(e.ts)}</span>
                {` [${e.tag}] [${LV_LABEL[e.level] ?? e.level}] `}
                {e.msg}
                {e.data !== undefined && (
                  <span className="text-muted-foreground">
                    {` ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}`}
                  </span>
                )}
              </div>
            ))}
      </pre>
    </div>
  );
}

export default function AiCompletionSettingsSection() {
  const [ai, setAi] = useState(null);
  const [testState, setTestState] = useState(null); // null | 'testing' | {ok, msg}
  const [showFimHelp, setShowFimHelp] = useState(false);
  // WebLLM 引擎状态（与编辑器侧共享同一份）：加载中/就绪时提供「停止」按钮
  const [wlStatus, setWlStatus] = useState(() =>
    typeof window === "undefined" ? { state: "idle" } : getWebllmStatus(),
  );
  useEffect(() => subscribeWebllmStatus(() => setWlStatus(getWebllmStatus())), []);
  // WebGPU 环境预检：webllm 方案下自动探测一次并显示结果（手机端加载失败的直接答案）
  const [gpuCheck, setGpuCheck] = useState(() =>
    typeof window === "undefined" ? null : getWebllmPreflight(),
  );

  useEffect(() => {
    setAi(loadAiSettings());
  }, []);

  useEffect(() => {
    if (!ai || ai.apiType !== "webllm") return;
    let alive = true;
    webllmPreflight()
      .then((r) => {
        if (alive) setGpuCheck(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ai?.apiType]);

  if (!ai) return null;

  const patchAi = (patch) => {
    const next = { ...ai, ...patch };
    setAi(next);
    saveAiSettings(patch);
  };
  const resetTest = () => {
    setTestState(null);
  };

  const activeProfile = ai.profiles.find((p) => p.id === ai.activeId) ?? null;

  /** 切换当前平台：该方案的字段整体覆盖到生效配置（首个方案即默认方案）。 */
  const switchProfile = (p) => {
    patchAi({ ...pickProfile(p), activeId: p.id });
    resetTest();
  };

  /** 新增平台并立即切换到它进行编辑。 */
  const addProfile = () => {
    const id = makeProfileId();
    const profile = { id, name: `平台 ${ai.profiles.length + 1}`, ...BLANK_PROFILE };
    patchAi({ ...pickProfile(profile), activeId: id, profiles: [...ai.profiles, profile] });
    resetTest();
  };

  const deleteProfile = (id) => {
    const rest = ai.profiles.filter((p) => p.id !== id);
    if (id !== ai.activeId) {
      patchAi({ profiles: rest });
      return;
    }
    const next = rest[0];
    patchAi(
      next
        ? { ...pickProfile(next), activeId: next.id, profiles: rest }
        : {
            name: "",
            activeId: null,
            profiles: rest,
            // 删除最后一个方案时同步清空扁平镜像字段（审查 AI-4/P1-4）：
            // 否则 normalizeAi 的「旧版迁移」分支会把保留的 baseUrl/apiKey
            // 立即重新迁移成方案 —— UI 上方案消失,补全仍用「已删除」的
            // 配置继续请求计费,刷新后复活
            ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f, ""])),
            enabled: false,
          },
    );
    resetTest();
  };

  const applyPreset = (p) => {
    // 预设只设行为字段（apiType/模板等）；连接信息（baseUrl/apiKey/model/转发）
    // 统一在「AI 服务商 → 功能模块挑选」配置，预设不再涉及
    patchAi({ ...p.patch });
    // 未命名或还是「平台 N」占位名时，用预设名给方案命名
    const rename = !ai.name || /^平台 /.test(ai.name);
    if (rename) patchAi({ name: p.label.replace(/（.*）/g, "").replace(/（仅本地可用）/g, "") });
    setTestState({ ok: true, msg: `已套用预设「${p.label}」—— 请到「功能模块挑选」子页确认服务商与模型` });
  };

  const doFetchModels = async () => {
    setTestState("testing");
    // WebLLM：这里变成「加载模型」——创建引擎（首次下载权重，之后走 Cache 秒加载）
    if (ai.apiType === "webllm") {
      toast.info("正在加载本地模型（首次需下载权重）…");
      try {
        const eng = await getWebllmEngine(
          ai.model,
          (r) => {
            const pct = Number.isFinite(r?.progress) ? `${(r.progress * 100).toFixed(0)}%` : "";
            setTestState({ ok: true, msg: `加载中 ${pct} ${r?.text ?? ""}` });
          },
          { downloadSource: ai.downloadSource ?? "auto" },
        );
        if (!eng) {
          setTestState({ ok: false, msg: "加载已停止（已下载的部分仍在浏览器缓存，重新点「加载模型」可续用）" });
          return;
        }
        setTestState({ ok: true, msg: "本地模型已就绪（权重已入浏览器缓存，刷新页面也无需重新下载）" });
        toast.success("本地模型已就绪");
      } catch (exn) {
        setTestState({ ok: false, msg: truncate(exn.message ?? String(exn), 200) });
        toast.error(`本地模型加载失败：${truncate(exn.message ?? String(exn), 80)}`);
      }
      return;
    }
    try {
      toast.info("正在测试连接…");
      const models = await fetchModelList(ai);
      setTestState({
        ok: true,
        msg: `连接成功，端点共 ${models.length} 个模型；请在「AI 服务商」分区管理模型列表后在此挑选`,
      });
      toast.success(`连接成功：端点共 ${models.length} 个模型`);
    } catch (exn) {
      setTestState({ ok: false, msg: truncate(exn.message ?? String(exn), 200) });
      toast.error(`连接失败：${truncate(exn.message ?? String(exn), 80)}`);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <p className="text-xs font-medium text-muted-foreground">
        AI 代码补全（FIM ghost text，Tab 接受；Alt+\ 手动触发）。支持在线模型
        （OpenAI 兼容 / Ollama）与 WebGPU 本地模型（WebLLM，浏览器内推理），按平台方案分别配置。
      </p>

      {/* 启用开关 */}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={ai.enabled}
          onChange={(e) => patchAi({ enabled: e.target.checked })}
        />
        <span>启用 AI 补全</span>
      </label>

      {/* 平台配置方案：先添加的平台为默认，之后可随时切换 */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          平台配置（点击切换；下方表单编辑当前方案）
        </p>
        {ai.profiles.length > 0 && (
          <div className="space-y-1">
            {ai.profiles.map((p) => {
              const active = p.id === ai.activeId;
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    active ? "border-primary/60 bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => !active && switchProfile(p)}
                  onKeyDown={(e) => {
                    if (!active && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      switchProfile(p);
                    }
                  }}
                  title={active ? "当前使用中" : "点击切换到此平台"}
                >
                  <span>{active ? "●" : "○"}</span>
                  <span className="font-medium">{p.name || "未命名"}</span>
                  <span className="truncate font-mono text-[11px]">{p.model || "未配置模型"}</span>
                  {active ? (
                    <span className="ml-auto shrink-0 rounded bg-primary/10 px-1 text-[10px] text-foreground">使用中</span>
                  ) : (
                    <span className="ml-auto shrink-0 text-[10px]">切换</span>
                  )}
                  <button
                    type="button"
                    className="shrink-0 rounded px-1 text-muted-foreground transition-colors hover:text-foreground"
                    title="删除该方案"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteProfile(p.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <button type="button" className={btnCls} onClick={addProfile}>
          ＋ 添加平台
        </button>
        {!ai.profiles.length && (
          <span className="block text-[11px] text-muted-foreground">
            尚无平台配置 —— 先添加第一个平台，它将作为默认方案
          </span>
        )}
      </div>

      {activeProfile && (
        <>
          {/* 快速预设 */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">快速预设（作用于当前方案）</p>
            <div className="flex flex-wrap gap-1.5">
              {AI_PRESETS.map((p) => (
                <button key={p.id} type="button" className={btnCls} onClick={() => applyPreset(p)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">方案名称</span>
              <input
                className={inputCls}
                value={ai.name}
                onChange={(e) => patchAi({ name: e.target.value })}
                placeholder="如：SiliconFlow / 本地 Ollama"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">API 类型</span>
              <select
                className={inputCls}
                value={ai.apiType}
                onChange={(e) => patchAi({ apiType: e.target.value })}
              >
                <option value="webllm">WebGPU 本地（WebLLM，浏览器内推理）</option>
                <option value="deepseek-fim">DeepSeek FIM Beta /beta/completions</option>
                <option value="openai-chat">OpenAI 兼容 /chat/completions</option>
                <option value="openai-completion">OpenAI 兼容 /completions（FIM base 模型）</option>
                <option value="ollama">Ollama 原生 /api/generate</option>
              </select>
            </label>
          </div>

          {ai.apiType === "webllm" ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                本地模型（首次使用下载一次，之后离线可用）
              </p>
              {gpuCheck &&
                (gpuCheck.ok ? (
                  <p className="text-[11px] leading-relaxed text-green-600">
                    ✓ WebGPU 可用
                    {gpuCheck.f16 === false
                      ? "，但缺少 shader-f16 特性 —— q4f16 模型无法运行，请选「f32 兼容版」"
                      : ""}
                    {gpuCheck.adapterInfo?.vendor
                      ? `（适配器：${gpuCheck.adapterInfo.vendor}${gpuCheck.adapterInfo.architecture ? ` · ${gpuCheck.adapterInfo.architecture}` : ""}）`
                      : ""}
                  </p>
                ) : (
                  <p className="text-[11px] leading-relaxed text-red-500">✕ {gpuCheck.reason}</p>
                ))}
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  权重下载源（国内网络直连 huggingface.co 会卡在 0%，保持自动探测即可）
                </span>
                <select
                  className={inputCls}
                  value={ai.downloadSource ?? "auto"}
                  onChange={(e) => {
                    patchAi({ downloadSource: e.target.value });
                    resetTest();
                  }}
                >
                  <option value="auto">自动探测（推荐：直连不通自动走魔搭）</option>
                  <option value="modelscope">魔搭 ModelScope（国内直连，速度快）</option>
                  <option value="hfmirror">hf-mirror.com（国内可用；海外出口会被回源）</option>
                  <option value="direct">huggingface.co 直连（需代理）</option>
                </select>
              </label>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                首次下载约 0.5–4.6GB。不同源各存一份缓存（切换后需重新下载一次）；已就绪的模型不受影响。
              </p>
              <div className="flex items-center gap-2">
                <select
                  className={`${inputCls} min-w-0 flex-1 font-mono`}
                  value={ai.model}
                  onChange={(e) => {
                    patchAi({ model: e.target.value });
                    resetTest();
                  }}
                >
                  {WEBLLM_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={btnCls}
                  onClick={doFetchModels}
                  disabled={testState === "testing" || isWebllmReady(ai.model)}
                >
                  {isWebllmReady(ai.model) ? "● 已就绪" : testState === "testing" ? "加载中…" : "加载模型"}
                </button>
                {wlStatus.state !== "idle" && (
                  <button
                    type="button"
                    className={btnCls}
                    title={
                      wlStatus.state === "ready"
                        ? "中断正在进行的生成并卸载模型（释放显存/内存，下次补全自动重载）"
                        : "中止模型加载（已下载部分保留在浏览器缓存）"
                    }
                    onClick={() => {
                      stopWebllmEngine();
                      resetTest();
                    }}
                  >
                    ⏹ 停止{wlStatus.state === "ready" ? "模型" : "加载"}
                  </button>
                )}
              </div>
              {testState && testState !== "testing" && (
                <p className={`text-[11px] ${testState.ok ? "text-green-600" : "text-red-500"}`}>{testState.msg}</p>
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                需浏览器支持 WebGPU（Chrome/Edge 113+、Safari 26+）。不手动加载也可以 —— 第一次补全时会自动加载模型。
              </p>
            </div>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                服务商与模型在「功能模块挑选」子页统一挑选（AI 代码补全模块行），
                本页仅配置 API 类型等行为字段；「测试连接」会探测该服务商端点的模型列表。
              </p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {ai.baseUrl ? `已解析端点：${ai.baseUrl} · 模型 ${ai.model || "（服务商第一个）"}` : "⚠ 「功能模块挑选」中未挑选服务商或该服务商未配置 Base URL / API Key"}
                </span>
                <button type="button" className={`${btnCls} ml-auto shrink-0`} onClick={doFetchModels} disabled={testState === "testing"}>
                  测试连接
                </button>
              </div>
              {testState && testState !== "testing" && (
                <p className={`text-[11px] ${testState.ok ? "text-green-600" : "text-red-500"}`}>{testState.msg}</p>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                FIM 提示模板{ai.apiType === "deepseek-fim" ? "（DeepSeek FIM 由服务端拼接，此选项不生效）" : ""}
              </span>
              <select
                className={inputCls}
                value={ai.fimTemplate}
                onChange={(e) => patchAi({ fimTemplate: e.target.value })}
                disabled={ai.apiType === "deepseek-fim"}
              >
                {FIM_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              {ai.fimTemplate === "custom" && (
                <input
                  className={`${inputCls} font-mono`}
                  value={ai.customTemplate}
                  onChange={(e) => patchAi({ customTemplate: e.target.value })}
                  placeholder="{prefix}…{suffix}…"
                  spellCheck={false}
                />
              )}
            </label>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">触发方式</span>
              <select
                className={inputCls}
                value={ai.trigger}
                onChange={(e) => patchAi({ trigger: e.target.value })}
              >
                <option value="auto">自动（键入后防抖触发）</option>
                <option value="manual">手动（Alt+\ 触发）</option>
              </select>
              {ai.trigger === "auto" && (
                <label className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">防抖</span>
                  <input
                    className={`${inputCls} w-24`}
                    type="number"
                    min={200}
                    step={100}
                    value={ai.debounceMs}
                    onChange={(e) => patchAi({ debounceMs: Math.max(200, Number(e.target.value) || 800) })}
                  />
                  <span className="text-muted-foreground">ms</span>
                </label>
              )}
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">温度</span>
              <input
                className={inputCls}
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={ai.temperature}
                onChange={(e) => patchAi({ temperature: Number(e.target.value) })}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">最大生成长度（tokens）</span>
              <input
                className={inputCls}
                type="number"
                min={16}
                max={2048}
                step={16}
                value={ai.maxTokens}
                onChange={(e) => patchAi({ maxTokens: Number(e.target.value) })}
              />
            </label>
          </div>

          <button
            type="button"
            className="text-[11px] text-muted-foreground underline underline-offset-2"
            onClick={() => setShowFimHelp((v) => !v)}
          >
              {showFimHelp ? "收起模板说明" : "什么是 FIM 模板？"}
            </button>
          {showFimHelp && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              FIM（Fill-in-the-Middle）：模型同时看光标前（prefix）与光标后（suffix）代码，生成中间片段。
              不同模型的控制 token 不同：Qwen2.5/3-Coder 用 {"<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>"}，
              DeepSeek-Coder 用 {"<|fim▁begin|>…<|fim▁hole|>…<|fim▁end|>"}，CodeLlama 用 {"<PRE>/<SUF>/<MID>"}。
              选错模板会导致补全质量差或输出乱码；Chat 模型（GPT-4o 等）可配「无模板」。
            </p>
          )}

          {ai.apiType !== "webllm" && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              是否经本站转发由「功能模块挑选」子页的 AI 代码补全模块行控制
              （本地模型服务请保持直连，服务端转发不可达本机）。
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            推荐：本地 <b>Ollama + qwen2.5-coder:7b</b>（8G 显存 4bit 可跑）。
            <code>ollama pull qwen2.5-coder:7b</code> 后保持服务运行即可；Tabby / llama.cpp / vLLM / OpenAI 兼容端点均可接入。
            可添加多个平台配置（如 SiliconFlow + 本地 Ollama），一键切换，互不影响；删除当前方案会自动切到下一个。
          </p>
        </>
      )}

      <TokenStatsSection activeId={ai.activeId} />

      <LogViewerSection />
    </div>
  );
}
