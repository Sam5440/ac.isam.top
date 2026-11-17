#!/usr/bin/env node
/**
 * 修复「MathJax 字形重复」脏题面（statementMd）。
 *
 * 背景：旧版 html2md 把 MathJax 的渲染生成物（<nobr aria-hidden> 字形树 + MathML
 * 副本）当普通文本抽取，而保存原始 TeX 的 <script type="math/tex"> 被整段丢弃 ——
 * 于是题面里的数学变成「𝑢n」「3≤𝑛≤503≤n≤50」这种 unicode 字形 + ASCII 各一份的
 * 重复文本，TeX 全丢（生产示例 /problems/cf-gyms/104869b）。
 *
 * 抓取端修复（scripts/lib/html2md.mjs 现在读 script[type=math/tex] 的原始 TeX、
 * 跳过 MathJax 生成物；未渲染的页面本来就有字面 $$$…$$$）之后，重抓同一题面即可
 * 拿回干净的 $…$。本脚本只做「重抓 + 校验 + 只回写 statementMd/fetchedAt」，
 * 其余字段（尤其已经翻好的 statementZhMd）原样保留。
 *
 * 用法：
 *   node scripts/repair-statement-math.mjs --stats                      # 只枚举脏题（不联网）
 *   node scripts/repair-statement-math.mjs --dry-run --limit 3          # 试跑 3 题，不写盘
 *   node scripts/repair-statement-math.mjs --limit 25                   # 分批回写（可续跑）
 *   node scripts/repair-statement-math.mjs --only 104869b,1053a         # 指定题
 *   node scripts/repair-statement-math.mjs --all                        # 忽略断点状态重跑
 *   node scripts/repair-statement-math.mjs --sleep 18000                # 固定页间间隔（默认 12-25s 随机）
 *   node scripts/repair-statement-math.mjs --dump-html /tmp/cf-repair   # 存原始 HTML 供复现
 *   node scripts/repair-statement-math.mjs --persistent --limit 25       # 真实 Chrome + 持久 profile（过 CF 质询）
 *
 * 纪律（照 scripts/fetch-cf-gyms.mjs）：串行、页间 12-25s 随机、Cloudflare 质询
 * 轮询等待（每 45s reload）+ 单题最多 3 次、连续 2 次质询 → 全局冷却 5-10min。
 * 禁止并发打 CF。断点状态写 data/cf-gyms/.repair-state.json（机器本地状态，不入库）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { fetchAtCoderStatement, atcoderProblemUrl } from './lib/atcoder.mjs';
import { closeCfBrowser, getCfPage, parseCfProblemsPage } from './lib/cf.mjs';
import { fetchNowcoderStatement, nowcoderProblemUrl } from './lib/nowcoder.mjs';
import { log, parseArgs, readJson, rnd, sleep, writeJson } from './lib/util.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CF = 'https://codeforces.com';

/** 脏判定口径：题面里出现 U+1D400–U+1D7FF（数学字母数字符号 = MathJax 字形树产物）。 */
const MATH_GLYPH_RE = /[\u{1D400}-\u{1D7FF}]/u;
/** Cloudflare 质询页特征（与 fetch-cf-gyms.mjs 一致）。 */
const CHALLENGE_RE = /Just a moment|cf-challenge/i;
const MAX_ATTEMPTS = 3;
/** 单次导航内等质询通过的上限（真实 Chromium 通常数秒到数十秒自动过）。 */
const CHALLENGE_WAIT_MS = 180000;
const RELOAD_EVERY_MS = 45000;
/** 回写前「裸 TeX 残留」判定：去掉 $…$ / $$…$$ 后不应再有 \command。 */
const BARE_TEX_RE = /\\[a-zA-Z]{2,}/g;
/** 长度下限：防止抓到门禁页/半截 DOM。 */
const MIN_LEN_RATIO = 0.5;
/** 同题身份校验：旧题面的英文词（≥4 字母）至少有这个比例出现在新题面里。 */
const MIN_WORD_OVERLAP = 0.5;

const STATE_FILE = path.join(ROOT, 'data/cf-gyms/.repair-state.json');

