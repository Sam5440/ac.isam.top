#!/usr/bin/env node
/**
 * Codeforces gyms 全量抓取（data/cf-gyms 板块，与牛客/AtCoder/codeforces 平级）。
 *
 * 完整性契约（零缺漏的四层保障）：
 *  1) 列表全扫：/gyms/page/1..lastPage 全部解析入库（listed=true，新→旧倒序）；
 *  2) ID 区间补扫：gym ID 自 100001 连续编号，对 [100001, 列表最大ID+25] 全区间逐 ID
 *     探测，未列入列表但可访问的隐藏 gym 同样入库（listed=false），404 记入
 *     deletedIds —— 不存在"漏探"的区间；
 *  3) 题面零缺漏：每场比赛以 gym 页上的题目链接为权威集合（与历史已知集合取并集，
 *     页面抖动也不会丢题），逐题抓取题面；任何失败进入 .attempts.json 重试账本
 *     （连续 4 次失败跳过，跨 run 保留）；
 *  4) verify 把一切缺失/受限/空场枚举出来并以退出码 1 告警 —— 缺漏永远可见，不静默。
 *
 * 用法：
 *   node scripts/fetch-cf-gyms.mjs                    # 增量（默认）：列表前3页新赛+ID补扫+题面回填(38min预算)
 *   --mode full          全量：列表全扫 + ID 全区间补扫 + 全部题面
 *   --mode problems      只跑题面（列表/补扫已完整时用，避开列表页质询；面板长跑用这个）
 *   --mode verify        完整性校验（缺漏退出码 1；--repair 顺带回填后复验）
 *   --mode status        打印进度统计（JSON）
 *
 * 拉取准入（两条业务规则，判定持久化在 contests.json 的 pullDecision / reuseOf）：
 *   1) 题名唯一命中站内 codeforces 题库的题目 → 只存 reuseOf 存根复用原题，不重复拉题面；
 *   2) gym 官方发起（contest.list 的 kind 命中 Official 系、Championship、Opencup）
 *      或 任一题 standings 通过人数 > 100，二者都不满足的场次不拉题面。
 *
 *   --limit-gyms N       题面阶段最多处理 N 场
 *   --only-gym A[,B]     只处理指定 gym（诊断/定向回填）
 *   --max-problem-pages N  本次最多抓 N 个题面页
 *   --minutes N          题面阶段时间预算（分钟，到点存档退出，续跑无缝）
 *   --concurrency N      并发页数（默认 1：CF 对同 IP 并发请求会挂起响应，
 *                        实测 c=3 每题要 2 分钟拿空壳，c=1 反而 ~12s/页）
 *   --listing-pages N    列表扫描页数上限（full 默认全部）
 *   --sweep-limit N      本次 ID 探测上限（增量默认 300，full 默认不限）
 *   --login              允许用 CF_HANDLE/CF_PASSWORD 环境变量登录（受限 gym 兜底）
 *   --dry-run            打印将要执行的计划，不抓取
 *
 * 凭据只经环境变量/Secrets 传入，绝不写入任何文件。
 * Cloudflare 质询：持久化浏览器上下文（cf_clearance 复用）+ 质询耐心等待 +
 * 有头模式（CF_HEADLESS=0，CI 走 xvfb-run）通过率最高。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

import { loadHtml } from './lib/html2md.mjs';
import { parseCfProblemsPage } from './lib/cf.mjs';
import { saveContests, loadContests, loadProblem, saveProblem, problemComplete } from './lib/store.mjs';
import { sleep, rnd, readJson, writeJson, parseArgs, loadEnv, log } from './lib/util.mjs';

loadEnv();

const CF = 'https://codeforces.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PLATFORM = 'cf-gyms';
const DATA = path.join(process.cwd(), 'data', PLATFORM);
const STATE_FILE = path.join(DATA, '.fetch-state.json'); // 机器本地运行统计（gitignore）
const SWEEP_FILE = path.join(DATA, 'sweep-state.json'); // 提交入库：ID 补扫游标与已删清单（CI 续扫依赖）
const ATTEMPTS_FILE = path.join(DATA, '.attempts.json');
const BROWSER_DIR = process.env.CFG_BROWSER_DIR || path.join(process.cwd(), '.cache', 'cf-gyms-browser');
// 实时进度快照（网页监控用；多 worker 各写各的，互不覆盖）
const LIVE_FILE = process.env.CFG_LIVE_FILE || path.join(DATA, '.live.json');

const MAX_ATTEMPTS = 4; // 同一 URL 连续失败上限（跨 run 记账）
const CHALLENGE_TIMEOUT_MS = 8 * 60 * 1000; // 单次导航的质询解决总时限
const NAV_HTTP_TIMEOUT_MS = 60000;

const args = parseArgs(process.argv.slice(2));
const MODE = args.mode || 'incremental';

/* ---------------- 状态与账本 ---------------- */

function loadState() {
  const s = readJson(STATE_FILE) ?? {};
  s.listingPageCount ??= 0;
  s.lastFullListingAt ??= null;
  s.stats ??= { runs: 0, problemsFetched: 0, gymsFetched: 0 };
  return s;
}
const state = loadState();
const saveState = () => writeJson(STATE_FILE, state);

// ID 补扫游标与已删清单入库（CI 全新 checkout 也能续扫，不会重复探测已删 ID）
const sweepState = readJson(SWEEP_FILE) ?? { sweptMaxId: 0, deletedIds: [] };
sweepState.sweptMaxId ??= 0;
sweepState.deletedIds ??= [];
const saveSweep = () => writeJson(SWEEP_FILE, sweepState);

let attempts = readJson(ATTEMPTS_FILE) ?? {};
let attemptsDirty = false;
const fail = (key, err) => {
  const a = attempts[key] ?? { fails: 0 };
  a.fails++;
  a.lastError = String(err).slice(0, 200);
  a.updatedAt = new Date().toISOString();
  attempts[key] = a;
  attemptsDirty = true;
};
const succeed = (key) => {
  if (attempts[key]) {
    delete attempts[key];
    attemptsDirty = true;
  }
};
const exhausted = (key) => (attempts[key]?.fails ?? 0) >= MAX_ATTEMPTS;
const saveAttempts = () => {
  if (!attemptsDirty) return;
  writeJson(ATTEMPTS_FILE, attempts);
  attemptsDirty = false;
};

/* ---------------- 比赛条目（内存缓存 + 批量落盘） ---------------- */

let contestsCache = null;
const contests = () => (contestsCache ??= loadContests(PLATFORM));
const flushContests = () => {
  if (contestsCache) saveContests(PLATFORM, contestsCache);
};
const contestById = (id) => contests().find((c) => String(c.id) === String(id));

