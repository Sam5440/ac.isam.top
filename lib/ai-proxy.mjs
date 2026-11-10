import { readBodyLimited, readResponseLimited, requestPinned, resolveTargetAddresses } from './secure-proxy.mjs';

const DEFAULT_HOSTS = [
  'api.openai.com', 'api.anthropic.com', 'api.deepseek.com', 'openrouter.ai',
  'api.siliconflow.cn', 'api.moonshot.cn', 'api.moonshot.ai', 'open.bigmodel.cn',
  'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'generativelanguage.googleapis.com',
  'api.groq.com', 'api.together.xyz', 'api.mistral.ai', 'api.x.ai', 'api.perplexity.ai',
  'api.z.ai', 'api.minimax.chat',
];
const STRIP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'host', 'content-length', 'cookie', 'origin', 'referer',
  'accept-encoding', 'proxy-connection',
]);

function json(error, status) {
  return Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
}

function requestHeaders(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 40) return null;
  const headers = {};
  for (const [name, value] of Object.entries(input)) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || typeof value !== 'string'
      || value.length > 8192 || /[\r\n]/.test(value)) return null;
    const lower = name.toLowerCase();
    if (!STRIP_HEADERS.has(lower) && !lower.startsWith('x-forwarded-')) headers[lower] = value;
  }
  headers['accept-encoding'] = 'identity';
  return headers;
}

/** Per-instance limits supplement deployment-level firewall/rate rules. */
export function createProxyHandler({
  blockPrivate = Boolean(process.env.VERCEL),
  allowedHosts = [...DEFAULT_HOSTS, ...(process.env.AI_PROXY_ALLOWED_HOSTS || '').split(',')],
  timeoutMs = 55000,
  maxBody = 4 * 1024 * 1024,
  maxResponse = 8 * 1024 * 1024,
  maxInFlight = 24,
  requestsPerMinute = 120,
} = {}) {
  const hosts = new Set(allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  const rates = new Map();
  let inFlight = 0;

  return async function POST(req) {
    try {
      const origin = new URL(req.headers.get('origin') || '');
      if (origin.host !== req.headers.get('host') || (blockPrivate && origin.protocol !== 'https:')) {
        return json('cross-origin relay is not allowed', 403);
      }
    } catch {
      return json('cross-origin relay is not allowed', 403);
    }

    const now = Date.now();
    for (const [key, entry] of rates) if (now - entry.at >= 60000) rates.delete(key);
    // Vercel appends the edge-observed client address to X-Forwarded-For.
    const key = (req.headers.get('x-forwarded-for') || 'unknown').split(',').at(-1).trim().slice(0, 100);
    if (!rates.has(key) && rates.size >= 10000) return json('relay is busy', 429);
    const rate = rates.get(key) || { at: now, count: 0 };
    rate.count++;
    rates.set(key, rate);
    if (rate.count > requestsPerMinute || inFlight >= maxInFlight) return json('rate limit exceeded', 429);

    inFlight++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('upstream timeout')), timeoutMs);
    const onAbort = () => ctrl.abort(new Error('client disconnected'));
    req.signal.addEventListener('abort', onAbort, { once: true });
    if (req.signal.aborted) onAbort();
    let handedOff = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      req.signal.removeEventListener('abort', onAbort);
      inFlight--;
    };

    try {
      const bytes = await readBodyLimited(req, maxBody, ctrl.signal);
      if (bytes === null) return json('request body too large', 413);
      let spec;
      try { spec = JSON.parse(bytes.toString('utf8')); } catch { return json('invalid JSON body', 400); }
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return json('invalid request', 400);
      let target;
      try { target = new URL(spec.url); } catch { return json('missing or invalid url', 400); }
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
        return json('missing or invalid url', 400);
      }
      if (blockPrivate && (target.protocol !== 'https:' || (target.port && target.port !== '443'))) {
        return json('only HTTPS on the default port is allowed', 403);
      }
      if (blockPrivate && !hosts.has(target.hostname.replace(/\.$/, '').toLowerCase())) {
        return json('provider host is not allowed; configure AI_PROXY_ALLOWED_HOSTS on the server', 403);
      }
      const method = String(spec.method || 'POST').toUpperCase();
      if (!['GET', 'POST'].includes(method)) return json('method not allowed', 405);
      const headers = requestHeaders(spec.headers || {});
      if (!headers) return json('invalid request headers', 400);
      const body = method === 'GET' ? undefined : Buffer.from(
        typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body ?? {}),
      );
      if (body?.length > maxBody) return json('request body too large', 413);
      if (body && !headers['content-type']) headers['content-type'] = 'application/json';

      const addresses = await resolveTargetAddresses(target, { blockPrivate, signal: ctrl.signal });
      const upstream = await requestPinned(target, addresses, { method, headers, body, signal: ctrl.signal });
      const status = upstream.statusCode || 502;
      if (status >= 300 && status < 400) {
        upstream.destroy();
        return json('upstream redirects are not allowed', 502);
      }
      const contentType = String(upstream.headers['content-type'] || 'application/json');
      if (upstream.headers['content-encoding'] && upstream.headers['content-encoding'] !== 'identity') {
        upstream.destroy();
        return json('unexpected upstream content encoding', 502);
      }

      if (status >= 200 && status < 300 && contentType.toLowerCase().includes('text/event-stream')) {
        const reader = Readable.toWeb(upstream).getReader();
        let size = 0;
        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) { release(); controller.close(); return; }
              size += value.byteLength;
              if (size > maxResponse) throw new Error('upstream response too large');
              controller.enqueue(value);
            } catch (error) {
              ctrl.abort(error);
              release();
              controller.error(error);
            }
          },
          async cancel(reason) {
            ctrl.abort(new Error('client disconnected'));
            await reader.cancel(reason).catch(() => {});
            release();
          },
        });
        upstream.once('close', release);
        handedOff = true;
        return new Response(stream, { status, headers: { 'content-type': contentType, 'cache-control': 'no-cache' } });
      }

      const response = await readResponseLimited(upstream, maxResponse);
      if (response === null) return json('upstream response too large', 502);
      return new Response([204, 205, 304].includes(status) ? null : response, {
        status, headers: { 'content-type': contentType, 'cache-control': 'no-store' },
      });
    } catch (error) {
      const message = ctrl.signal.aborted ? ctrl.signal.reason?.message : error?.message;
      return json(message || 'upstream request failed', message?.includes('private network') ? 403 : 502);
    } finally {
      if (!handedOff) release();
    }
  };
}