/**
 * 平台表。
 *  - pass1：参与「数学字形脏」枚举（第一遍只跑 CF 两个平台）
 *  - target：新题面写回哪个字段（CF/AtCoder = statementMd；牛客官方中文 = statementZhMd）
 *  - fetch：给了就走纯 HTTP 抓取函数（AtCoder / 牛客），不给就走 Playwright + CF 反爬
 */
const PLATFORMS = [
  {
    platform: 'cf-gyms',
    dir: 'data/cf-gyms/problems',
    pass1: true,
    target: 'statementMd',
    url: (cid, index) => CF + '/gym/' + cid + '/problem/' + index,
    base: (cid, index) => CF + '/gym/' + cid + '/problem/' + index,
  },
  {
    platform: 'codeforces',
    dir: 'data/codeforces/problems',
    pass1: true,
    target: 'statementMd',
    url: (cid, index) => CF + '/contest/' + cid + '/problem/' + index,
    base: (cid, index) => CF + '/contest/' + cid + '/problem/' + index,
  },
  {
    // AtCoder 的题面页 task id 是完整 id（abc100_c），不是 index（C）
    platform: 'atcoder',
    dir: 'data/atcoder/problems',
    pass1: false,
    target: 'statementMd',
    url: (cid, index, rec) => atcoderProblemUrl(cid, rec.id),
    fetch: async (rec) => {
      const st = await fetchAtCoderStatement(rec.contestId, rec.id);
      return { statementMd: st.statementMd, samples: st.samples };
    },
  },
  {
    // 牛客题面是官方中文：抓回来的文本写 statementZhMd，不动 statementMd
    platform: 'nowcoder',
    dir: 'data/nowcoder/problems',
    pass1: false,
    target: 'statementZhMd',
    url: (cid, index) => nowcoderProblemUrl(cid, index),
    fetch: async (rec) => {
      const st = await fetchNowcoderStatement(rec.contestId, rec.index);
      return { statementMd: st.statementMd, samples: st.samples };
    },
  },
];

const args = parseArgs(process.argv.slice(2));
const platOf = (name) => PLATFORMS.find((p) => p.platform === name);

/* ---------------- 枚举 ---------------- */

/** 两个平台的 problems 目录 → 脏题清单（statementMd 命中数学字形）。 */
function listDirty() {
  const out = [];
  for (const plat of PLATFORMS) {
    if (!plat.pass1) continue;
    const dir = path.join(ROOT, plat.dir);
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json') || file.startsWith('.')) continue;
      const full = path.join(dir, file);
      let data;
      try {
        data = JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch {
        continue;
      }
      const md = data.statementMd;
      if (typeof md !== 'string' || !MATH_GLYPH_RE.test(md)) continue;
      const id = String(data.id ?? path.basename(file, '.json'));
      const index = String(data.index ?? id.replace(/^\d+/, '')).toUpperCase();
      const contestId = data.contestId ?? Number(id.replace(/[A-Za-z].*$/, ''));
      out.push({
        platform: plat.platform,
        file: full,
        data,
        id,
        contestId,
        index,
        oldMd: md,
        zhDirty: MATH_GLYPH_RE.test(String(data.statementZhMd ?? '')),
      });
    }
  }
  out.sort(
    (a, b) =>
      a.platform.localeCompare(b.platform) ||
      Number(a.contestId) - Number(b.contestId) ||
      a.index.localeCompare(b.index),
  );
  return out;
}

/**
 * --ids-file：补充遍（第二遍）的清单加载器。
 *
 * 目标不再是「数学字形脏」的题，而是渲染层兜不住的历史脏数据（可见 \le 命令、
 * 表格被拍平成 & \hline 残渣、\begin{array} 丢定界符……）。清单由外部产出，
 * 元素可以是 { id: 'platform/id' }、'platform/id' 或裸 id（裸 id 两个平台都查）。
 * 这些题不参与「必须命中字形脏判定」的筛选；记录本身仍从 data/ 读，抓取/校验/
 * 回写流程完全复用（只回写 statementMd/fetchedAt）。
 */