/** 乐观合并一条比赛记录：null/undefined 字段不覆盖已有值；status 只允许向前演进。 */
const STATUS_RANK = { unknown: 0, upcoming: 1, running: 2, finished: 3, empty: 3, 'no-problems-visible': 3, restricted: 4, deleted: 4, ok: 3 };
function upsertGym(meta) {
  const list = contests();
  const i = list.findIndex((c) => String(c.id) === String(meta.id));
  if (i < 0) {
    list.push({
      id: meta.id,
      platform: PLATFORM,
      title: meta.title ?? null,
      startTime: meta.startTime ?? null,
      durationSeconds: meta.durationSeconds ?? null,
      ratedRange: null,
      url: `${CF}/gym/${meta.id}`,
      problems: meta.problems ?? [],
      titleZh: null,
      gymStatus: meta.gymStatus ?? 'unknown',
      season: meta.season ?? null,
      contestType: meta.contestType ?? null,
      listed: meta.listed ?? false,
    });
    return list[list.length - 1];
  }
  const cur = list[i];
  for (const [k, v] of Object.entries(meta)) {
    if (v == null) continue;
    if (k === 'problems') {
      // 权威集合与历史集合取并集（页面抖动不丢题）
      cur.problems = [...new Set([...(v ?? []), ...cur.problems])];
    } else if (k === 'gymStatus') {
      if ((STATUS_RANK[v] ?? 0) >= (STATUS_RANK[cur.gymStatus] ?? 0)) cur.gymStatus = v;
    } else {
      cur[k] = v;
    }
  }
  return cur;
}

/* ---------------- 浏览器与导航 ---------------- */

let ctx = null;
let pages = [];
let lastNavAt = 0;
let navChain = Promise.resolve();
let loginDone = false;
let loginTried = false;
let stopping = false;

/* ---------------- 实时进度快照（网页监控用） ---------------- */

const liveWorkers = new Map();
let liveTimer = null;
function writeLive() {
  if (liveTimer) return;
  liveTimer = setTimeout(() => {
    liveTimer = null;
    try {
      fs.writeFileSync(
        LIVE_FILE,
        JSON.stringify({
          pid: process.pid,
          platform: PLATFORM,
          mode: MODE,
          updatedAt: new Date().toISOString(),
          workers: [...liveWorkers.values()],
        }),
      );
    } catch {}
  }, 600);
}
function liveSet(wid, patch) {
  liveWorkers.set(wid, { ...(liveWorkers.get(wid) ?? { wid }), ...patch });
  writeLive();
}

// 默认 1：实测 CF 对同 IP 的并发导航会挂起响应（content 停在 841B 空壳），
// c=3 吞吐反而只有 c=1 的 1/5。多开标签页留作应急，不设为默认。
const concurrency = Math.max(1, Math.min(4, Number(args.concurrency ?? 1)));

// 自适应限速：遇 Cloudflare 挑战拉慢 pace（×1.4，上限 ×4），10 分钟无挑战逐次衰减回 1。
// 长跑（24h 级）下风暴是频率相关的，宁可慢一点也不能连续触发质询。
let paceMultiplier = 1;
let lastChallengeAt = 0;
// 风暴熔断：10min 窗口内**不同 URL** 各出 1 次质询 → 全局冷却 10-20 min；
// 同一 URL 反复质询只记账跳过（见 nav），不拖垮整条管线。
let stormStreak = 0;
let cooldownsThisRun = 0;
let stormEvents = []; // 90s 冷却/challenge-stuck 事件 { at, url }

function noteStorm(url) {
  stormEvents.push({ at: Date.now(), url });
  stormEvents = stormEvents.filter((e) => Date.now() - e.at < 10 * 60 * 1000);
}
const stormUrls = () => new Set(stormEvents.map((e) => e.url));
const urlStormCount = (url) => stormEvents.filter((e) => e.url === url).length;

async function globalStormBreak() {
  stormEvents = [];
  cooldownsThisRun++;
  // 冷却收紧为 5-10min：profile 不再销毁， clearance 还在，短冷即可恢复试探；
  // 「IP 被盯死要静默 20min+」只发生在无 clearance 的新会话场景。
  const waitMs = rnd(5, 10) * 60000;
  log('cf-gyms', `storm breaker #${cooldownsThisRun}: 全局冷却 ${Math.round(waitMs / 60000)}min 并重建会话`);
  await ctx?.close().catch(() => {});
  ctx = null;
  pages = [];
  if (cooldownsThisRun >= 2 && process.env.CFG_REBUILD_PROFILE === '1') {
    // 默认不重建：profile 里的 cf_clearance 是穿过质询的唯一凭据，
    // 删掉后要从零重过质询（实测新 profile 需 ~3.5min 且可能失败）。
    try {
      fs.rmSync(BROWSER_DIR, { recursive: true, force: true });
      log('cf-gyms', 'browser profile rebuilt (fresh fingerprint)');
    } catch {}
  }
  for (const waited = Date.now(); Date.now() - waited < waitMs; ) {
    if (stopping) return;
    await sleep(Math.min(30000, waitMs - (Date.now() - waited)));
  }
  await ensureBrowser();
  while (pages.length < concurrency) pages.push(await newPage());
}

async function pace() {
  if (lastChallengeAt && Date.now() - lastChallengeAt > 10 * 60 * 1000) {
    paceMultiplier = Math.max(1, paceMultiplier * 0.85);
    if (paceMultiplier <= 1.01) lastChallengeAt = 0;
  }
  // 全局门控：每 gap 放行一次导航起点。并发靠多标签页重叠加载换取吞吐，
  // 而不是拉长间隔——旧式 `* concurrency` 会让 c=3 比 c=1 还慢（实测 c=3 首题 6 分钟）。
  const gap = (2500 + rnd(800, 1600)) * paceMultiplier;
  const wait = Math.max(0, lastNavAt + gap - Date.now());
  lastNavAt = Math.max(lastNavAt, Date.now()) + wait + gap;
  if (wait > 0) await sleep(wait);
}

async function launch() {
  const { chromium } = await import('playwright');
  const headless = process.env.CF_HEADLESS !== '0'; // 与 fetch.mjs 约定一致：长跑用有头（CI 走 xvfb）
  // 可选真实 Chrome（CF_BROWSER_CHANNEL=chrome）：指纹更接近真人，质询通过率更高。
  // 注意此时不能覆盖 UA —— 硬编码 UA 与真实 Chrome 版本不一致会被 CF 直接判为自动化。
  const channel = process.env.CF_BROWSER_CHANNEL || '';
  // 系统代理默认沿用（Clash 类出口 IP 的 cf_clearance 经实测可长期复用）；
  // 直连模式用 CFG_NO_PROXY=1 显式开启 —— clearance 与 IP 绑定，出口换了就失效。
  const noProxy = process.env.CFG_NO_PROXY === '1';
  fs.mkdirSync(BROWSER_DIR, { recursive: true });
  ctx = await chromium.launchPersistentContext(BROWSER_DIR, {
    headless,
    channel: channel || undefined,
    ...(channel ? {} : { userAgent: UA }),
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    timezoneId: 'UTC', // 页面时间统一按 UTC 渲染，startTime 口径与其他平台一致
    args: ['--disable-blink-features=AutomationControlled', ...(noProxy ? ['--no-proxy-server'] : [])],
  });
  ctx.on('close', () => {
    ctx = null;
    pages = [];
  });
  // 资源拦截：图片/字体/媒体不参与解析，直接掐掉加速加载（脚本/样式放行：
  // Turnstile 质询页依赖 CSS 渲染，掐掉样式会让质询停留在「请稍候」）
  await ctx.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'font' || t === 'media') return route.abort();
    return route.continue();
  });
}

async function newPage() {
  return ctx.newPage();
}

async function ensureBrowser() {
  if (!ctx) await launch();
  if (!pages.length) pages = [await newPage()];
}

const isChallenge = (html) => {
  const title = (html.match(/<title[^>]*>([^<]*)/) || ['', ''])[1];
  return /Just a moment/i.test(title);
};
const isNotFound = (html) => /Page not found/i.test((html.match(/<title[^>]*>([^<]*)/) || ['', ''])[1] || '');

