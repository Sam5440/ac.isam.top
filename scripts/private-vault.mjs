#!/usr/bin/env node
/**
 * 私有化平台（platform = private）的入库工具。
 *
 * 全部题目只以密文进仓库：本脚本在本地把明文载荷用 PBKDF2 + AES-256-GCM
 * 加密成 data/private/vault/<id>.json，并维护明文索引 data/private/vault.json。
 * 站点页面（/contests/private/<id>）在访客浏览器里输入密码后才解密。
 *
 * 用法：
 *   # 1) 从「整场题册 HTML」打包（自动抽题面/样例/图片并压缩）
 *   node scripts/private-vault.mjs pack --from-html book.html \
 *     --id ccpc-2026-xiamen --label "CCPC 2026 厦门 · 正式赛" \
 *     --title "第十二届中国大学生程序设计竞赛（厦门）" \
 *     --source https://qoj.ac/contest/4922 --start 2026-11-22T09:00:00+08:00
 *
 *   # 2) 从现成载荷 JSON 打包（自己整理好的题面）
 *   node scripts/private-vault.mjs pack --from-json contest.json --id my-contest
 *
 *   # 3) 查看 / 校验
 *   node scripts/private-vault.mjs list
 *   node scripts/private-vault.mjs verify
 *
 * 密码来源（按优先级）：--password、环境变量 VAULT_PASSWORD、交互输入。
 * 密码**绝不**写进仓库文件；忘记密码 = 该场无法恢复（AES-GCM 无后门）。
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import * as parse5 from 'parse5';

import { parseArgs, writeJson } from './lib/util.mjs';
import { findAll, leftoverHtml, problemSetToPayload } from './lib/problem-set-html.mjs';
import {
  KDF_ITERATIONS,
  VAULT_DIR,
  VAULT_INDEX_FILE,
  decryptVaultEnvelope,
  encryptVaultPayload,
  formatBytes,
  indexEntryOf,
  normalizeVaultIndex,
  normalizeVaultPayload,
  validateVaultPayload,
} from '../lib/private-vault.mjs';

const ROOT = process.cwd();
const VAULT_SUBDIR = path.join(ROOT, VAULT_DIR, 'vault');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function askPassword(args) {
  if (typeof args.password === 'string' && args.password) return args.password;
  if (process.env.VAULT_PASSWORD) return process.env.VAULT_PASSWORD;
  if (!stdin.isTTY) throw new Error('缺少密码：请用 --password 或 VAULT_PASSWORD 环境变量提供');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question('密码（不会回显到文件）：');
  } finally {
    rl.close();
  }
}

/** 页面脚本里的 `const FIG = {…}` 内联图集。 */
export function extractFigureTable(html) {
  const m = /const\s+FIG\s*=\s*(\{[\s\S]*?\});\s*\n/.exec(html);
  if (!m) return {};
  try {
    return JSON.parse(m[1]);
  } catch {
    return {};
  }
}

/** 预先把 FIG 表里所有图片压好（异步），返回同步查表函数。 */
async function buildCompressedFigures(figureTable, maxWidth = 1100, quality = 78) {
  let sharp = null;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    console.warn('[vault] 未安装 sharp：图片原样内联');
  }
  const out = {};
  let before = 0;
  let after = 0;
  for (const [key, src] of Object.entries(figureTable)) {
    if (typeof src !== 'string') continue;
    const m = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/i.exec(src);
    if (!m || !sharp) {
      out[key] = src;
      continue;
    }
    const input = Buffer.from(m[1], 'base64');
    before += input.length;
    try {
      const meta = await sharp(input).metadata();
      const width = Math.min(maxWidth, meta.width ?? maxWidth);
      const buf = await sharp(input)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality, effort: 6 })
        .toBuffer();
      after += buf.length;
      out[key] = `data:image/webp;base64,${buf.toString('base64')}`;
    } catch (err) {
      console.warn(`[vault] 图片 ${key} 压缩失败（保留原图）：${err.message}`);
      after += input.length;
      out[key] = src;
    }
  }
  if (before) {
    console.log(`[vault] 图片 ${Object.keys(figureTable).length} 张：${formatBytes(before)} → ${formatBytes(after)}`);
  }
  return out;
}