function loadRecordsFromIdsFile(file) {
  const list = readJson(file);
  if (!Array.isArray(list)) throw new Error('--ids-file 需要一个 JSON 数组：' + file);
  const dirs = PLATFORMS.map((p) => ({ platform: p.platform, dir: path.join(ROOT, p.dir) }));
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const spec = typeof item === 'string' ? item : String(item?.id ?? '');
    if (!spec) continue;
    let platform = null;
    let bare = spec;
    const slash = spec.indexOf('/');
    if (slash > 0) {
      platform = spec.slice(0, slash);
      bare = spec.slice(slash + 1);
    }
    const cands = platform ? dirs.filter((d) => d.platform === platform) : dirs;
    let found = null;
    for (const d of cands) {
      const full = path.join(d.dir, String(bare).toLowerCase() + '.json');
      if (fs.existsSync(full)) {
        found = { platform: d.platform, file: full };
        break;
      }
    }
    if (!found) {
      log('repair', 'ids-file 里查不到这条记录，跳过：' + spec);
      continue;
    }
    if (seen.has(found.file)) continue;
    seen.add(found.file);
    const data = JSON.parse(fs.readFileSync(found.file, 'utf8'));
    const id = String(data.id ?? bare);
    out.push({
      platform: found.platform,
      file: found.file,
      data,
      id,
      contestId: data.contestId ?? Number(id.replace(/[A-Za-z].*$/, '')),
      index: String(data.index ?? id.replace(/^\d+/, '')).toUpperCase(),
      oldMd: typeof data.statementMd === 'string' ? data.statementMd : '',
      zhDirty: MATH_GLYPH_RE.test(String(data.statementZhMd ?? '')),
      pass2: true,
    });
  }
  return out;
}

/* ---------------- 校验 ---------------- */

/** 去掉 $…$ / $$…$$ 公式片段（先块级后行内）。 */
function stripMath(md) {
  return String(md)
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\$[^$]*\$/g, '');
}

/** 英文词集合（≥4 字母），用于「是不是同一道题」的身份校验。 */
function wordsOf(md) {
  return new Set((String(md).toLowerCase().match(/[a-z]{4,}/g) || []));
}

/**
 * 回写前校验：脏字形清零、无裸 TeX 残留、长度同量级、至少含 1 个公式、
 * 与旧题面的英文词高度重合（防串题/防抓到别的页面）。
 * opts.requireFormula=false 用于旧题面本来就没有公式的补充遍（--ids-file）。
 * 返回 { ok, reasons, ratio, overlap }。
 */
function validate(oldMd, newMd, opts = {}) {
  const reasons = [];
  const oldLen = String(oldMd ?? '').length;
  const requireFormula = opts.requireFormula !== false;
  if (typeof newMd !== 'string' || !newMd.trim()) return { ok: false, reasons: ['empty'], ratio: 0, overlap: 0 };
  if (MATH_GLYPH_RE.test(newMd)) reasons.push('still-math-glyphs');
  const bare = stripMath(newMd).match(BARE_TEX_RE) || [];
  if (bare.length) reasons.push('bare-tex:' + [...new Set(bare)].slice(0, 5).join(','));
  if (/mjx-container|MathJax_Preview|class="MathJax"/.test(newMd)) reasons.push('mathjax-artifact');
  // 旧题面为空（PDF 提取文本/存根）时无从比较长度，跳过长度检查
  const ratio = oldLen ? newMd.length / oldLen : 1;
  if (oldLen && ratio < MIN_LEN_RATIO) reasons.push('too-short:' + Math.round(ratio * 100) + '%');
  if (requireFormula && !newMd.includes('$')) reasons.push('no-formula');

  const ow = wordsOf(oldMd);
  const nw = wordsOf(newMd);
  let hit = 0;
  for (const w of ow) if (nw.has(w)) hit++;
  const overlap = ow.size ? hit / ow.size : 1;
  // 旧题面英文词太少（纯公式题）时这条不适用
  if (ow.size >= 20 && overlap < MIN_WORD_OVERLAP) reasons.push('low-word-overlap:' + Math.round(overlap * 100) + '%');

  return { ok: reasons.length === 0, reasons, ratio, overlap };
}

