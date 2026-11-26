/**
 * 私有化平台的加密格式（纯模块：Node 与浏览器共用同一份实现）。
 *
 * 目标：题目**只以密文**进仓库。构建期、服务端、CDN、PR diff 都只能看到
 * PBKDF2 派生密钥 + AES-256-GCM 的密文；明文只在访客浏览器里、输入密码之后
 * 才出现。
 *
 * 文件布局（都在 data/private/ 下）：
 *   data/private/vault.json                 明文索引（id / label / 大小 / 时间）
 *   data/private/vault/<id>.json            单个比赛的密文信封
 *
 * 信封结构：
 *   { format, version, id, label, createdAt, bytes,
 *     kdf: { name:'PBKDF2', hash:'SHA-256', iterations, salt },
 *     cipher: { name:'AES-GCM', iv, tagLength:128 },
 *     ciphertext }
 *
 * 为什么索引里保留 label 明文：访客在输入密码之前必须能认出「这是哪一场比赛」
 * 才谈得上解锁。label 由上传者自己起（例如「CCPC 2026 厦门 · 正式赛」），
 * 题名/题面/样例/图片全部在密文里。
 *
 * 密码学参数：PBKDF2-HMAC-SHA256 310000 轮（OWASP 2023 建议值）+ 16 字节随机盐 +
 * 12 字节随机 IV + AES-GCM 128-bit tag。GCM 认证失败即密码错误（或密文被改），
 * 不需要额外的「密码校验位」。
 */

export const VAULT_FORMAT = 'ac-private-vault';
export const VAULT_PAYLOAD_FORMAT = 'ac-private-contest';
export const VAULT_INDEX_FORMAT = 'ac-private-index';
export const VAULT_VERSION = 1;
export const VAULT_DIR = 'data/private';
export const VAULT_INDEX_FILE = 'data/private/vault.json';

export const KDF_ITERATIONS = 310_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const MAX_PROBLEMS = 60;

/* ------------------------------ base64 ------------------------------ */

export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== 'undefined') return Buffer.from(view).toString('base64');
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(text) {
  const raw = String(text ?? '').replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(raw, 'base64'));
  const binary = atob(raw);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/* ------------------------------ crypto ------------------------------ */

function subtle() {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error('当前环境没有 Web Crypto（需要 Node 18+ 或 HTTPS 页面）');
  return api;
}

function randomBytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** 密码 → AES-GCM 密钥（PBKDF2-HMAC-SHA256）。 */
export async function deriveVaultKey(password, salt, iterations = KDF_ITERATIONS) {
  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(String(password ?? '')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    {
      name: 'PBKDF2',
      salt: salt instanceof Uint8Array ? salt : new Uint8Array(salt),
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 明文对象 → 密文信封（不含 id/label 之外的任何明文内容）。 */
export async function encryptVaultPayload(payload, password, options = {}) {
  const iterations = Number.isFinite(options.iterations) ? Math.floor(options.iterations) : KDF_ITERATIONS;
  const salt = options.salt ?? randomBytes(SALT_BYTES);
  const iv = options.iv ?? randomBytes(IV_BYTES);
  const key = await deriveVaultKey(password, salt, iterations);
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plain));
  return {
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    id: String(payload.id),
    label: String(payload.label ?? payload.titleZh ?? payload.title ?? payload.id),
    createdAt: options.createdAt ?? new Date().toISOString(),
    bytes: cipher.length,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv), tagLength: 128 },
    ciphertext: bytesToBase64(cipher),
  };
}

export class VaultDecryptError extends Error {
  constructor(message = '密码错误，或密文已被篡改') {
    super(message);
    this.name = 'VaultDecryptError';
  }
}

/** 密文信封 + 密码 → 明文对象。认证失败统一抛 VaultDecryptError。 */
export async function decryptVaultEnvelope(envelope, password) {
  if (!isVaultEnvelope(envelope)) throw new VaultDecryptError('不是有效的私有化密文文件');
  const iterations = Number(envelope.kdf.iterations);
  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 5_000_000) {
    throw new VaultDecryptError('密文的 KDF 参数不合法');
  }
  const salt = base64ToBytes(envelope.kdf.salt);
  const iv = base64ToBytes(envelope.cipher.iv);
  const data = base64ToBytes(envelope.ciphertext);
  if (salt.length < 8 || iv.length < 12 || !data.length) throw new VaultDecryptError('密文结构不完整');
  const key = await deriveVaultKey(password, salt, iterations);
  let plain;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, data);
  } catch {
    throw new VaultDecryptError();
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new VaultDecryptError('解密结果不是有效的 JSON');
  }
  const check = validateVaultPayload(payload);
  if (!check.ok) throw new VaultDecryptError(`解密内容格式异常：${check.error}`);
  return payload;
}

