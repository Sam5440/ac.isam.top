#!/usr/bin/env node
/**
 * 重译「脏中文题面」（statementZhMd）：用现有翻译管线翻译 statementMd，
 * 只回写 statementZhMd / translatedAt / translateModel 三个字段。
 *
 * 为什么需要它（两类存量脏译文，都是一次性数据修复）：
 *
 *  A) 数学字形重复（约 82 题，命中 U+1D400–U+1D7FF）：旧的 CF 抓取把 MathJax
 *     渲染副产物当正文，英文成了「𝑢n」「3≤𝑛≤503≤n≤50」这种「字形 + ASCII 孪生」
 *     重复串。英文侧已由 scripts/repair-statement-math.mjs 从抓取端重抓修好
 *     （见 AGENTS.md §3.8 第 19 条），但按约定没动中文译文 —— 于是译文里永久
 *     留着重复字形。重译（源 = 干净英文）即可根治。
 *
 *  B) 英文代码块被逐字抄进中文（atcoder）：旧英文里一段本该是正文的内容被解析成
 *     围栏代码块（块内是裸 TeX，如 \leq），翻译管线按「代码块原样保留」的规则
 *     整块抄了下来 —— 中文模式下看到的是英文源码。重译（源 = 已修复的英文，
 *     围栏已不存在）即可根治。
 *
 * 写盘口径与 scripts/fetch.mjs 的 runTranslate 完全一致：
 *   只改 statementZhMd / translatedAt / translateModel；
 *   不覆盖 titleZh（沿用现有值）、不动 statementMd、不动 samples、不动其它字段；
 *   写 JSON 走 scripts/lib/util.mjs 的 writeJson（tmp + rename 原子写）。
 *
 * 用法：
 *   node scripts/retranslate-statements.mjs --stats                 # 只枚举目标（不联网）
 *   node scripts/retranslate-statements.mjs --dry-run --limit 1     # 调 LLM 但不写盘，打印前 300 字
 *   node scripts/retranslate-statements.mjs --limit 25              # 分批回写（可续跑）
 *   node scripts/retranslate-statements.mjs --only codeforces/1053A,cf-gyms/104869a
 *   node scripts/retranslate-statements.mjs --concurrency 2         # 默认 2，别把接口打满
 *   node scripts/retranslate-statements.mjs --force                 # 忽略断点状态重跑已完成的
 *   node scripts/retranslate-statements.mjs --bare-rule fence-not-in-en  # (b) 判定口径，见下
 *
 * 断点状态：data/.retranslate-state.json（机器本地状态，不入库 —— 若 .gitignore
 * 里还没有对应条目，脚本只告警，不自己改 .gitignore）。
 *
 * 并发写盘注意：本脚本每次都「写前重读文件 + 只合并三个字段」，且发现 statementMd
 * 在枚举之后被别的进程改过（例如另一 agent 的重抓 pass2）就跳过该题（记 stale），
 * 避免把基于旧英文算出的译文写进新英文的记录里。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { llmConfig, pingLLM, translateStatement } from './lib/llm.mjs';
import { loadEnv, log, parseArgs, pLimit, readJson, writeJson } from './lib/util.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PLATFORMS = ['atcoder', 'codeforces', 'nowcoder', 'cf-gyms'];

/** (a) MathJax 字形树产物：U+1D400–U+1D7FF（数学字母数字符号）。 */
const GLYPH_RE = /[\u{1D400}-\u{1D7FF}]/u;
/** 裸 TeX 命令：\leq / \vdots / \ldots …（去公式/去围栏后再判）。 */
const BARE_TEX_RE = /\\[a-zA-Z]{2,}/;
/** 围栏代码块（三反引号 + 可选语言 + 换行 … 三反引号）。 */
const FENCE_RE = /```[\w-]*\n([\s\S]*?)```/g;
/** 「一段英文散文」：连续 3 个英文单词（输入格式块里的变量名不会有）。 */
const PROSE_RE = /[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}/;
/** 回写后长度下限（相对旧译文）：防截断/防只拿到半截输出。 */
const MIN_LEN_RATIO = 0.6;

const STATE_FILE = path.join(ROOT, 'data/.retranslate-state.json');

const args = parseArgs(process.argv.slice(2));
const DRY_RUN = Boolean(args.dryRun);
const CONCURRENCY = Math.max(1, Number(args.concurrency ?? 2) || 2);
const BARE_RULE = String(args.bareRule ?? 'prose');

/* ---------------- 文本工具 ---------------- */