/* ---------------- 抓取会话（串行 + 反爬） ---------------- */

let session = null;
let consecutiveChallengedAttempts = 0;
let cooldowns = 0;
let pageChallenges = 0;

/**
 * 真实 Chrome + 持久 profile 的会话（--persistent）。
 *
 * 为什么需要它：scripts/lib/cf.mjs 的 getCfPage() 走 Playwright 的
 * chromium_headless_shell，CF 的 Turnstile 在 headless shell 里过不去 ——
 * 实测同一 context 第 2 次导航就被质询，且 3 分钟内不自愈（整批会卡死）。
 * fetch-cf-gyms.mjs 的生产做法也是「真实 Chrome/有头 + 持久 profile」，
 * 这里照抄同一思路（本地有 GUI，CF_HEADLESS=1 时仍可退回 headless）。
 * 解析链路不受影响，仍是 cf.mjs 的 parseCfProblemsPage。
 */
async function launchPersistent() {
  const { chromium } = await import('playwright');
  const dir = typeof args.profile === 'string' ? args.profile : path.join(ROOT, '.cache', 'repair-cf-browser');
  fs.mkdirSync(dir, { recursive: true });
  const headless = process.env.CF_HEADLESS === '1';
  const baseOpts = {
    headless,
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    timezoneId: 'UTC',
    args: ['--disable-blink-features=AutomationControlled'],
  };
  const channel = process.env.CF_BROWSER_CHANNEL || 'chrome';
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(dir, { ...baseOpts, channel });
  } catch (e) {
    log('repair', '真实 Chrome 启动失败（' + String(e).slice(0, 90) + '），退回 Playwright Chromium');
    ctx = await chromium.launchPersistentContext(dir, baseOpts);
  }
  // 图片/字体/媒体不参与解析，直接掐掉（脚本/样式放行，质询页要渲染）
  await ctx.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'font' || t === 'media') return route.abort();
    return route.continue();
  });
  const page = await ctx.newPage();
  log('repair', '浏览器 persistent profile=' + dir + ' channel=' + channel + ' headless=' + headless);
  return { page, ctx };
}

async function ensureSession() {
  if (session) return session;
  session = args.persistent ? await launchPersistent() : await getCfPage();
  return session;
}

async function dropSession() {
  const s = session;
  session = null;
  try {
    await s?.ctx?.close();
  } catch {}
}

const betweenSleepMs = () => (args.sleep != null ? Number(args.sleep) : rnd(12000, 25000));

/** 连续质询 → 全局冷却 5-10min 并换新会话（新会话重新走一遍 clearance）。 */
async function globalCooldown() {
  cooldowns++;
  const waitMs = rnd(5, 10) * 60000;
  log('repair', '连续 Cloudflare 质询 → 全局冷却 ' + Math.round(waitMs / 60000) + 'min（第 ' + cooldowns + ' 次）');
  await dropSession();
  await sleep(waitMs);
  await ensureSession();
}

function dumpHtml(id, html) {
  if (!args.dumpHtml || typeof args.dumpHtml !== 'string') return;
  try {
    fs.mkdirSync(args.dumpHtml, { recursive: true });
    fs.writeFileSync(path.join(args.dumpHtml, id + '.html'), html);
  } catch {}
}

/**
 * 抓单题并解析：goto(domcontentloaded) → 轮询到 div.problem-statement 可解析。
 * 不等 MathJax（渲染与否都能解析：未渲染是字面 $$$…$$$，渲染后走 script[type=math/tex]）。
 * 质询页不是立刻放弃：轮询等待 + 每 45s reload，单次导航最多等 CHALLENGE_WAIT_MS；
 * 一次导航失败才算「质询 1 次」，连续 2 次才全局冷却。
 * 返回 { status: 'ok', statementMd, samples } | { status: 'fail', reason }。
 */