export function isVaultEnvelope(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.format === VAULT_FORMAT
    && value.kdf?.name === 'PBKDF2'
    && value.cipher?.name === 'AES-GCM'
    && typeof value.ciphertext === 'string',
  );
}

/* --------------------------- payload schema --------------------------- */

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_TEXT = 400_000;

const isStr = (v, max = MAX_TEXT) => typeof v === 'string' && v.length <= max;
const isOptStr = (v, max = MAX_TEXT) => v == null || isStr(v, max);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/**
 * 明文载荷校验（解密后必过；加密前也必过，避免把坏数据写进仓库）。
 * 返回 { ok, error? }。
 */
export function validateVaultPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: '载荷必须是 JSON 对象' };
  if (payload.format !== VAULT_PAYLOAD_FORMAT) return { ok: false, error: `format 必须是 ${VAULT_PAYLOAD_FORMAT}` };
  if (payload.version !== VAULT_VERSION) return { ok: false, error: `version 必须是 ${VAULT_VERSION}` };
  if (!ID_RE.test(String(payload.id ?? ''))) return { ok: false, error: 'id 只能是小写字母/数字/连字符（1–64 位）' };
  if (!isStr(payload.label, 200) || !payload.label.trim()) return { ok: false, error: 'label 不能为空（≤200 字符）' };
  if (!isStr(payload.title, 400)) return { ok: false, error: 'title 缺失或过长' };
  if (!isOptStr(payload.titleZh, 400)) return { ok: false, error: 'titleZh 过长' };
  if (!isOptStr(payload.source, 1000)) return { ok: false, error: 'source 过长' };
  if (!isOptStr(payload.startTime, 40)) return { ok: false, error: 'startTime 过长' };
  if (payload.durationSeconds != null && !isInt(payload.durationSeconds, 0, 60 * 60 * 24 * 7)) {
    return { ok: false, error: 'durationSeconds 必须是 0–604800 的整数' };
  }
  if (!isOptStr(payload.note, 2000)) return { ok: false, error: 'note 过长' };
  const problems = payload.problems;
  if (!Array.isArray(problems) || !problems.length) return { ok: false, error: 'problems 必须是非空数组' };
  if (problems.length > MAX_PROBLEMS) return { ok: false, error: `单场最多 ${MAX_PROBLEMS} 题` };
  const seen = new Set();
  for (const [i, p] of problems.entries()) {
    const at = `problems[${i}]`;
    if (!p || typeof p !== 'object') return { ok: false, error: `${at} 必须是对象` };
    if (!ID_RE.test(String(p.id ?? ''))) return { ok: false, error: `${at}.id 只能是小写字母/数字/连字符` };
    if (seen.has(p.id)) return { ok: false, error: `${at}.id 重复：${p.id}` };
    seen.add(p.id);
    if (!isStr(p.index, 24) || !p.index.trim()) return { ok: false, error: `${at}.index 不能为空` };
    if (!isStr(p.title, 400) || !p.title.trim()) return { ok: false, error: `${at}.title 不能为空` };
    if (!isOptStr(p.titleZh, 400)) return { ok: false, error: `${at}.titleZh 过长` };
    if (!isStr(p.statementMd, MAX_TEXT) || !p.statementMd.trim()) return { ok: false, error: `${at}.statementMd 不能为空` };
    if (!isOptStr(p.statementZhMd)) return { ok: false, error: `${at}.statementZhMd 过长` };
    if (p.timeLimitMs != null && !isInt(p.timeLimitMs, 0, 10 * 60 * 1000)) return { ok: false, error: `${at}.timeLimitMs 必须是毫秒整数` };
    if (p.memoryLimitMb != null && !isInt(p.memoryLimitMb, 0, 1_048_576)) return { ok: false, error: `${at}.memoryLimitMb 必须是 MB 整数` };
    if (p.samples != null) {
      if (!Array.isArray(p.samples) || p.samples.length > 100) return { ok: false, error: `${at}.samples 必须是数组（≤100）` };
      for (const [j, s] of p.samples.entries()) {
        if (!s || typeof s !== 'object') return { ok: false, error: `${at}.samples[${j}] 必须是对象` };
        if (!isStr(s.input ?? '', 200_000)) return { ok: false, error: `${at}.samples[${j}].input 过长` };
        if (!isStr(s.output ?? '', 200_000)) return { ok: false, error: `${at}.samples[${j}].output 过长` };
        if (!isOptStr(s.note, 20_000)) return { ok: false, error: `${at}.samples[${j}].note 过长` };
        if (!isOptStr(s.noteZh, 20_000)) return { ok: false, error: `${at}.samples[${j}].noteZh 过长` };
      }
    }
    if (p.difficulty != null && !Number.isFinite(p.difficulty)) return { ok: false, error: `${at}.difficulty 必须是数字` };
    if (p.tags != null && (!Array.isArray(p.tags) || p.tags.some((t) => !isStr(t, 80)))) {
      return { ok: false, error: `${at}.tags 必须是字符串数组` };
    }
    if (p.statementPdf) return { ok: false, error: `${at} 不能包含 statementPdf（私有化只接受 Markdown 题面）` };
  }
  return { ok: true };
}

