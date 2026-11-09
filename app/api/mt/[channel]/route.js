import { translateWithPlatform } from '@/scripts/lib/translate.mjs';

/**
 * Same-origin relay for the MT channels that reject browser CORS requests
 * (deepl / youdao / iflyrec — caiyun is fetched browser-direct). Stateless:
 * one paragraph in, one translation out, with the placeholder
 * protect/restore cycle from the shared pipeline.
 *
 * 服务端侧仍做最小节流（审查 2026-11-09 P2-8）：每渠道串行间隔 GAP ms、
 * 并发上限 MAX_CONC —— 浏览器的 pump/体检间隔（800ms）远比 CI 管线的 3s
 * 激进，多用户并发会对上游形成连发；超限返回 429，让客户端按渠道失败
 * 如实计入统计，而不是静默放大风控风险。
 */

export const maxDuration = 60; // youdao 引擎最坏要串行两个 25s 请求（30 会撞平台墙）
export const dynamic = 'force-dynamic';

const CHANNELS = new Set(['deepl', 'youdao', 'iflyrec']);
const MAX_TEXT = 4000;
const MAX_BODY = 64 * 1024; // text 上限 4000 字符 + JSON 包装，64KB 足够
const GAP = 500;
const MAX_CONC = 2;

const inFlight = new Map();
const lastAt = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(req, { params }) {
  const { channel } = await params;
  if (!CHANNELS.has(channel)) {
    return Response.json({ error: 'unknown channel' }, { status: 404 });
  }

  // Same-origin only: browsers attach Origin to every POST fetch, so a
  // matching host proves the call came from this site (works for production,
  // preview deployments and localhost alike).
  let originHost = '';
  try {
    originHost = new URL(req.headers.get('origin') || '').host;
  } catch {}
  if (!originHost || originHost !== req.headers.get('host')) {
    return Response.json({ error: 'cross-origin relay is not allowed' }, { status: 403 });
  }

  // 先验长度再 parse：避免超包整体进内存（与 /api/ai/proxy 同口径）
  let text = '';
  try {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_BODY) {
      return Response.json({ error: 'request body too large' }, { status: 413 });
    }
    text = String(JSON.parse(new TextDecoder().decode(buf))?.text || '');
  } catch {}
  if (!text.trim()) {
    return Response.json({ error: 'empty text' }, { status: 400 });
  }
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

  const cur = inFlight.get(channel) || 0;
  if (cur >= MAX_CONC) {
    return Response.json({ error: 'channel busy, retry later' }, { status: 429 });
  }
  const wait = (lastAt.get(channel) || 0) + GAP - Date.now();
  inFlight.set(channel, cur + 1);
  if (wait > 0) await sleep(wait);
  lastAt.set(channel, Date.now());
  try {
    const out = await translateWithPlatform(text, channel);
    return Response.json({ text: out });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502 });
  } finally {
    inFlight.set(channel, Math.max(0, (inFlight.get(channel) || 1) - 1));
  }
}