async function fetchStatement(rec) {
  const plat = platOf(rec.platform);
  const url = plat.url(rec.contestId, rec.index, rec);
  // AtCoder / 牛客：scripts/lib 里已有现成的纯 HTTP 抓取函数，不需要浏览器
  if (typeof plat.fetch === 'function') {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const got = await plat.fetch(rec);
        if (got && String(got.statementMd ?? '').trim()) {
          return { status: 'ok', statementMd: got.statementMd, samples: got.samples, url };
        }
        return { status: 'fail', reason: 'empty statement', url };
      } catch (e) {
        const reason = String(e).slice(0, 160);
        log('repair', rec.id + ' fetch attempt ' + attempt + ' error: ' + reason);
        if (attempt === MAX_ATTEMPTS) return { status: 'fail', reason, url };
        await sleep(rnd(3000, 6000));
      }
    }
  }
  const base = plat.base(rec.contestId, rec.index);
  let lastReason = '';
  let lastChallenged = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let sawChallenge = false;
    try {
      const { page } = await ensureSession();
      await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });
      const deadline = Date.now() + CHALLENGE_WAIT_MS;
      let lastReload = Date.now();
      for (;;) {
        const html = await page.content();
        if (CHALLENGE_RE.test(html)) {
          sawChallenge = true;
          pageChallenges++;
          if (Date.now() - lastReload > RELOAD_EVERY_MS) {
            lastReload = Date.now();
            await page.reload({ timeout: 60000, waitUntil: 'domcontentloaded' }).catch(() => {});
            continue;
          }
          if (Date.now() > deadline) {
            lastReason = 'cloudflare challenge stuck';
            dumpHtml(rec.id, html);
            break;
          }
          await sleep(3000);
          continue;
        }
        if (html.includes('problem-statement')) {
          let parsed = null;
          try {
            parsed = parseCfProblemsPage(html, rec.contestId, base);
          } catch (e) {
            lastReason = 'parse error: ' + String(e).slice(0, 120);
          }
          if (parsed) {
            const hit = parsed.find((p) => String(p.index).toUpperCase() === rec.index) ?? null;
            if (hit && String(hit.statementMd ?? '').trim()) {
              dumpHtml(rec.id, html);
              return { status: 'ok', statementMd: hit.statementMd, samples: hit.samples, url };
            }
            lastReason = parsed.length
              ? 'index mismatch/empty statement (got ' + parsed.map((p) => p.index).join(',') + ')'
              : 'no .problem-statement parsed';
          }
        }
        if (Date.now() > deadline) {
          lastReason ||= 'timeout waiting .problem-statement';
          dumpHtml(rec.id, html);
          break;
        }
        await sleep(2000);
      }
    } catch (e) {
      lastReason = String(e).slice(0, 160);
      log('repair', rec.id + ' attempt ' + attempt + ' error: ' + lastReason);
      await dropSession();
    }
    lastChallenged = sawChallenge;
    if (sawChallenge) {
      consecutiveChallengedAttempts++;
      if (consecutiveChallengedAttempts >= 2) {
        await globalCooldown();
        consecutiveChallengedAttempts = 0;
      }
    } else {
      consecutiveChallengedAttempts = 0;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(rnd(4000, 8000));
  }
  // 质询把整题拖死时换新会话，让下一题从干净上下文开始
  if (lastChallenged) await dropSession();
  return { status: 'fail', reason: lastReason || 'unknown', url };
}

/* ---------------- 断点状态 ---------------- */

const state = readJson(STATE_FILE) ?? { updatedAt: null, records: {} };
if (!state.records) state.records = {};
if (!state.extra) state.extra = {};
const stateKey = (rec) => rec.platform + '/' + rec.data.id;
/** 第一遍（数学字形脏）记在 state.records；--ids-file 的补充遍记在 state.extra，互不混淆。 */
const stateBucket = (rec) => (rec.pass2 ? state.extra : state.records);
const isDone = (rec) => !args.all && stateBucket(rec)[stateKey(rec)]?.status === 'ok';