/** 补默认值 / 裁剪空白（幂等，不做内容改写）。 */
export function normalizeVaultPayload(payload) {
  const problems = (payload.problems ?? []).map((p, i) => ({
    id: String(p.id ?? '').toLowerCase(),
    index: String(p.index ?? String.fromCharCode(65 + i)).trim(),
    title: String(p.title ?? '').trim(),
    titleZh: p.titleZh ? String(p.titleZh).trim() : null,
    url: p.url ? String(p.url) : null,
    timeLimitMs: p.timeLimitMs ?? null,
    memoryLimitMb: p.memoryLimitMb ?? null,
    difficulty: p.difficulty ?? null,
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
    statementMd: String(p.statementMd ?? '').replace(/\r\n/g, '\n').trim(),
    statementZhMd: p.statementZhMd ? String(p.statementZhMd).replace(/\r\n/g, '\n').trim() : null,
    samples: (p.samples ?? []).map((s) => ({
      input: String(s.input ?? ''),
      output: String(s.output ?? ''),
      ...(s.note ? { note: String(s.note) } : {}),
      ...(s.noteZh ? { noteZh: String(s.noteZh) } : {}),
    })),
  }));
  return {
    format: VAULT_PAYLOAD_FORMAT,
    version: VAULT_VERSION,
    id: String(payload.id ?? '').toLowerCase(),
    label: String(payload.label ?? '').trim(),
    title: String(payload.title ?? '').trim(),
    titleZh: payload.titleZh ? String(payload.titleZh).trim() : null,
    source: payload.source ? String(payload.source) : null,
    startTime: payload.startTime ?? null,
    durationSeconds: payload.durationSeconds ?? null,
    note: payload.note ? String(payload.note) : null,
    problems,
  };
}

/* ------------------------------- index ------------------------------- */

export function isVaultIndexEntry(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && ID_RE.test(String(value.id ?? ''))
    && typeof value.label === 'string'
    && typeof value.file === 'string'
    && /^[a-z0-9][a-z0-9-]{0,63}\.json$/.test(value.file),
  );
}

/** 密文信封 → 索引条目（索引是明文，只放辨识信息与体积）。 */
export function indexEntryOf(envelope) {
  return {
    id: envelope.id,
    label: envelope.label,
    file: `${envelope.id}.json`,
    bytes: envelope.bytes ?? base64ToBytes(envelope.ciphertext).length,
    createdAt: envelope.createdAt ?? null,
  };
}

export function normalizeVaultIndex(index) {
  const contests = Array.isArray(index?.contests) ? index.contests.filter(isVaultIndexEntry) : [];
  const seen = new Set();
  return {
    format: VAULT_INDEX_FORMAT,
    version: VAULT_VERSION,
    updatedAt: index?.updatedAt ?? null,
    contests: contests.filter((c) => (seen.has(c.id) ? false : seen.add(c.id))),
  };
}

export function formatBytes(n) {
  const value = Number(n) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 密文文件的公开 URL（由 app/private/vault/[file] 路由提供）。
 *
 * `version` 是「用同一个 id 重新 pack 过」的标记：密文响应带长缓存
 * （s-maxage=86400 + SW 缓存），URL 不变就会读到旧密文——用户换了密码
 * 或改了题面后，页面仍按旧密文解密，表现为「密码错误」。所以调用方把
 * 索引里的 createdAt（或任意内容指纹）带上，内容一变 URL 就变。
 */
export function vaultFileHref(id, version = null) {
  const base = `/private/vault/${encodeURIComponent(String(id))}.json`;
  if (!version) return base;
  return `${base}?v=${encodeURIComponent(String(version))}`;
}