async function packFromHtml(args) {
  const file = args.fromHtml;
  const html = fs.readFileSync(path.resolve(ROOT, file), 'utf8');
  const doc = parse5.parse(html);
  const articles = findAll(doc, (n) => n.tagName === 'article'
    && String(n.attrs?.find((a) => a.name === 'class')?.value ?? '').split(/\s+/).includes('problem'));
  if (!articles.length) throw new Error('没有找到 <article class="problem">：这不是题册 HTML？');
  const rawFigures = extractFigureTable(html);
  const figures = await buildCompressedFigures(rawFigures);
  const id = String(args.id ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('--id 只能是小写字母/数字/连字符（1–64 位）');
  const payload = problemSetToPayload(articles, {
    id,
    label: args.label ?? args.title ?? id,
    title: args.title ?? args.label ?? id,
    titleZh: args.titleZh ?? null,
    source: args.source ?? null,
    startTime: args.start ?? null,
    durationSeconds: args.duration ? Number(args.duration) : null,
    note: args.note ?? null,
    figureTable: figures,
  });
  console.log(`[vault] 解析到 ${payload.problems.length} 道题：${payload.problems.map((p) => p.index).join(' ')}`);
  const dirty = payload.problems.filter((p) => leftoverHtml(p.statementMd) || leftoverHtml(p.statementZhMd));
  if (dirty.length) console.warn(`[vault] ⚠ 这些题面仍有未转换的 HTML 标签：${dirty.map((p) => p.index).join(', ')}`);
  return payload;
}

function packFromJson(args) {
  const payload = readJson(path.resolve(ROOT, args.fromJson));
  if (args.id) payload.id = args.id;
  if (args.label) payload.label = args.label;
  if (args.title) payload.title = args.title;
  if (args.source) payload.source = args.source;
  if (args.start) payload.startTime = args.start;
  return payload;
}

async function cmdPack(args) {
  const password = await askPassword(args);
  if (String(password).length < 6) throw new Error('密码至少 6 位（建议 12 位以上）');
  const raw = args.fromHtml ? await packFromHtml(args) : args.fromJson ? packFromJson(args) : null;
  if (!raw) throw new Error('请提供 --from-html <file> 或 --from-json <file>');
  const payload = normalizeVaultPayload(raw);
  const check = validateVaultPayload(payload);
  if (!check.ok) throw new Error(`载荷校验失败：${check.error}`);
  const envelope = await encryptVaultPayload(payload, password, {
    iterations: args.iterations ? Number(args.iterations) : KDF_ITERATIONS,
  });
  fs.mkdirSync(VAULT_SUBDIR, { recursive: true });
  writeJson(path.join(VAULT_SUBDIR, `${payload.id}.json`), envelope);
  // 索引：保留其它场次，按 id 覆盖
  const indexFile = path.join(ROOT, VAULT_INDEX_FILE);
  const old = fs.existsSync(indexFile) ? readJson(indexFile) : { contests: [] };
  const entries = normalizeVaultIndex(old).contests.filter((c) => c.id !== payload.id);
  entries.push(indexEntryOf(envelope));
  entries.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  writeJson(indexFile, {
    format: 'ac-private-index',
    version: 1,
    updatedAt: new Date().toISOString(),
    contests: entries,
  });
  console.log(`[vault] ✓ ${payload.label}`);
  console.log(`[vault]   题目 ${payload.problems.length} 道，密文 ${formatBytes(envelope.bytes)}`);
  console.log(`[vault]   写入 ${path.relative(ROOT, path.join(VAULT_SUBDIR, `${payload.id}.json`))}`);
}

function cmdList() {
  const indexFile = path.join(ROOT, VAULT_INDEX_FILE);
  if (!fs.existsSync(indexFile)) {
    console.log('[vault] 还没有任何私有化比赛');
    return;
  }
  const index = normalizeVaultIndex(readJson(indexFile));
  console.log(`[vault] ${index.contests.length} 场私有化比赛`);
  for (const c of index.contests) {
    console.log(`  - ${c.id.padEnd(24)} ${formatBytes(c.bytes).padStart(9)}  ${c.label}`);
  }
}

async function cmdVerify(args) {
  const indexFile = path.join(ROOT, VAULT_INDEX_FILE);
  const index = normalizeVaultIndex(readJson(indexFile));
  let bad = 0;
  for (const entry of index.contests) {
    const file = path.join(VAULT_SUBDIR, entry.file);
    if (!fs.existsSync(file)) {
      console.error(`✗ ${entry.id}: 索引存在但密文文件缺失`);
      bad++;
      continue;
    }
    const envelope = readJson(file);
    if (envelope.id !== entry.id) {
      console.error(`✗ ${entry.id}: 信封 id 与索引不一致（${envelope.id}）`);
      bad++;
      continue;
    }
    if (args.password || process.env.VAULT_PASSWORD) {
      try {
        const payload = await decryptVaultEnvelope(envelope, args.password ?? process.env.VAULT_PASSWORD);
        const check = validateVaultPayload(payload);
        if (!check.ok) throw new Error(check.error);
        console.log(`✓ ${entry.id}: 解密通过，${payload.problems.length} 道题`);
      } catch (err) {
        console.error(`✗ ${entry.id}: 解密失败（${err.message}）`);
        bad++;
      }
    } else {
      console.log(`✓ ${entry.id}: 结构完整（${formatBytes(entry.bytes)}；加 --password 可验证解密）`);
    }
  }
  if (bad) process.exitCode = 1;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === 'pack') return cmdPack(args);
  if (cmd === 'list') return cmdList();
  if (cmd === 'verify') return cmdVerify(args);
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
  process.exitCode = cmd ? 2 : 0;
}

main().catch((err) => {
  console.error(`[vault] ✗ ${err.message}`);
  process.exitCode = 1;
});