function saveState(rec, patch) {
  stateBucket(rec)[stateKey(rec)] = { at: new Date().toISOString(), ...patch };
  state.updatedAt = new Date().toISOString();
  if (!args.dryRun) writeJson(STATE_FILE, state);
}

/* ---------------- 统计 / 主流程 ---------------- */

function printStats(dirty) {
  const byPlat = {};
  const byContest = {};
  for (const rec of dirty) {
    byPlat[rec.platform] = (byPlat[rec.platform] ?? 0) + 1;
    const key = rec.platform + '/' + rec.contestId;
    (byContest[key] ??= []).push(rec.id);
  }
  console.log(JSON.stringify({ dirty: dirty.length, byPlatform: byPlat, contests: Object.keys(byContest).length }, null, 2));
  for (const [k, ids] of Object.entries(byContest)) console.log('  ' + k + ' (' + ids.length + '): ' + ids.join(' '));
  const zhDirty = dirty.filter((r) => r.zhDirty).map((r) => r.data.id);
  console.log('statementZhMd 也含数学字形的题（需重译，本脚本不改）：' + (zhDirty.length ? zhDirty.join(' ') : '无'));
  const doneIds = dirty.filter((r) => state.records[stateKey(r)]?.status === 'ok').map((r) => r.data.id);
  console.log('断点状态里已修好：' + doneIds.length + (doneIds.length ? ' → ' + doneIds.join(' ') : ''));
  const failedIds = dirty
    .filter((r) => state.records[stateKey(r)] && state.records[stateKey(r)].status !== 'ok')
    .map((r) => r.data.id);
  if (failedIds.length) console.log('断点状态里记过失败：' + failedIds.join(' '));
  const extraOk = Object.entries(state.extra || {}).filter(([, v]) => v.status === 'ok').map(([k]) => k);
  const extraFail = Object.entries(state.extra || {}).filter(([, v]) => v.status !== 'ok').map(([k]) => k);
  console.log('补充遍(extra) 已修好 ' + extraOk.length + (extraOk.length ? ' → ' + extraOk.join(' ') : ''));
  if (extraFail.length) console.log('补充遍(extra) 记过失败：' + extraFail.join(' '));
}

