// /api/ai/proxy：AI 补全请求转发（移植自 ACM-IDE-online 的 shared/ai-proxy-core.mjs，
// 适配 Next.js App Router）。解决浏览器直连本地模型（Ollama / Tabby / llama.cpp 等）
// 与第三方 API 的 CORS 限制。
// 请求体：{ url, method?, headers?, body? }；Key 只在请求体里透传，本函数不落盘。
//
// 安全边界（修复 2026-11-09 审查 P0-1）：
//  - 同源校验：与 /api/mt 相同的 Origin/Host 比对，杜绝被当作公开匿名中继；
//  - method 白名单（GET/POST）+ hop-by-hop/敏感头过滤；
//  - 私网/链路本地目标拦截 —— 仅在 Vercel 等平台部署启用（自托管场景拦截
//    会破坏「代理本机 Ollama」这一设计目标，且同源校验已挡住外部滥用面）；
//  - redirect: "manual"：不允许一个公网 302 把请求跳进私网。

const MAX_BODY = 4 * 1024 * 1024; // 请求体上限（FIM prompt 不会太大）
const MAX_RESP = 8 * 1024 * 1024; // 响应上限
const TIMEOUT_MS = 60 * 1000; // 与 maxDuration 对齐（旧值 120s 在平台上永远轮不到）

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set(["GET", "POST"]);
// hop-by-hop 与由 fetch 重建的头，不透传客户端值
const STRIP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
]);

// 平台部署（Vercel）上服务端取「用户本机」毫无意义，私网目标一律拒绝；
// 自托管（next start 于用户自己的机器）正是本代理的设计目标，放行。
const BLOCK_PRIVATE = Boolean(process.env.VERCEL);

function json(obj, status) {
  return Response.json(obj, { status });
}

function isPrivateHost(hostname) {
  const h = String(hostname).toLowerCase();
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|0\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "[::1]" || /^\[f[cd]/.test(h)) return true;
  if (/\.(local|internal|lan|home|corp)$/.test(h)) return true;
  return false;
}

/**
 * 处理一次 /api/ai/proxy 请求。
 * 请求体：{ url, method?, headers?, body? }（body 为对象或已序列化字符串）
 * 响应：透传上游 status + body；代理自身故障返回 502 { error }
 */
export async function POST(req) {
  // 同源校验：浏览器对每个 POST fetch 都带 Origin，host 相等即证明来自本站
  // 页面；无 Origin（curl/服务端直调）与跨站 Origin 一律 403。
  let originHost = "";
  try {
    originHost = new URL(req.headers.get("origin") || "").host;
  } catch {}
  if (!originHost || originHost !== req.headers.get("host")) {
    return json({ error: "cross-origin relay is not allowed" }, 403);
  }

  let raw;
  try {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_BODY) {
      return json({ error: "request body too large" }, 413);
    }
    raw = new TextDecoder().decode(buf);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 400);
  }
  let spec;
  try {
    spec = JSON.parse(raw || "{}");
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const { url, method = "POST", headers = {}, body } = spec || {};
  let target;
  try {
    target = new URL(url);
  } catch {
    return json({ error: "missing or invalid url" }, 400);
  }
  if (!/^https?:$/.test(target.protocol)) {
    return json({ error: "missing or invalid url" }, 400);
  }
  const verb = String(method).toUpperCase();
  if (!ALLOWED_METHODS.has(verb)) {
    return json({ error: "method not allowed" }, 405);
  }
  if (BLOCK_PRIVATE && isPrivateHost(target.hostname)) {
    return json({ error: "private network target is not allowed" }, 403);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("upstream timeout")), TIMEOUT_MS);
  try {
    const outHeaders = {};
    for (const [k, v] of Object.entries(headers || {})) {
      if (!STRIP_HEADERS.has(String(k).toLowerCase())) outHeaders[k] = v;
    }
    const init = {
      method: verb,
      headers: outHeaders,
      signal: ctrl.signal,
      redirect: "manual", // 不跟随重定向：防止公网 302 跳进私网（每跳复检的替代）
    };
    if (init.method !== "GET" && init.method !== "HEAD") {
      init.body = typeof body === "string" ? body : JSON.stringify(body ?? {});
      if (!init.headers["content-type"]) init.headers["content-type"] = "application/json";
    }
    const upstream = await fetch(target.href, init);
    // SSE 流式响应（AI 对话 stream:true）直接透传字节流，不做 arrayBuffer
    // 全量缓冲 —— 缓冲会让对话一个字都不吐直到结束，失去流式体验。
    const upstreamCt = upstream.headers.get("content-type") || "";
    if (upstream.ok && upstreamCt.includes("text/event-stream") && upstream.body) {
      // 不 clearTimeout：60s 到点 abort 上游连接，流随之终止（SSE 也受超时约束）
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": upstreamCt,
          "cache-control": "no-cache",
        },
      });
    }
    const ab = await upstream.arrayBuffer();
    clearTimeout(timer);
    if (ab.byteLength > MAX_RESP) {
      // 旧实现截断后只在 header 打标（无消费方），截断 JSON 会让客户端静默拿到
      // 空结果 —— 改为显式 502，让上层报「响应过大」。
      return json({ error: "upstream response too large" }, 502);
    }
    return new Response(ab, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    return json({ error: String((err && err.message) || err) }, 502);
  }
}
