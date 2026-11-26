/**
 * 私有化平台的服务端读取（只读索引与密文，永远不解密）。
 *
 * 构建期 / Vercel 函数里只有 data/private/vault.json 与密文文件；这里不做
 * 任何解密，密码只存在于访客浏览器。
 */

import fs from 'node:fs';
import path from 'node:path';

import { VAULT_DIR, VAULT_INDEX_FILE, normalizeVaultIndex } from './private-vault.mjs';

const ROOT = process.cwd();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 明文索引（比赛 id / 名称 / 体积 / 时间）。没有文件时返回空索引。 */
export function getVaultIndex() {
  return normalizeVaultIndex(readJson(path.join(ROOT, VAULT_INDEX_FILE)));
}

export function listVaultContests() {
  return getVaultIndex().contests;
}

export function findVaultEntry(id) {
  const key = String(id ?? '').toLowerCase();
  return listVaultContests().find((c) => c.id === key) ?? null;
}

/** 密文信封（原样返回，不解密）。 */
export function getVaultEnvelope(id) {
  const entry = findVaultEntry(id);
  if (!entry) return null;
  return readJson(path.join(ROOT, VAULT_DIR, 'vault', entry.file));
}

/** 私有化平台在比赛列表里占的「一场」占位（用于 /contests 的入口卡片）。 */
export function privateContestSummaries() {
  return listVaultContests().map((c) => ({
    id: c.id,
    platform: 'private',
    title: c.label,
    titleZh: c.label,
    startTime: c.createdAt ?? null,
    problemCount: null,
    locked: true,
    bytes: c.bytes ?? 0,
  }));
}