/**
 * 单页导航（全局串行 + 限速）：goto 用 commit（不等同步脚本，题面页的 MathJax
 * 常把 domcontentloaded 拖到超时），随后轮询内容直到 ready(html) 就绪；质询耐心
 * 等待（自动过 → 每 45s reload → 3 次后冷却 90s）；内容 8s 无增长也视为就绪兜底。
 * wid：使用第 wid 个 tab（并发下各 worker 独立页面）。
 * 返回 { html, status: 'ok' | 'notfound' | 'challenge-stuck' | 'incomplete' }。
 */
const NAV_DEBUG = process.env.CF_NAV_DEBUG === '1';

async function nav(url, wid = 0, ready = null) {
  await ensureBrowser();
  const navStart = Date.now();
  liveSet(wid, { url, phase: 'navigating', startedAt: new Date(navStart).toISOString(), status: null, error: null });
  let lastBeat = navStart;
  let deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
  let reloads = 0;
  let emptyRetries = 0;
  const run = (async () => {
    for (;;) {
      await pace();
      try {
        const page = pages[Math.min(wid, pages.length - 1)];
        if (!page) {
          // relaunch() 清空 pages 的瞬间被其他 worker 撞上
          await relaunch();
          continue;
        }
        const resp = await page.goto(url, { timeout: NAV_HTTP_TIMEOUT_MS, waitUntil: 'commit' });
        // PDF 题面（ICPC gym 常见：/problem/X 直接返回 application/pdf）：
        // Chromium 内置 PDF 查看器不产出 HTML，content() 只有 271B 空壳，
        // 必须走「下载 PDF + 提取文字」分支，而不是当作解析失败。
        const ctype = resp ? String((resp.headers() || {})['content-type'] || '') : '';
        if (/application\/pdf/i.test(ctype)) {
          stormStreak = 0;
          return { html: '', status: 'pdf', contentType: ctype, pdfUrl: url };
        }
      } catch (e) {
        log('cf-gyms', `nav error ${url.slice(0, 90)}: ${String(e).slice(0, 100)} — rebuild`);
        await relaunch();
        continue;
      }
      let stableCount = 0;
      let lastLen = -1;
      let shortStreak = 0;
      let lastShortLen = -1;
      let firstReadyAt = null;
      for (;;) {
        const page = pages[Math.min(wid, pages.length - 1)];
        if (!page) {
          await relaunch();
          break; // 回外层重新 goto
        }
        let html;
        try {
          html = await page.content();
        } catch (e) {
          if (!stopping) log('cf-gyms', `content() failed: ${String(e).slice(0, 90)} — rebuild`);
          await relaunch();
          break;
        }
        if (NAV_DEBUG && Date.now() - lastBeat > 15000) {
          lastBeat = Date.now();
          const title = (html.match(/<title[^>]*>([^<]*)/) || ['', ''])[1].trim().slice(0, 50);
          log('cf-gyms', `nav-debug ${Math.round((Date.now() - navStart) / 1000)}s len=${html.length} title="${title}" ${url.slice(0, 70)}`);
        }
        // 空壳文档（<1200B，连 <title> 都没有）：CF 偶发返回空响应/被挂起响应。
        // 旧逻辑只对 >500B 做「8s 无增长」兜底，这类页会白等满 8 分钟导航预算；
        // 稳定 10s 即重导航，3 次仍空才判 incomplete。
        if (html.length < 1200) {
          if (html.length === lastShortLen) shortStreak++;
          else {
            shortStreak = 0;
            lastShortLen = html.length;
          }
          if (shortStreak >= 5) {
            emptyRetries++;
            log('cf-gyms', `empty doc ${html.length}B — 重导航 ${emptyRetries}/3 (${url.slice(0, 70)})`);
            if (emptyRetries > 3) return { html, status: 'incomplete' };
            await sleep(rnd(1500, 3000));
            break;
          }
        }
        if (isChallenge(html)) {
          lastChallengeAt = Date.now();
          paceMultiplier = Math.min(4, paceMultiplier * 1.4);
          if (Date.now() > deadline) {
            stormStreak++;
            noteStorm(url);
            // 只有「不同 URL 也各自遇到质询」才算风暴；单 URL 卡住直接记账跳过
            if (stormUrls().size < 2) return { html, status: 'challenge-stuck' };
            // 风暴熔断：全局冷却后原地重试同一 URL（重置本次导航预算）
            stormStreak = 0;
            await globalStormBreak();
            if (stopping) return { html, status: 'challenge-stuck' };
            deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
            reloads = 0;
            break;
          }
          if (Date.now() > deadline - CHALLENGE_TIMEOUT_MS + 45000 * (reloads + 1)) {
            reloads++;
            if (reloads > 3) {
              log('cf-gyms', `challenge cooldown 90s (${url.slice(0, 80)})`);
              noteStorm(url);
              // 同一 URL 连过两轮质询仍不通：记账跳过，别为一场 gym 拖停全局
              if (urlStormCount(url) >= 2) return { html, status: 'challenge-stuck' };
              if (stormUrls().size >= 2) {
                await globalStormBreak();
                if (stopping) return { html, status: 'challenge-stuck' };
                deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
                reloads = 0;
                break;
              }
              await sleep(90000);
              reloads = 0; // 新一轮重试：重新给 3 次 reload 机会
              if (Date.now() > deadline) return { html, status: 'challenge-stuck' };
            }
            break; // 回外层重新 goto
          }
          await sleep(3000);
          continue;
        }
        if (isNotFound(html)) {
          stormStreak = 0;
          return { html, status: 'notfound' };
        }
        if (ready ? ready(html) : html.length > 500) {
          stormStreak = 0;
          firstReadyAt ??= Date.now();
          // ready 后再稳 600ms（让后续 DOM 追加完成），最多等 2s
          if (Date.now() - firstReadyAt > 600) return { html, status: 'ok' };
        } else {
          firstReadyAt = null;
        }
        // 内容 8s 无增长 → 就绪兜底（防 ready 判定漏网）
        if (html.length === lastLen) {
          if (++stableCount >= 5 && html.length > 500) {
            stormStreak = 0;
            return { html, status: 'ok' };
          }
        } else {
          stableCount = 0;
          lastLen = html.length;
        }
        if (Date.now() > deadline) return { html, status: 'incomplete' };
        await sleep(1600);
      }
    }
  })();
  navChain = run.then(
    () => {},
    () => {},
  );
  await navChain;
  const res = await run;
  liveSet(wid, {
    phase: 'idle',
    status: res.status,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - navStart,
  });
  return res;
}

async function relaunch() {
  try {
    await ctx?.close();
  } catch {}
  ctx = null;
  pages = [];
  await ensureBrowser();
  while (pages.length < concurrency) pages.push(await newPage());
}

/* ---------------- 登录（可选兜底） ---------------- */

async function login() {
  if (loginDone || loginTried) return loginDone;
  loginTried = true;
  const handle = process.env.CF_HANDLE;
  const password = process.env.CF_PASSWORD;
  if (!handle || !password) {
    log('cf-gyms', 'login skipped: CF_HANDLE/CF_PASSWORD not set');
    return false;
  }
  await ensureBrowser();
  const page = pages[0];
  try {
    await pace();
    await page.goto(`${CF}/enter?back=${encodeURIComponent(`${CF}/gyms`)}`, {
      timeout: NAV_HTTP_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    });
    for (let i = 0; i < 30 && isChallenge(await page.content()); i++) await sleep(3000);
    await page.fill('#handle, input[name="handle"]', handle, { timeout: 10000 });
    await page.fill('#password, input[name="password"]', password, { timeout: 10000 });
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 })
        .catch(() => {}),
      page.click('button[type="submit"], input[type="submit"]', { timeout: 10000 }),
    ]);
    const html = await page.content();
    loginDone = html.includes(`/profile/${handle}`) && !isChallenge(html);
    log('cf-gyms', `login ${loginDone ? 'ok' : 'failed'}`);
  } catch (e) {
    log('cf-gyms', `login error: ${String(e).slice(0, 120)}`);
  }
  return loginDone;
}