function stripMath(md) {
  return String(md)
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\$[^$]*\$/g, '');
}

function fencesOf(md) {
  return [...String(md).matchAll(FENCE_RE)].map((m) => m[1]);
}

function stripFences(md) {
  return String(md).replace(FENCE_RE, '');
}

/** 去掉「含裸 TeX + 英文散文」的围栏块（= 被逐字抄进中文的英文正文）。 */
function dropCopiedFences(md) {
  return String(md).replace(FENCE_RE, (all, body) =>
    BARE_TEX_RE.test(body) && PROSE_RE.test(body) ? '' : all,
  );
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const oneLine = (s, n) => norm(s).slice(0, n);

/**
 * (b) 判定口径。AtCoder 的输入格式围栏里本来就写着 \vdots / \ldots（英文同款），
 * 所以「去掉 $…$ 后还有 \cmd」这条字面口径会命中 1300+ 题（都是正常题面）；
 * 默认口径是「围栏里同时有裸 TeX 与英文散文」= 确实被逐字抄下来的英文正文。
 * --stats 会把四种口径的数字都打出来，选哪个由操作者定。
 */
const BARE_RULES = {
  /** 字面口径：去掉 $…$ 后仍有 \cmd（最宽，含 AtCoder 输入块里的正常 TeX）。 */
  all: (zh) => BARE_TEX_RE.test(stripMath(zh)),
  /** 去掉 $…$ 与围栏后仍有 \cmd（围栏内的正常 TeX 不算）。 */
  'outside-fence': (zh) => BARE_TEX_RE.test(stripFences(stripMath(zh))),
  /** 围栏整块在「当前英文的围栏集合」里找不到（旧英文遗留的块）。 */
  'fence-not-in-en': (zh, en) => {
    const enFences = new Set(fencesOf(en).map(norm));
    return fencesOf(zh).some((b) => BARE_TEX_RE.test(b) && !enFences.has(norm(b)));
  },
  /** 围栏里同时有裸 TeX 与英文散文 = 英文正文被抄进围栏（默认）。 */
  prose: (zh) => fencesOf(zh).some((b) => BARE_TEX_RE.test(b) && PROSE_RE.test(b)),
};

/* ---------------- 枚举 ---------------- */

/**
 * 扫描 data/<platform>/problems/*.json，返回命中 (a) 或 (b) 的记录。
 * 判据只用 statementZhMd（不重抓、不联网）；statementMd 为空的无从重译，跳过。
 */
function enumerate(rule = BARE_RULE) {
  const bareCheck = BARE_RULES[rule] ?? BARE_RULES.prose;
  const out = [];
  for (const platform of PLATFORMS) {
    const dir = path.join(ROOT, 'data', platform, 'problems');
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      const file = path.join(dir, name);
      let data;
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      const zh = typeof data.statementZhMd === 'string' ? data.statementZhMd : '';
      const en = typeof data.statementMd === 'string' ? data.statementMd : '';
      if (!zh.trim() || !en.trim()) continue;
      const reasons = [];
      if (GLYPH_RE.test(zh)) reasons.push('glyph');
      // (b) 只对 atcoder 生效（任务口径：atcoder 题面把旧英文代码块抄进了中文）
      if (platform === 'atcoder' && bareCheck(zh, en)) reasons.push('bare-fence');
      if (!reasons.length) continue;
      const id = String(data.id ?? name.replace(/\.json$/, ''));
      out.push({
        platform,
        id,
        key: platform + '/' + id,
        file,
        data,
        reasons,
        oldZh: zh,
      });
    }
  }
  out.sort(
    (a, b) =>
      a.platform.localeCompare(b.platform) || a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  return out;
}

/* ---------------- 校验 ---------------- */

/**
 * 写盘前校验（不满足就跳过并记 skip，别硬写）：
 *   非空 / 长度 ≥ 旧值 60% / 无 U+1D400 区字形 / 去公式与围栏后无裸 TeX /
 *   含中文 / (b) 目标的「英文围栏被抄」必须消失。
 */
function validate(rec, newZh) {
  const reasons = [];
  if (typeof newZh !== 'string' || !newZh.trim()) return { ok: false, reasons: ['empty'], ratio: 0 };
  // 长度基准：(b) 目标要扣掉「被抄进围栏的英文正文」——那是即将消失的部分，
  // 按原长算 60% 会把正常缩水（英文块换成一行中文）误判成截断。
  const baseline = rec.reasons.includes('bare-fence') ? dropCopiedFences(rec.oldZh) : rec.oldZh;
  const oldLen = baseline.length;
  const ratio = oldLen ? newZh.length / oldLen : 1;
  if (oldLen && ratio < MIN_LEN_RATIO) reasons.push('too-short:' + Math.round(ratio * 100) + '%');
  if (GLYPH_RE.test(newZh)) reasons.push('still-glyphs');
  const bare = stripFences(stripMath(newZh)).match(BARE_TEX_RE);
  if (bare) reasons.push('bare-tex-outside-math:' + bare[0]);
  if (!/[\u4e00-\u9fff]/.test(newZh)) reasons.push('no-cjk');
  if (rec.reasons.includes('bare-fence')) {
    const copied = fencesOf(newZh).filter((b) => BARE_TEX_RE.test(b) && PROSE_RE.test(b));
    if (copied.length) reasons.push('english-fence-kept');
  }
  return { ok: reasons.length === 0, reasons, ratio };
}

/* ---------------- 断点状态 ---------------- */

const state = readJson(STATE_FILE) ?? { updatedAt: null, records: {} };
if (!state.records || typeof state.records !== 'object') state.records = {};
const isDone = (rec) => !args.force && state.records[rec.key]?.status === 'ok';

function saveState(rec, patch) {
  state.records[rec.key] = { at: new Date().toISOString(), ...patch };
  state.updatedAt = new Date().toISOString();
  if (!DRY_RUN) writeJson(STATE_FILE, state);
}

/** 状态文件是否被 git 忽略（没有就只告警，绝不自己改 .gitignore）。 */
function gitIgnoreStatus() {
  try {
    execFileSync('git', ['check-ignore', '-q', STATE_FILE], { cwd: ROOT, stdio: 'ignore' });
    return 'ignored';
  } catch (e) {
    return e?.status === 1 ? 'tracked' : 'unknown';
  }
}

/* ---------------- 写盘 ---------------- */

/**
 * 只改三个字段，且写前重读：并发场景（另一 agent 正在重抓 statementMd）下
 * 既不会丢别人的更新，也不会把基于旧英文算出的译文写进新英文的记录。
 * 返回 { ok, reason }。
 */
function writeBack(rec, bodyZh, model) {
  const fresh = readJson(rec.file);
  if (!fresh) return { ok: false, reason: 'reread-failed' };
  if (String(fresh.statementMd ?? '') !== String(rec.data.statementMd ?? '')) {
    return { ok: false, reason: 'en-changed' };
  }
  writeJson(rec.file, {
    ...fresh,
    statementZhMd: bodyZh,
    translatedAt: new Date().toISOString(),
    translateModel: model,
  });
  return { ok: true };
}

/* ---------------- 统计输出 ---------------- */

function printStats() {
  const base = enumerate(BARE_RULE);
  console.log('=== 重译目标（(a) 字形 ∪ (b) 裸 TeX，并集去重）===');
  console.log('口径: (a) statementZhMd 命中 U+1D400–U+1D7FF；(b) atcoder 的 --bare-rule=' + BARE_RULE);

  const glyph = base.filter((r) => r.reasons.includes('glyph'));
  const bareOnly = base.filter((r) => r.reasons.includes('bare-fence') && !r.reasons.includes('glyph'));
  const byPlat = {};
  for (const r of base) {
    byPlat[r.platform] ??= { total: 0, glyph: 0, bare: 0 };
    byPlat[r.platform].total++;
    if (r.reasons.includes('glyph')) byPlat[r.platform].glyph++;
    if (r.reasons.includes('bare-fence')) byPlat[r.platform].bare++;
  }
  console.log('合计 ' + base.length + ' 条（(a) 字形 ' + glyph.length + ' / (b) 裸 TeX ' + bareOnly.length + '）');
  for (const [p, v] of Object.entries(byPlat)) {
    console.log('  ' + p + ': ' + v.total + '（a ' + v.glyph + ' / b ' + v.bare + '）');
  }

  console.log('--- (a) 字形题清单 ---');
  for (const p of PLATFORMS) {
    const ids = base.filter((r) => r.platform === p && r.reasons.includes('glyph')).map((r) => r.id);
    if (ids.length) console.log('  ' + p + ' (' + ids.length + '): ' + ids.join(' '));
  }
  console.log('--- (b) 裸 TeX 题清单（当前口径）---');
  for (const p of PLATFORMS) {
    const ids = base
      .filter((r) => r.platform === p && r.reasons.includes('bare-fence') && !r.reasons.includes('glyph'))
      .map((r) => r.id);
    if (ids.length) console.log('  ' + p + ' (' + ids.length + '): ' + ids.join(' '));
  }

  console.log('=== (b) 判定口径对比（只 atcoder；换口径用 --bare-rule）===');
  for (const rule of Object.keys(BARE_RULES)) {
    const recs = enumerate(rule).filter((r) => r.reasons.includes('bare-fence'));
    const g = recs.filter((r) => r.reasons.includes('glyph')).length;
    console.log(
      '  ' + rule.padEnd(16) + ': atcoder ' + recs.length + ' 条（其中同时字形脏 ' + g + '）' +
        (rule === BARE_RULE ? '   <= 当前' : ''),
    );
  }

  const done = base.filter((r) => state.records[r.key]?.status === 'ok');
  const failed = base.filter((r) => state.records[r.key] && state.records[r.key].status !== 'ok');
  console.log('断点状态 ' + path.relative(ROOT, STATE_FILE) + '：已完成 ' + done.length + '，记过跳过/失败 ' + failed.length);
  if (done.length) console.log('  已完成: ' + done.map((r) => r.key).join(' '));
  if (failed.length) console.log('  待重试: ' + failed.map((r) => r.key + '(' + state.records[r.key].status + ')').join(' '));
  const gi = gitIgnoreStatus();
  if (gi === 'tracked') {
    console.log('⚠ 状态文件未被 .gitignore 忽略 —— 请人工补一条 ' + path.relative(ROOT, STATE_FILE) + '（本脚本不自己改 .gitignore）');
  } else if (gi === 'ignored') {
    console.log('状态文件已被 .gitignore 忽略 ✓');
  }
  console.log('');
}

/* ---------------- 主流程 ---------------- */

/** --reason：只保留命中指定问题类的记录（glyph = (a) 字形脏；bare-fence = (b) 英文块被抄），
 *  逗号分隔可多选。用于「先跑完 (a) 再跑 (b)」这种分批节奏。 */
function filterReason(list) {
  if (!args.reason) return list;
  const want = String(args.reason)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.filter((r) => want.some((w) => r.reasons.includes(w)));
}

/** --only：接受 platform/id、裸 id（不区分大小写；裸 id 命中多平台时全选）。 */
function filterOnly(list) {
  if (!args.only) return list;
  const want = new Set(
    String(args.only)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return list.filter((r) => want.has(r.key.toLowerCase()) || want.has(r.id.toLowerCase()));
}

async function main() {
  loadEnv(ROOT);

  if (args.stats) {
    printStats();
    return;
  }

  const all = enumerate(BARE_RULE);
  const picked = filterOnly(filterReason(all));
  const queue = picked.filter((r) => !isDone(r));
  const limit = args.limit != null ? Math.max(1, Number(args.limit)) : Infinity;
  const batch = queue.slice(0, limit);

  log(
    'retranslate',
    '目标 ' + all.length + '（a 字形 ' + all.filter((r) => r.reasons.includes('glyph')).length +
      ' / b 裸 TeX ' + all.filter((r) => r.reasons.includes('bare-fence')).length +
      '），--only/--reason 命中 ' + picked.length + '，断点跳过 ' + (picked.length - queue.length) +
      '，本轮 ' + batch.length + '，并发 ' + CONCURRENCY +
      (DRY_RUN ? '，DRY-RUN（不写盘）' : '，写盘'),
  );
  if (!batch.length) {
    log('retranslate', '没有要处理的题（--force 可重跑已完成的）');
    return;
  }

  const cfg = llmConfig();
  if (!cfg) throw new Error('未配置 TRANSLATE_BASE_URL / TRANSLATE_API_KEY（.env.local）');
  log('retranslate', '模型 ' + cfg.model + ' @ ' + cfg.baseUrl);
  // 与 fetch.mjs 一致：先探活，401/403 直接中止整轮（Key 失效时别打满无效请求）
  try {
    await pingLLM(cfg);
    log('retranslate', '探活通过');
  } catch (e) {
    if (/HTTP 40[13]/.test(e.message)) {
      throw new Error('TRANSLATE_API_KEY 无效（' + e.message.slice(0, 140) + '）——轮换后重跑，本轮中止');
    }
    log('retranslate', '⚠ 探活未通过（' + e.message.slice(0, 140) + '），按临时故障继续逐题翻译');
  }

  let authAborted = false;
  const results = [];
  let finished = 0;
  const limitPool = pLimit(CONCURRENCY);

  await Promise.all(
    batch.map((rec, i) =>
      limitPool(async () => {
        const tag = '[' + (i + 1) + '/' + batch.length + '] ' + rec.key;
        if (authAborted) {
          results.push({ rec, status: 'failed', reason: '鉴权失败，剩余任务跳过' });
          return;
        }
        try {
          const { titleZh, bodyZh } = await translateStatement(cfg, {
            title: rec.data.title || rec.id,
            statementMd: rec.data.statementMd,
          });
          const check = validate(rec, bodyZh);
          if (DRY_RUN) {
            console.log('--- ' + rec.key + ' [dry-run] 新 titleZh（不入库）=' + norm(titleZh || '') + ' ---');
            console.log('旧译文: ' + oneLine(rec.oldZh, 300));
            console.log('新译文: ' + oneLine(bodyZh, 300));
            console.log(
              '校验: ' + (check.ok ? 'ok' : 'SUSPECT ' + check.reasons.join(';')) +
                ' 长度 ' + rec.oldZh.length + '→' + bodyZh.length,
            );
            results.push({
              rec,
              status: check.ok ? 'ok' : 'skipped',
              reasons: check.reasons,
              oldZh: rec.oldZh,
              newZh: bodyZh,
            });
          } else if (!check.ok) {
            saveState(rec, { status: 'skip', reasons: check.reasons });
            log('retranslate', tag + ' SKIP ' + check.reasons.join(';'));
            results.push({ rec, status: 'skipped', reasons: check.reasons, oldZh: rec.oldZh, newZh: bodyZh });
          } else {
            const w = writeBack(rec, bodyZh, cfg.model);
            if (!w.ok) {
              saveState(rec, { status: 'skip', reasons: [w.reason] });
              log('retranslate', tag + ' SKIP ' + w.reason);
              results.push({ rec, status: 'skipped', reasons: [w.reason] });
            } else {
              saveState(rec, { status: 'ok', oldLen: rec.oldZh.length, newLen: bodyZh.length, model: cfg.model });
              log(
                'retranslate',
                tag + ' OK ' + rec.oldZh.length + '→' + bodyZh.length + ' (' + Math.round(check.ratio * 100) + '%)',
              );
              results.push({ rec, status: 'ok', oldZh: rec.oldZh, newZh: bodyZh, ratio: check.ratio });
            }
          }
        } catch (e) {
          saveState(rec, { status: 'fail', reason: String(e).slice(0, 160) });
          log('retranslate', tag + ' FAIL ' + String(e).slice(0, 160));
          results.push({ rec, status: 'failed', reason: String(e).slice(0, 160) });
          if (/HTTP 40[13]/.test(e.message)) {
            authAborted = true;
            log('retranslate', '✗ 鉴权失败（401/403），中止本轮剩余翻译');
          }
        } finally {
          finished++;
          if (finished % 10 === 0 || finished === batch.length) {
            log('retranslate', '进度 ' + finished + '/' + batch.length);
          }
        }
      }),
    ),
  );

  const count = (s) => results.filter((r) => r.status === s).length;
  log(
    'retranslate',
    '本轮结束：成功 ' + count('ok') + ' / 跳过 ' + count('skipped') + ' / 失败 ' + count('failed') +
      (DRY_RUN ? '（DRY-RUN，未写盘）' : ''),
  );
  const skipped = results.filter((r) => r.status === 'skipped');
  if (skipped.length) {
    console.log('跳过清单：');
    for (const r of skipped) console.log('  - ' + r.rec.key + ': ' + (r.reasons ?? []).join(';'));
  }
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length) {
    console.log('失败清单：');
    for (const r of failed) console.log('  - ' + r.rec.key + ': ' + r.reason);
  }

  // 前后对照抽样：成功的优先，最多 5 条
  const samples = results
    .filter((r) => r.oldZh && r.newZh)
    .sort((a, b) => (a.status === 'ok' ? 0 : 1) - (b.status === 'ok' ? 0 : 1))
    .slice(0, 5);
  if (samples.length) {
    console.log('=== 前后对照抽样（' + samples.length + ' 条）===');
    for (const r of samples) {
      console.log('* ' + r.rec.key + ' [' + r.status + ']');
      console.log('  旧: ' + oneLine(r.oldZh, 160));
      console.log('  新: ' + oneLine(r.newZh, 160));
    }
  }
  if (authAborted) process.exitCode = 1;
}

// 导出内部函数只为本机验证（例：对 .cache/ 下的临时副本试跑写盘合并逻辑）；
// 正常用法一律走 CLI。直接执行本文件时才跑 main()。
export { BARE_RULES, enumerate, validate, writeBack };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
