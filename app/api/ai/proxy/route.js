// /api/ai/proxy：AI 补全请求转发（移植自 ACM-IDE-online 的 shared/ai-proxy-core.mjs，
// 适配 Next.js App Router）。解决浏览器直连本地模型（Ollama / Tabby / llama.cpp 等）
// 与第三方 API 的 CORS 限制。
// 请求体：{ url, method?, headers?, body? }；Key 只在请求体里透传，本函数不落盘。

const MAX_BODY = 4 * 1024 * 1024; // 请求体上限（FIM prompt 不会太大）
const MAX_RESP = 8 * 1024 * 1024; // 响应上限
const TIMEOUT_MS = 120 * 1000; // 本地小模型推理可能较慢，放宽超时

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function json(obj, status) {
  return Response.json(obj, { status });
}

/**
 * 处理一次 /api/ai/proxy 请求。
 * 请求体：{ url, method?, headers?, body? }（body 为对象或已序列化字符串）
 * 响应：透传上游 status + body；代理自身故障返回 502 { error }
 */
export async function POST(req) {
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
  if (!url || !/^https?:\/\//i.test(url)) {
    return json({ error: "missing or invalid url" }, 400);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("upstream timeout")), TIMEOUT_MS);
  try {
    const init = {
      method: String(method).toUpperCase(),
      headers: { ...headers },
      signal: ctrl.signal,
      redirect: "follow",
    };
    if (init.method !== "GET" && init.method !== "HEAD") {
      init.body = typeof body === "string" ? body : JSON.stringify(body ?? {});
      if (!init.headers["content-type"]) init.headers["content-type"] = "application/json";
    }
    const upstream = await fetch(url, init);
    // SSE 流式响应（AI 对话 stream:true）直接透传字节流，不做 arrayBuffer
    // 全量缓冲 —— 缓冲会让对话一个字都不吐直到结束，失去流式体验。
    const upstreamCt = upstream.headers.get("content-type") || "";
    if (upstream.ok && upstreamCt.includes("text/event-stream") && upstream.body) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": upstreamCt,
          "cache-control": "no-cache",
        },
      });
    }
    const ab = await upstream.arrayBuffer();
    const headersOut = {
      "content-type": upstream.headers.get("content-type") || "application/json",
    };
    if (ab.byteLength > MAX_RESP) {
      headersOut["x-ai-proxy-truncated"] = "1";
    }
    return new Response(
      ab.byteLength > MAX_RESP ? ab.slice(0, MAX_RESP) : ab,
      { status: upstream.status, headers: headersOut },
    );
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 502);
  } finally {
    clearTimeout(timer);
  }
}