/* ---------------- 解析 ---------------- */

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** "Nov/12/2026 08:30"(+可选 UTC±X 后缀) → ISO（页面时区固定 UTC）。 */
function parseCfDate(text) {
  const m = /([A-Z][a-z]{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(String(text).replace(/UTC[+-]\d+/g, '').trim());
  if (!m) return null;
  const mo = MONTHS[m[1]];
  if (mo === undefined) return null;
  return new Date(Date.UTC(+m[3], mo, +m[2], +m[4], +m[5])).toISOString();
}

/** "16:16:00" | "05:00" → 秒 */
function parseDuration(text) {
  const p = String(text).trim().split(':').map((x) => parseInt(x, 10));
  if (!p.length || p.some(Number.isNaN)) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 3600 + p[1] * 60;
  return null;
}

const CONTEST_TYPES = [
  'Official ACM-ICPC Contest',
  'Official School Contest',
  'Opencup Contest',
  'School/University/City/Region Championship',
  'Training Camp Contest',
  'Official International Personal Contest',
  'Training Contest',
];

function listingStatus(text) {
  if (/running/i.test(text)) return 'running';
  if (/final standings|current standings/i.test(text)) return 'finished';
  if (/before (start|registration)/i.test(text)) return 'upcoming';
  return 'finished';
}

/** 列表页 → [{id,title,startTime,durationSeconds,season,contestType,gymStatus}] */
function parseListingRows(html) {
  const $ = loadHtml(html);
  const out = [];
  for (const tr of $('table tr').toArray()) {
    const a = $(tr)
      .find('a[href^="/gym/"]')
      .toArray()
      .find((el) => /^\/gym\/\d+$/.test($(el).attr('href') || ''));
    if (!a) continue;
    const id = +$(a).attr('href').match(/\d+/)[0];
    const tds = $(tr).find('td');
    if (tds.length < 4) continue;
    const title = tds.eq(0).clone().children().remove().end().text().replace(/\s+/g, ' ').trim() || $(a).text().trim();
    out.push({
      id,
      title,
      startTime: parseCfDate(tds.eq(1).text()),
      durationSeconds: parseDuration(tds.eq(2).text()),
      season: (tds.eq(4).text().match(/(\d{4}-\d{4})/) || [])[1] ?? null,
      contestType: CONTEST_TYPES.find((t) => tds.eq(4).text().includes(t)) ?? null,
      gymStatus: listingStatus(tds.eq(3).text()),
    });
  }
  return out;
}

const GATE_RE = /register for this contest|you are not allowed to see|to see the problems, you (need|should)|not logged in/i;

/** gym 详情页 → { gate, links:[{index,title}], startTime, durationSeconds, title, season, contestType } */
function parseGymPage(html, gymId) {
  const $ = loadHtml(html);
  const body = $('body').text().replace(/\s+/g, ' ');
  const gate = GATE_RE.test(body);
  const links = [];
  const seen = new Set();
  for (const el of $(`a[href^="/gym/${gymId}/problem/"]`).toArray()) {
    const raw = decodeURIComponent($(el).attr('href').split('/problem/')[1] || '');
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const row = $(el).closest('tr');
    let title = '';
    if (row.length) {
      const tds = row.find('td');
      title = (tds.length > 1 ? tds.eq(1).clone().children().remove().end().text() : tds.eq(0).clone().children().remove().end().text())
        .replace(/\s+/g, ' ')
        .trim();
      if (!title) title = row.text().replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    links.push({ index: raw, title });
  }
  const infos = $('table.infos').text();
  const lengthMatch = /Length:\s*([\d:]+)/.exec(infos) || /Length:\s*([\d:]+)/.exec(body);
  return {
    gate,
    links,
    startTime: parseCfDate(infos) ?? parseCfDate(body),
    durationSeconds: lengthMatch ? parseDuration(lengthMatch[1]) : null,
    title: $('h3').first().text().replace(/\s+/g, ' ').trim(),
    season: (body.match(/(\d{4}-\d{4})/) || [])[1] ?? null,
    contestType: CONTEST_TYPES.find((t) => body.includes(t)) ?? null,
  };
}

const attemptKeyFor = (gymId, index) => `/gym/${gymId}/problem/${String(index).toLowerCase()}`;
const problemId = (gymId, index) => `${gymId}${String(index).toLowerCase()}`;

/** gym 页就绪判定：Prepared by（页尾元信息）与题目表/受限标记同时可见。
 *  HTML 是流式解析的，单独任一信号都可能在半截 DOM 时出现。 */
const gymPageReady = (gymId) => (html) => {
  const g = parseGymPage(html, gymId);
  return (g.links.length > 0 || g.gate) && /Prepared by/i.test(html);
};

/** 题面页就绪判定：div.problem-statement 必须已闭合到能解析出非空 statementMd
 *  （开标签过早出现时内容可能还在流式传输）。 */
const problemPageReady = (gymId, index) => (html) => {
  if (GATE_RE.test(html)) return true;
  try {
    const parsed = parseCfProblemsPage(html, gymId, `${CF}/gym/${gymId}/problem/${index}`);
    return parsed.length > 0 && Boolean(parsed[0].statementMd?.trim());
  } catch {
    return false;
  }
};

/** gym 行标题净化：去掉 "standard input/output 5 s, 1024 MB x37" 这类表格尾巴。 */
const sanitizeRowTitle = (t) =>
  String(t ?? '')
    .replace(/\s+standard\s+(input\/output|input|output)[\s\S]*$/i, '')
    .replace(/\s+x\d+\s*$/i, '')
    .trim();

/** 样例 note 若只有 Input/Output/Copy 样板则丢弃（保留真实注释）。 */
function cleanSamples(samples) {
  return (samples ?? []).map((s) => {
    if (s.note && !s.note.replace(/\b(Copy|Input|Output)\b/g, '').trim()) {
      const { note, ...rest } = s;
      return rest;
    }
    return s;
  });
}

/* ---------------- 阶段 1：列表扫描（新→旧） ---------------- */

async function scanListing(maxPages) {
  log('cf-gyms', `listing scan start (maxPages=${maxPages})`);
  await ensureBrowser();
  // ready 必须等分页器出现（表格尾部后流完），防 HTML 流中途放行漏掉末尾行
  const listReady = (html) => parseListingRows(html).length > 0 && /gyms\/page/.test(html);
  let first = null;
  for (let i = 0; i < 3 && !first; i++) {
    const r = await nav(`${CF}/gyms/page/1`, 0, listReady);
    if (r.status === 'ok') first = r;
    else {
      fail('/gyms/page/1', r.status);
      log('cf-gyms', `listing page 1: ${r.status} — 重试 ${i + 1}/3`);
      await sleep(60000);
    }
  }
  if (!first) throw new Error('listing page 1 unreachable (3 retries)');
  const $ = loadHtml(first.html);
  const lastPage = Math.max(
    1,
    ...$('a[href*="/gyms/page/"]')
      .toArray()
      .map((a) => +($(a).attr('href').match(/page\/(\d+)/)?.[1] ?? 0)),
  );
  const target = Math.min(lastPage, maxPages ?? lastPage);
  let newGyms = 0;
  let totalRows = 0;
  for (let p = 1; p <= target; p++) {
    const r = p === 1 ? first : await nav(`${CF}/gyms/page/${p}`, 0, listReady);
    if (r.status !== 'ok') {
      log('cf-gyms', `listing page ${p}: ${r.status} — 记账，下次重试`);
      fail(`/gyms/page/${p}`, r.status);
      continue;
    }
    const rows = parseListingRows(r.html);
    if (!rows.length) {
      log('cf-gyms', `listing page ${p}: zero rows — 记账，下次重试`);
      fail(`/gyms/page/${p}`, 'zero rows');
      continue;
    }
    succeed(`/gyms/page/${p}`);
    totalRows += rows.length;
    for (const row of rows) {
      const isNew = !contestById(row.id);
      upsertGym({ ...row, title: row.title || null, listed: true, problems: [] });
      if (isNew) newGyms++;
    }
    flushContests();
    log('cf-gyms', `listing page ${p}/${target}: rows=${rows.length} (+${newGyms} new)`);
    state.listingPageCount = Math.max(state.listingPageCount, target);
    saveState();
    await sleep(rnd(400, 900));
  }
  if (target >= lastPage) state.lastFullListingAt = new Date().toISOString();
  saveState();
  log('cf-gyms', `listing scan done: pages=${target}/${lastPage} rows=${totalRows} newGyms=${newGyms}`);
  return { lastPage, scanned: target };
}

/* ---------------- 阶段 2：ID 区间补扫（未列名 gym） ---------------- */

async function sweepIds(sweepLimit) {
  const listedMax = Math.max(0, ...contests().filter((c) => c.listed).map((c) => +c.id));
  const to = listedMax + 25;
  const from = Math.max(sweepState.sweptMaxId + 1, 100001);
  if (from > to) {
    log('cf-gyms', `sweep up-to-date (sweptMaxId=${sweepState.sweptMaxId}, listedMax=${listedMax})`);
    return { probed: 0, found: 0 };
  }
  const deletedSet = new Set(sweepState.deletedIds);
  let probed = 0;
  let found = 0;
  for (let id = from; id <= to && probed < sweepLimit && !stopping; id++) {
    sweepState.sweptMaxId = id - 1; // 游标语义：已处理到 id-1
    if (deletedSet.has(id) || contestById(id)) {
      if (id % 500 === 0) saveSweep();
      continue;
    }
    probed++;
    const r = await nav(`${CF}/gym/${id}`, 0, gymPageReady(id));
    if (r.status === 'notfound') {
      sweepState.deletedIds.push(id);
      if (sweepState.deletedIds.length % 200 === 0) saveSweep();
      continue;
    }
    if (r.status !== 'ok') {
      fail(`/gym/${id}`, r.status);
      sweepState.sweptMaxId = id - 1; // 不推进，下次续扫
      continue;
    }
    succeed(`/gym/${id}`);
    const g = parseGymPage(r.html, id);
    if (g.gate && !g.links.length && !loginDone && args.login) await login();
    const status = g.links.length ? 'ok' : g.gate ? 'restricted' : 'empty';
    upsertGym({
      id,
      problems: g.links.map((l) => problemId(id, l.index)),
      listed: false,
      gymStatus: status,
      title: g.title,
      startTime: g.startTime,
      durationSeconds: g.durationSeconds,
      season: g.season,
      contestType: g.contestType,
    });
    found++;
    if (found % 20 === 0) {
      flushContests();
      saveSweep();
    }
    log('cf-gyms', `sweep gym/${id}: ${status} problems=${g.links.length}`);
    await sleep(rnd(300, 800));
  }
  sweepState.sweptMaxId = Math.max(sweepState.sweptMaxId, Math.min(from + probed - 1, to));
  flushContests();
  saveSweep();
  log('cf-gyms', `sweep done: probed=${probed} found=${found} sweptMaxId=${sweepState.sweptMaxId}`);
  return { probed, found };
}

/* ---------------- 阶段 3：题面抓取 ---------------- */

/**
 * PDF 题面：仓库只存提取出的文字（statementMd），PDF 原件不入库。
 * 下载仅用于取字——落到系统临时目录，pdftotext 后立即删除；
 * statementPdf 记录远端原站地址，前端直接 iframe 内嵌。
 */
async function savePdfProblem({ gymId, index, url, link, wid = 0 }) {
  const pid = problemId(gymId, index);
  const tmpDir = path.join(os.tmpdir(), 'cf-gyms-pdf');
  fs.mkdirSync(tmpDir, { recursive: true });
  const abs = path.join(tmpDir, `${pid}.pdf`);
  // 用页面内 fetch（真实浏览器指纹 + cf_clearance cookie）下载；
  // ctx.request 的默认 UA 会被 Cloudflare 直接 403（实测）。
  const page = pages[Math.min(wid, pages.length - 1)];
  if (!page) throw new Error('no page for pdf download');
  const b64 = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    if (!r.ok) throw new Error(`http ${r.status}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    return btoa(s);
  }, url);
  const buf = Buffer.from(b64, 'base64');
  if (!buf || buf.length < 1000 || buf.slice(0, 5).toString() !== '%PDF-') {
    throw new Error(`not a pdf (${buf ? buf.length : 0}B)`);
  }
  let text = '';
  try {
    fs.writeFileSync(abs, buf);
    text = execFileSync('pdftotext', ['-layout', abs, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } catch (e) {
    log('cf-gyms', `pdftotext failed (${pid}): ${String(e).slice(0, 90)}`);
  } finally {
    try { fs.unlinkSync(abs); } catch {}
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  saveProblem(PLATFORM, {
    id: pid,
    platform: PLATFORM,
    contestId: gymId,
    index,
    title: sanitizeRowTitle(link.title) ?? null,
    titleZh: null,
    url,
    difficulty: null,
    tags: [],
    points: null,
    timeLimitMs: null,
    memoryLimitMb: null,
    statementMd: text || null,
    statementZhMd: null,
    // 远端原站地址（前端内嵌用），不落地任何 PDF 文件
    statementPdf: url,
    statementFormat: 'pdf',
    samples: [],
    language: 'en',
    fetchedAt: new Date().toISOString(),
  });
  return { bytes: buf.length, textLen: text.length };
}

/* ---------------- 拉取准入（两条业务规则） ----------------
 * 规则 1：题目若已在站内 codeforces 题库中（题名唯一命中），存 reuseOf 存根
 *         直接复用原题题面/样例，不单独再拉一份；
 * 规则 2：gym 满足其一才拉题面 —— ① 官方发起（官方 API 的 kind 命中官方系列）；
 *         ② 任一题通过人数 > SOLVE_THRESHOLD（standings 逐行数通过格）。
 * 不满足的一律跳过并把判定持久化，verify 不再把它们当缺口报。 */

const SOLVE_THRESHOLD = 100;

const isOfficialGym = (c) =>
  Boolean(
    c.gymKind &&
      (/^Official/.test(c.gymKind) ||
        /Championship/.test(c.gymKind) ||
        c.gymKind === 'Opencup Contest' ||
        // 训练营赛（Petrozavodsk/冬令营等）也是官方组织的正经比赛
        c.gymKind === 'Training Camp Contest'),
  );

/** contest.list?gym=true 原始结果：node fetch 两次重试，失败落 curl 兜底
 *  （node 的 fetch 不走系统代理，个别时刻直连会失败）。 */
async function fetchGymApiList() {
  const url = `${CF}/api/contest.list?gym=true`;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const d = await res.json();
      if (d.status !== 'OK') throw new Error(d.comment || 'api failed');
      return d.result;
    } catch (e) {
      if (i === 1) log('cf-gyms', `api fetch failed (${String(e).slice(0, 80)})，curl 兜底`);
      await sleep(3000);
    }
  }
  const out = execFileSync('curl', ['-s', '-m', '60', url], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  const d = JSON.parse(out);
  if (d.status !== 'OK') throw new Error(d.comment || 'api failed');
  return d.result;
}

/** 官方 API 一次性补全 gym 元数据（kind/preparedBy/country/...，不经过浏览器）。 */
async function enrichGymsFromApi() {
  try {
    const list = await fetchGymApiList();
    const byId = new Map(list.map((x) => [String(x.id), x]));
    let n = 0;
    let official = 0;
    for (const c of contests()) {
      const a = byId.get(String(c.id));
      if (!a) continue;
      const patch = {
        gymKind: a.kind ?? null,
        preparedBy: a.preparedBy ?? null,
        country: a.country ?? null,
        city: a.city ?? null,
        season: c.season ?? a.season ?? null,
        difficulty: a.difficulty ?? null,
        startTime: c.startTime ?? (a.startTimeSeconds ? new Date(a.startTimeSeconds * 1000).toISOString() : null),
      };
      upsertGym({ id: c.id, ...patch });
      n++;
      if (isOfficialGym(c)) official++;
    }
    flushContests();
    log('cf-gyms', `api enrich: ${n} gyms, official=${official}`);
  } catch (e) {
    log('cf-gyms', `api enrich failed: ${String(e).slice(0, 140)}（跳过补全，规则2 仅走通过数判定）`);
  }
}

/**
 * standings 页解析：题头字母列 + 每行通过格计数。
 * 返回 null = 无 standings 表；counts 以 problemid 计。
 */
function parseStandingsSolved(html) {
  const tblStart = html.indexOf('<table class="standings"');
  if (tblStart < 0) return null;
  const tbl = html.slice(tblStart, html.indexOf('</table>', tblStart));
  const letters = [];
  const letterRe = /<th[^>]*>\s*<a title="[^"]*?" href="\/gym\/\d+\/problem\/([A-Za-z0-9]+)">/g;
  let m;
  while ((m = letterRe.exec(tbl))) letters.push(m[1].toUpperCase());
  const counts = new Map();
  const idOrder = [];
  let dataRows = 0;
  let rowsWithoutSolve = 0;
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  while ((m = rowRe.exec(tbl))) {
    const tds = m[0].match(/<td contestid="\d+" problemid="(\d+)"[^>]*>/g);
    if (!tds?.length) continue;
    let anySolve = false;
    for (const td of tds) {
      const pid = td.match(/problemid="(\d+)"/)[1];
      if (!idOrder.includes(pid)) idOrder.push(pid);
      if (/acceptedsubmissionid=/.test(td)) {
        anySolve = true;
        counts.set(pid, (counts.get(pid) ?? 0) + 1);
      }
    }
    dataRows++;
    if (!anySolve) rowsWithoutSolve++;
  }
  return { letters, idOrder, counts, dataRows, rowsWithoutSolve };
}

/**
 * 统计一场 gym 的每题通过数。standings 按名次排序：有过题的队伍都在全零分队伍
 * 之前，所以出现首个全零行即可停止翻页；满页且全有得分才继续。
 */
async function fetchSolveCounts(gymId, wid) {
  const counts = new Map();
  let meta = null;
  for (let page = 1; page <= 5; page++) {
    const url = page === 1 ? `${CF}/gym/${gymId}/standings` : `${CF}/gym/${gymId}/standings/page/${page}`;
    const r = await nav(
      url,
      wid,
      (html) => /<table class="standings"/.test(html) || /no submissions|standings.*not visible/i.test(html),
    );
    if (r.status !== 'ok') return null;
    const p = parseStandingsSolved(r.html);
    if (!p) return null;
    meta ??= { letters: p.letters, idOrder: p.idOrder };
    for (const [pid, n] of p.counts) counts.set(pid, (counts.get(pid) ?? 0) + n);
    const best = Math.max(0, ...counts.values());
    if (best > SOLVE_THRESHOLD) break; // 已确认超阈值，无需更多页
    if (p.rowsWithoutSolve > 0 || p.dataRows === 0) break; // 全零分之后的行不可能再有通过
    if (p.dataRows < 100) break; // 未满页 = 最后一页
  }
  return { ...meta, counts };
}

/** 取准入判定（缓存进 contests.json：一次判定，永不重复消耗导航预算）。
 *  standings 拉取失败（质询/网络）只返回「本轮跳过」不落盘 —— 那是瞬时故障，
 *  落盘会把本可通过规则 2 的场次永久错杀；只有真实读到 standings 才判 ≤100。 */
async function ensurePullDecision(c, wid) {
  if (c.pullDecision) return c.pullDecision;
  let d;
  if (isOfficialGym(c)) {
    d = { eligible: true, reason: `official: ${c.gymKind}` };
  } else {
    const s = await fetchSolveCounts(c.id, wid);
    if (!s) {
      log('cf-gyms', `gym/${c.id}: standings 本轮不可得（质询/网络），下轮重试`);
      return { eligible: false, reason: 'pending: standings 不可得', transient: true };
    }
    const best = Math.max(0, ...s.counts.values());
    d =
      best > SOLVE_THRESHOLD
        ? { eligible: true, reason: `maxSolved=${best}` }
        : { eligible: false, reason: `maxSolved=${best} ≤ ${SOLVE_THRESHOLD}` };
  }
  upsertGym({ id: c.id, pullDecision: d });
  flushContests();
  log('cf-gyms', `gym/${c.id}: pull ${d.eligible ? 'yes' : 'no'} (${d.reason})`);
  return d;
}

/* ---------------- 规则 1：站内 codeforces 题库复用 ---------------- */

const normTitle = (t) =>
  String(t ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');

let cfTitleIndexCache = null;
function cfTitleIndex() {
  if (cfTitleIndexCache) return cfTitleIndexCache;
  cfTitleIndexCache = new Map();
  const idx = readJson(path.join(process.cwd(), 'data', 'index.json'));
  for (const p of idx?.problems ?? []) {
    if (p.platform !== 'codeforces') continue;
    const key = normTitle(p.title);
    if (!key) continue;
    const prev = cfTitleIndexCache.get(key);
    if (prev) prev.dup = true;
    else cfTitleIndexCache.set(key, { id: p.id, dup: false });
  }
  log('cf-gyms', `reuse index: ${cfTitleIndexCache.size} 个唯一 CF 题名`);
  return cfTitleIndexCache;
}

/** gym 题名唯一命中站内 codeforces 题库 → 返回原题 id；命中多条或没有 → null。 */
function matchCfProblem(title) {
  const key = normTitle(sanitizeRowTitle(title));
  if (!key) return null;
  const hit = cfTitleIndex().get(key);
  return hit && !hit.dup ? hit.id : null;
}

async function fetchProblemsPhase({ limitGyms, maxProblemPages, minutes }) {
  const startedAt = Date.now();
  const deadline = minutes ? startedAt + minutes * 60000 : null;
  const t = (c) => (c.startTime ? new Date(c.startTime).getTime() : 0);
  const only = args.onlyGym
    ? new Set(String(args.onlyGym).split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const jobs = contests()
    .filter((c) => !only || only.has(String(c.id)))
    .filter((c) => {
      if (exhausted(`/gym/${c.id}`)) return false;
      // 准入规则 2 已判定不达标的场次直接出局（判定持久化在 pullDecision）
      if (c.pullDecision && !c.pullDecision.eligible) return false;
      // 这些状态说明题目确认不可得（或比赛还没开打），等列表前向演进再入队
      if (['restricted', 'deleted', 'no-problems-visible', 'empty', 'upcoming'].includes(c.gymStatus)) return false;
      if (!c.problems.length) return true; // 需要访问 gym 页发现题目集合
      return c.problems.some((pid) => !problemComplete(PLATFORM, pid));
    })
    .filter((c) => !c.problems.length || !c.problems.every((pid) => exhausted(attemptKeyFor(c.id, pid.slice(String(c.id).length)))))
    .sort((a, b) => t(b) - t(a));
  if (limitGyms) jobs.length = Math.min(jobs.length, limitGyms);
  let fetchedPages = 0;
  let doneGyms = 0;
  log(
    'cf-gyms',
    `problems phase: ${jobs.length} gyms queued (budget pages=${maxProblemPages ?? '∞'}, minutes=${minutes ?? '∞'})`,
  );
  if (args.dryRun) {
    for (const c of jobs.slice(0, 20)) log('cf-gyms', `  plan: gym/${c.id} pending=${c.problems.filter((pid) => !problemComplete(PLATFORM, pid)).length}/${c.problems.length}`);
    log('cf-gyms', 'dry-run: stop before fetching');
    return { fetchedPages: 0, doneGyms: 0 };
  }

  let cursor = 0;
  const nextJob = () => (cursor < jobs.length ? jobs[cursor++] : null);

  async function fetchGym(c, wid, depth = 0) {
    const id = +c.id;
    // 准入规则 2：官方发起 或 一题通过 > 100 人，否则不拉题面（判定落盘不重复消耗）
    const dec = await ensurePullDecision(c, wid);
    if (!dec.eligible) return;
    const r = await nav(`${CF}/gym/${id}`, wid, gymPageReady(id));
    if (r.status === 'notfound') {
      upsertGym({ id, gymStatus: 'deleted' });
      return;
    }
    if (r.status !== 'ok') {
      fail(`/gym/${id}`, r.status);
      return;
    }
    succeed(`/gym/${id}`);
    const g = parseGymPage(r.html, id);
    if (g.gate && !g.links.length && !loginDone && args.login && depth === 0 && (await login())) {
      return fetchGym(c, wid, depth + 1); // 登录成功重试一次
    }
    upsertGym({
      id,
      problems: g.links.map((l) => problemId(id, l.index)),
      title: c.title ?? g.title,
      startTime: c.startTime ?? g.startTime,
      durationSeconds: c.durationSeconds ?? g.durationSeconds,
      season: c.season ?? g.season,
      contestType: c.contestType ?? g.contestType,
      gymStatus: g.links.length
        ? 'ok'
        : ['upcoming', 'running'].includes(c.gymStatus)
          ? c.gymStatus
          : g.gate
            ? 'restricted'
            : 'no-problems-visible',
    });
    if (!g.links.length) {
      log('cf-gyms', `gym/${id}: no problems visible (${g.gate ? 'restricted' : 'empty'})`);
      return;
    }
    let fetched = 0;
    for (const link of g.links) {
      if (stopping) return;
      const pid = problemId(id, link.index);
      if (problemComplete(PLATFORM, pid)) continue;
      const key = attemptKeyFor(id, link.index);
      if (exhausted(key)) continue;
      // 准入规则 1：站内 codeforces 题库已有该题（题名唯一命中）→ 存 reuseOf 存根
      const reuseId = matchCfProblem(link.title);
      if (reuseId) {
        saveProblem(PLATFORM, {
          id: pid,
          platform: PLATFORM,
          contestId: id,
          index: link.index,
          title: sanitizeRowTitle(link.title) ?? null,
          titleZh: null,
          url: `${CF}/gym/${id}/problem/${link.index}`,
          difficulty: null,
          tags: [],
          points: null,
          timeLimitMs: null,
          memoryLimitMb: null,
          statementMd: null,
          statementZhMd: null,
          samples: [],
          reuseOf: reuseId,
          language: 'en',
          fetchedAt: new Date().toISOString(),
        });
        log('cf-gyms', `reuse ${pid} -> codeforces/${reuseId}`);
        succeed(key);
        state.stats.problemsFetched++;
        fetched++;
        continue;
      }
      const url = `${CF}/gym/${id}/problem/${link.index}`;
      let pr = await nav(url, wid, problemPageReady(id, link.index));
      fetchedPages++;
      if (pr.status === 'pdf') {
        try {
          const { bytes, textLen } = await savePdfProblem({ gymId: id, index: link.index, url, link, wid });
          log('cf-gyms', `pdf ${pid}: ${(bytes / 1024).toFixed(0)}KB, text=${textLen} chars`);
          succeed(key);
          state.stats.problemsFetched++;
          fetched++;
        } catch (e) {
          fail(key, `pdf: ${String(e).slice(0, 120)}`);
        }
        continue;
      }
      if (pr.status !== 'ok') {
        fail(key, pr.status);
        continue;
      }
      let stmt = null;
      for (let attempt = 0; attempt < 2 && !stmt; attempt++) {
        if (attempt > 0) {
          // 流式截断等偶发窗口：原地重抓一次
          pr = await nav(url, wid, problemPageReady(id, link.index));
          if (pr.status !== 'ok') break;
        }
        const parsed = parseCfProblemsPage(pr.html, id, url);
        const s = parsed[0];
        if (s?.statementMd?.trim()) {
          stmt = s;
          break;
        }
        if (GATE_RE.test(pr.html) && !loginDone && args.login && depth === 0 && (await login())) {
          return fetchGym(c, wid, depth + 1); // 登录墙：登录后整场重试
        }
      }
      if (!stmt) {
        fail(key, 'statement empty/not parsed');
        continue;
      }
      saveProblem(PLATFORM, {
        id: pid,
        platform: PLATFORM,
        contestId: id,
        index: link.index,
        title: stmt.title ?? sanitizeRowTitle(link.title) ?? null,
        titleZh: null,
        url: `${CF}/gym/${id}/problem/${link.index}`,
        difficulty: null,
        tags: [],
        points: stmt.points ?? null,
        timeLimitMs: stmt.timeLimitMs ?? null,
        memoryLimitMb: stmt.memoryLimitMb ?? null,
        statementMd: stmt.statementMd,
        statementZhMd: null,
        samples: cleanSamples(stmt.samples),
        language: 'en',
        fetchedAt: new Date().toISOString(),
      });
      succeed(key);
      state.stats.problemsFetched++;
      fetched++;
    }
    state.stats.gymsFetched++;
    doneGyms++;
    // 每场都落盘：题面文件已写但 contests.json 未同步时，索引会落后于磁盘
    // （文件成孤儿，监控页面数虚高）。单场写 ~1MB，成本可接受。
    flushContests();
    saveAttempts();
    if (doneGyms % 10 === 0) {
      saveState();
      log(
        'cf-gyms',
        `progress: gyms=${doneGyms}/${jobs.length} problemPages=${fetchedPages} elapsed=${Math.round((Date.now() - startedAt) / 60000)}min`,
      );
    }
    log('cf-gyms', `gym/${id}: fetched=${fetched} total=${g.links.length}`);
  }

  async function worker(wid) {
    for (;;) {
      if (stopping) return;
      if (deadline && Date.now() > deadline) return;
      if (maxProblemPages && fetchedPages >= maxProblemPages) return;
      const c = nextJob();
      if (!c) return;
      try {
        await fetchGym(c, wid);
      } catch (e) {
        log('cf-gyms', `gym/${c.id} worker error: ${String(e).slice(0, 140)}`);
        fail(`/gym/${c.id}`, String(e).slice(0, 150));
        await relaunch().catch(() => {});
      }
    }
  }

  await ensureBrowser();
  while (pages.length < concurrency) pages.push(await newPage());
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  flushContests();
  saveState();
  saveAttempts();
  log('cf-gyms', `problems phase done: gyms=${doneGyms} pages=${fetchedPages} elapsed=${Math.round((Date.now() - startedAt) / 60000)}min`);
  return { fetchedPages, doneGyms };
}

/* ---------------- 校验 ---------------- */

function verify({ failOnGaps }) {
  const cs = contests();
  const counts = {};
  const gaps = [];
  const warnings = [];
  let skippedPull = 0;
  for (const c of cs) {
    const s = c.gymStatus ?? 'unknown';
    counts[s] = (counts[s] ?? 0) + 1;
    if (['restricted', 'deleted', 'upcoming', 'no-problems-visible', 'empty'].includes(s)) continue;
    // 准入规则 2 判定不达标：不拉题面是预期行为，不算缺口
    if (c.pullDecision && !c.pullDecision.eligible) {
      skippedPull++;
      continue;
    }
    if (!c.problems.length) {
      warnings.push(`gym/${c.id} status=${s} 无题目记录`);
      continue;
    }
    for (const pid of c.problems) {
      if (!problemComplete(PLATFORM, pid)) {
        gaps.push({ gym: c.id, index: pid.slice(String(c.id).length), key: attemptKeyFor(c.id, pid.slice(String(c.id).length)) });
      }
    }
  }
  const reused = cs.reduce(
    (acc, c) => acc + c.problems.filter((pid) => loadProblem(PLATFORM, pid)?.reuseOf).length,
    0,
  );
  const metaIncomplete = cs.filter((c) => !c.title || (c.listed && c.gymStatus !== 'deleted' && c.startTime == null)).length;
  log(
    'cf-gyms',
    `verify: contests=${cs.length} status=${JSON.stringify(counts)} gaps=${gaps.length} warnings=${warnings.length} skippedPull=${skippedPull} reused=${reused} metaIncomplete=${metaIncomplete}`,
  );
  for (const w of warnings.slice(0, 20)) log('cf-gyms', `  warn: ${w}`);
  for (const g of gaps.slice(0, 30)) log('cf-gyms', `  gap: gym/${g.gym} problem ${g.index} (${attempts[g.key]?.lastError ?? 'incomplete'})`);
  if (gaps.length > 30) log('cf-gyms', `  ... and ${gaps.length - 30} more gaps`);
  saveAttempts();
  if (failOnGaps && gaps.length) {
    log('cf-gyms', 'verify FAILED: gaps remain (exit 1)');
    return { gaps, exit: 1 };
  }
  return { gaps, exit: 0 };
}

/* ---------------- 状态打印 ---------------- */

function printStatus() {
  const cs = contests();
  const byStatus = {};
  for (const c of cs) byStatus[c.gymStatus ?? 'unknown'] = (byStatus[c.gymStatus ?? 'unknown'] ?? 0) + 1;
  const problemsTotal = cs.reduce((acc, c) => acc + c.problems.length, 0);
  const problemsDone = cs.reduce((acc, c) => acc + c.problems.filter((pid) => problemComplete(PLATFORM, pid)).length, 0);
  console.log(
    JSON.stringify(
      {
        mode: 'status',
        contests: cs.length,
        byStatus,
        problemsTotal,
        problemsDone,
        problemsPending: problemsTotal - problemsDone,
        sweptMaxId: sweepState.sweptMaxId,
        deletedCount: sweepState.deletedIds.length,
        lastFullListingAt: state.lastFullListingAt,
        attemptFailures: Object.keys(attempts).length,
        stats: state.stats,
      },
      null,
      2,
    ),
  );
}

/* ---------------- 主流程 ---------------- */

async function main() {
  fs.mkdirSync(path.join(DATA, 'problems'), { recursive: true });
  state.stats.runs++;
  const startedAt = Date.now();

  if (MODE === 'status') {
    printStatus();
    return;
  }

  if (MODE === 'verify') {
    if (args.repair) {
      // 先清零缺漏账本再回填，之后复验
      for (const c of contests())
        for (const pid of c.problems)
          if (!problemComplete(PLATFORM, pid)) delete attempts[attemptKeyFor(c.id, pid.slice(String(c.id).length))];
      attemptsDirty = true;
      saveAttempts();
      await fetchProblemsPhase({
        limitGyms: args.limitGyms,
        maxProblemPages: args.maxProblemPages ?? 3000,
        minutes: args.minutes,
      });
    }
    const { exit } = verify({ failOnGaps: true });
    process.exitCode = exit;
    return;
  }

  await ensureBrowser();
  try {
    // 准入规则 2 的官方判定依赖 kind 元数据：进题面阶段前先用官方 API 批量补全
    await enrichGymsFromApi();
    if (MODE === 'full') {
      await scanListing(args.listingPages ?? Infinity);
      await sweepIds(args.sweepLimit ?? Infinity);
      await fetchProblemsPhase({
        limitGyms: args.limitGyms,
        maxProblemPages: args.maxProblemPages,
        minutes: args.minutes,
      });
    } else if (MODE === 'problems') {
      // 只跑题面阶段：列表与 ID 补扫已完整时用（面板长跑/纯回填）。
      // 不碰 /gyms/page/N（那是最容易触发质询的入口），新赛收录交给 CI 增量。
      await fetchProblemsPhase({
        limitGyms: args.limitGyms,
        maxProblemPages: args.maxProblemPages ?? Infinity,
        minutes: args.minutes,
      });
    } else {
      // incremental（CI 默认）
      await scanListing(args.listingPages ?? Math.min(3, state.listingPageCount || 3));
      await sweepIds(args.sweepLimit ?? 300);
      await fetchProblemsPhase({
        limitGyms: args.limitGyms,
        maxProblemPages: args.maxProblemPages ?? 400,
        minutes: args.minutes ?? 38,
      });
    }
  } finally {
    saveState();
    saveAttempts();
    log('cf-gyms', `run done in ${Math.round((Date.now() - startedAt) / 1000)}s`);
    await ctx?.close().catch(() => {});
  }
}

process.on('SIGINT', () => {
  if (stopping) process.exit(130);
  stopping = true;
  log('cf-gyms', 'SIGINT — 完成当前抓取后存档退出…');
});
process.on('SIGTERM', () => {
  stopping = true;
});

main().catch((e) => {
  log('cf-gyms', `FATAL: ${e.stack ?? e}`);
  saveState();
  saveAttempts();
  process.exitCode = 2;
});