async function main() {
  const extraMode = typeof args.idsFile === 'string';
  const dirty = extraMode ? loadRecordsFromIdsFile(args.idsFile) : listDirty();

  if (args.stats) {
    printStats(listDirty());
    return;
  }

  let queue = dirty.filter((rec) => !isDone(rec));
  if (args.only) {
    const only = new Set(
      String(args.only)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    queue = dirty.filter((rec) => only.has(String(rec.data.id).toLowerCase()));
  }
  const skipped = dirty.length - queue.length;
  const limit = args.limit != null ? Number(args.limit) : Infinity;
  const batch = queue.slice(0, limit);

  log(
    'repair',
    (extraMode ? '补充遍清单 ' : '脏题 ') + dirty.length + '（cf-gyms ' + dirty.filter((r) => r.platform === 'cf-gyms').length +
      ' / codeforces ' + dirty.filter((r) => r.platform === 'codeforces').length + '），本轮 ' +
      batch.length + '，断点跳过 ' + skipped + '，' + (args.dryRun ? 'DRY-RUN（不写盘）' : '写盘') +
      '，页间隔 ' + (args.sleep != null ? args.sleep + 'ms 固定' : '12-25s 随机'),
  );

  const results = [];
  for (let i = 0; i < batch.length; i++) {
    const rec = batch[i];
    const tag = '[' + (i + 1) + '/' + batch.length + '] ' + rec.data.id;
    const startedAt = Date.now();
    log('repair', tag + ' ' + platOf(rec.platform).url(rec.contestId, rec.index, rec));
    const got = await fetchStatement(rec);
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1) + 's';

    if (got.status === 'ok') {
      const targetKey = platOf(rec.platform).target || 'statementMd';
      const oldMd = String(rec.data[targetKey] ?? '');
      // 旧题面本来就没有公式（如表格/纯文字题）时，不强制新题面必须含 $
      const requireFormula = MATH_GLYPH_RE.test(oldMd) || oldMd.includes('$');
      const check = validate(oldMd, got.statementMd, { requireFormula });
      const samplesDiff = JSON.stringify(rec.data.samples ?? []) !== JSON.stringify(got.samples ?? []);
      const entry = {
        id: rec.data.id,
        platform: rec.platform,
        url: got.url,
        status: check.ok ? 'ok' : 'invalid',
        reasons: check.reasons,
        target: targetKey,
        oldLen: oldMd.length,
        newLen: got.statementMd.length,
        ratio: Number(check.ratio.toFixed(2)),
        overlap: Number(check.overlap.toFixed(2)),
        mathCount: (got.statementMd.match(/\$/g) || []).length,
        samplesDiff,
        secs: Number(secs.slice(0, -1)),
      };
      if (check.ok && got.statementMd.trim() === oldMd.trim()) {
        // 重抓结果与旧值逐字一致：毛病在解析/渲染层，重抓修不了 —— 不写盘，只记账
        entry.status = 'nochange';
        saveState(rec, { status: 'nochange', oldLen: entry.oldLen });
        log('repair', tag + ' NOCHANGE 重抓与旧值一致（解析/渲染层问题，跳过） ' + secs);
      } else if (check.ok) {
        if (!args.dryRun) {
          writeJson(rec.file, {
            ...rec.data,
            [targetKey]: got.statementMd,
            fetchedAt: new Date().toISOString(),
          });
        }
        saveState(rec, { status: 'ok', oldLen: entry.oldLen, newLen: entry.newLen });
        log(
          'repair',
          tag + ' OK ' + entry.oldLen + '→' + entry.newLen + ' (' + Math.round(entry.ratio * 100) + '%) overlap=' +
            Math.round(entry.overlap * 100) + '% math=' + entry.mathCount + ' ' + secs +
            (entry.samplesDiff ? ' samplesDiff' : '') + (args.dryRun ? ' [dry]' : ''),
        );
        if (args.verbose) {
          console.log('--- ' + rec.data.id + ' new statementMd (head 1500) ---');
          console.log(got.statementMd.slice(0, 1500));
          console.log('--- end ---');
        }
      } else {
        saveState(rec, { status: 'fail', reason: check.reasons.join(';') });
        log('repair', tag + ' INVALID ' + entry.oldLen + '→' + entry.newLen + ' :: ' + check.reasons.join(';') + ' ' + secs);
      }
      results.push(entry);
    } else {
      saveState(rec, { status: 'fail', reason: got.reason });
      results.push({ id: rec.data.id, status: 'fail', reasons: [got.reason], secs: Number(secs.slice(0, -1)) });
      log('repair', tag + ' FAIL ' + got.reason + ' ' + secs);
    }

    if (i + 1 < batch.length) await sleep(betweenSleepMs());
  }

  await dropSession();
  await closeCfBrowser();

  const count = (s) => results.filter((r) => r.status === s).length;
  const failed = results.filter((r) => r.status !== 'ok' && r.status !== 'nochange');
  log(
    'repair',
    '本轮结束：成功 ' + count('ok') + ' / 无变化 ' + count('nochange') + ' / 校验失败 ' + count('invalid') + ' / 抓取失败 ' + count('fail') +
      '（脏题总 ' + dirty.length + '，本轮 ' + batch.length + '，此前已修 ' + skipped +
      '，质询次数 ' + pageChallenges + '，冷却 ' + cooldowns + ' 次）',
  );
  for (const f of failed) log('repair', '  FAILED ' + f.id + ': ' + (f.reasons ?? []).join(';'));

  const reportFile = args.report || '/tmp/repair-statement-report.json';
  writeJson(reportFile, {
    at: new Date().toISOString(),
    dryRun: Boolean(args.dryRun),
    mode: extraMode ? 'ids-file' : 'dirty-glyphs',
    dirtyTotal: dirty.length,
    batch: batch.length,
    results,
  });
  log('repair', '报告：' + reportFile);
}

main().catch(async (e) => {
  console.error(e);
  await closeCfBrowser().catch(() => {});
  process.exitCode = 1;
});
