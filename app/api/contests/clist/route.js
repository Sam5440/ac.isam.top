/**
 * /api/contests/clist —— Clist 比赛数据服务端代理（工作项 3.4）。
 *
 * - 上游：GET https://clist.by/api/v4/json/contest/，鉴权 `Authorization: Bearer ${CLIST_API_KEY}`
 *   （Key 只在服务端读取，任何响应都不会回传）。
 * - 参数白名单透传：upcoming / start_time__during（默认 '30 days'）/ limit（默认 100）/
 *   offset / order_by（默认 start），其余查询参数一律丢弃，防止把任意查询打向上游。
 * - 模块级缓存 TTL 600s + in-flight 去重：Clist 限流 10 req/min，缓存是强制的；
 *   key = 规范化后的 query，同一窗口的并发请求只打一次上游。
 * - 错误语义：缺 Key → 500 {error:'CLIST_API_KEY 未配置'}；
 *   上游 429/5xx/网络失败 → 502 {error}（透传上游文案，不做重试风暴）。
 */

export const dynamic = 'force-dynamic';

const UPSTREAM_URL = 'https://clist.by/api/v4/json/contest/';
const CACHE_TTL_MS = 600 * 1000;
const MAX_CACHE_ENTRIES = 50;
const MAX_LIMIT = 500;

const ALLOWED_PARAMS = new Set(['upcoming', 'start_time__during', 'limit', 'offset', 'order_by']);

// 模块级缓存与在途请求去重（dev 热重载会重建，无碍；生产为单实例常驻）
/** @type {Map<string, {at:number, body:object}>} */
const cache = new Map();
/** @type {Map<string, Promise<object>>} */
const inflight = new Map();

/** 白名单过滤 + 默认值 + 数值钳制 → 规范化 query（其字符串形式即缓存 key）。 */
function normalizeQuery(searchParams) {
  const out = new URLSearchParams();
  for (const key of ALLOWED_PARAMS) {
    const raw = searchParams.get(key);
    if (raw !== null && raw.trim() !== '') out.set(key, raw.trim());
  }
  if (!out.has('start_time__during')) out.set('start_time__during', '30 days');
  if (!out.has('order_by')) out.set('order_by', 'start');
  const limit = Math.min(Math.max(parseInt(out.get('limit'), 10) || 100, 1), MAX_LIMIT);
  out.set('limit', String(limit));
  const offset = Math.max(parseInt(out.get('offset'), 10) || 0, 0);
  out.set('offset', String(offset));
  return out;
}

/** 上游响应 → 本站响应体（只保留渲染所需字段）。 */
function pickContests(data) {
  const list = data?.objects?.contest;
  if (!Array.isArray(list)) return [];
  return list.map((c) => ({
    id: c.id,
    event: c.event,
    resource: c.resource,
    start: c.start,
    end: c.end,
    duration: c.duration,
    href: c.href,
  }));
}

async function fetchUpstream(params) {
  let res;
  try {
    res = await fetch(`${UPSTREAM_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${process.env.CLIST_API_KEY}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
  } catch (e) {
    throw new Error(`Clist 上游不可达：${e?.message || '网络错误'}`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`Clist 上游错误（HTTP ${res.status}）${text ? `：${text}` : ''}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error('Clist 上游返回了无法解析的响应');
  }
}

export async function GET(request) {
  if (!process.env.CLIST_API_KEY) {
    return Response.json({ error: 'CLIST_API_KEY 未配置' }, { status: 500 });
  }
  const params = normalizeQuery(new URL(request.url).searchParams);
  const key = params.toString();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return Response.json(hit.body, { headers: { 'X-Cache': 'hit' } });
  }

  let promise = inflight.get(key);
  if (!promise) {
    promise = fetchUpstream(params)
      .then((data) => {
        const body = { fetchedAt: new Date().toISOString(), contests: pickContests(data) };
        cache.set(key, { at: Date.now(), body });
        // 简单容量上限：超出挤掉最旧
        if (cache.size > MAX_CACHE_ENTRIES) {
          const oldest = cache.keys().next().value;
          cache.delete(oldest);
        }
        return body;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }

  try {
    const body = await promise;
    return Response.json(body, { headers: { 'X-Cache': 'miss' } });
  } catch (e) {
    return Response.json({ error: e?.message || '代理请求失败' }, { status: 502 });
  }
}
