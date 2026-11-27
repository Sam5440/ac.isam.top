/**
 * 私有化平台的「解锁记忆」与「带密码链接」（Node / 浏览器同构纯模块）。
 *
 * 两件事：
 *  1. 记住解锁：密码 + 过期时间（默认 30 天）存进 localStorage，键
 *     `ac-private-unlock-v1`，由 lib/private-unlock-store.js 读写。
 *  2. 分享链接：`/contests/private/<id>#p=v1.<base64url(密码)>`，访客打开即
 *     自动解密，无需手输。
 *
 * 安全边界（页面文案与 AGENTS.md §3.6b 必须保持一致）：
 *  - 密码只是 base64url 编码，**不是加密**；拿到链接的人就能解锁。
 *  - hash 不会随请求发给服务器，也不会出现在 Referer 里；但浏览器历史、
 *    聊天软件预览、截图仍可能泄漏，所以生成链接要用户显式点击。
 *  - 自动解密成功后会把 `#p=` 从地址栏抹掉（history.replaceState），避免
 *    后续截图/复制页面地址时顺带泄漏。
 */

import { base64ToBytes, bytesToBase64 } from './private-vault.mjs';

/** 免密有效期：30 天。 */
export const UNLOCK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** localStorage 键（数据类，不进设置导出）。 */
export const UNLOCK_STORAGE_KEY = 'ac-private-unlock-v1';
/** 分享链接里的参数名（hash 优先，兼容 query）。 */
export const SHARE_PARAM = 'p';
/** 编码版本前缀，便于以后换编码方式。 */
const SHARE_PREFIX = 'v1.';
/** 单机最多记住多少场，防止 localStorage 无限增长。 */
const MAX_SAVED = 50;

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(String(text));
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(token) {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return new TextDecoder().decode(base64ToBytes(b64 + pad));
}

/** 密码 → 链接里的 token（`v1.` + base64url）。空密码返回空串。 */
export function encodeShareToken(password) {
  const text = String(password ?? '');
  if (!text) return '';
  return SHARE_PREFIX + toBase64Url(text);
}

/**
 * 链接 token → 密码。带 `v1.` 前缀时严格校验（base64url 且可逆），
 * 没有前缀的原样返回（兼容手工拼的明文链接）。
 */
export function decodeShareToken(token) {
  const raw = String(token ?? '').trim();
  if (!raw) return null;
  if (!raw.startsWith(SHARE_PREFIX)) return raw;
  const body = raw.slice(SHARE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  try {
    const text = fromBase64Url(body);
    if (!text || toBase64Url(text) !== body) return null;
    return text;
  } catch {
    return null;
  }
}

/** 从完整 URL 里取密码：先看 hash（`#p=`），再看 query（`?p=`）。 */
export function readShareTokenFromUrl(href) {
  let url;
  try {
    url = new URL(String(href));
  } catch {
    return null;
  }
  const hash = url.hash.replace(/^#/, '');
  const hashParams = new URLSearchParams(hash);
  const sources = [
    ['hash', hashParams],
    ['query', url.searchParams],
  ];
  for (const [source, params] of sources) {
    for (const key of [SHARE_PARAM, 'pw']) {
      const token = params.get(key);
      if (!token) continue;
      const password = decodeShareToken(token);
      if (password) return { password, source, key };
    }
  }
  return null;
}

/** 去掉 URL 里的 `p` / `pw`，其余参数与 hash 片段原样保留。 */
export function stripShareToken(href) {
  let url;
  try {
    url = new URL(String(href));
  } catch {
    return String(href);
  }
  for (const key of [SHARE_PARAM, 'pw']) url.searchParams.delete(key);
  const hash = url.hash.replace(/^#/, '');
  if (hash) {
    const parts = hash.split('&');
    const kept = parts.filter((seg) => {
      const key = seg.split('=')[0];
      return key !== SHARE_PARAM && key !== 'pw';
    });
    if (kept.length !== parts.length) url.hash = kept.length ? `#${kept.join('&')}` : '';
  }
  return url.toString();
}

/** 生成比赛页的带密码链接（origin 传 `window.location.origin` 即得绝对地址）。 */
export function buildShareHref(contestId, password, origin = '') {
  const token = encodeShareToken(password);
  const base = `${origin}/contests/private/${encodeURIComponent(String(contestId))}`;
  return token ? `${base}#${SHARE_PARAM}=${token}` : base;
}

/** 一条解锁记录。 */
export function createUnlockRecord(password, now = Date.now(), ttl = UNLOCK_TTL_MS) {
  const text = String(password ?? '');
  if (!text) return null;
  return { password: text, savedAt: now, expiresAt: now + ttl };
}

/** 记录是否仍在有效期内。 */
export function isUnlockValid(record, now = Date.now()) {
  if (!record || typeof record !== 'object') return false;
  const expiresAt = Number(record.expiresAt);
  return Boolean(record.password) && Number.isFinite(expiresAt) && expiresAt > now;
}

/** 剩余天数（向上取整，最小 0）。 */
export function unlockDaysLeft(record, now = Date.now()) {
  if (!isUnlockValid(record, now)) return 0;
  return Math.ceil((Number(record.expiresAt) - now) / 86_400_000);
}

/**
 * 归一化 localStorage 里的解锁表：容忍损坏 JSON / 旧格式，丢掉过期与非法项。
 * `now = 0` 表示不做过期过滤（用于对比是否需要清理）。
 */
export function normalizeUnlockStore(raw, now = Date.now()) {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [id, record] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_SAVED) break;
    if (!id || typeof id !== 'string') continue;
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    if (!isUnlockValid(record, now)) continue;
    const savedAt = Number(record.savedAt);
    out[id] = {
      password: String(record.password),
      savedAt: Number.isFinite(savedAt) ? Math.round(savedAt) : now,
      expiresAt: Math.round(Number(record.expiresAt)),
    };
  }
  return out;
}
