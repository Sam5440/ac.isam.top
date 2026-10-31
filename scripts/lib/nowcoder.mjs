import { httpGet } from './http.mjs';
import { loadHtml, nodesToMd, preText } from './html2md.mjs';

/**
 * 牛客竞赛（ac.nowcoder.com）抓取。
 *
 * 接口（2026-10 实测）：
 *  - 比赛列表：/acm/contest/vip-index?topCategoryFilter=13&page=N&pageSize=20
 *    （服务端渲染 HTML，每张卡片 data-json 内嵌比赛元数据；topCategoryFilter=13
 *    即「牛客竞赛」官方专辑：周赛 / 练习赛 / 小白月赛 / 挑战赛 / 集训派对等）
 *  - 题目清单：/acm/contest/problem-list?token=&id={cid}（JSON，无需登录）
 *  - 题面：/acm/contest/{cid}/{index}（服务端渲染 HTML；公式为
 *    nowcoder.com/equation?tex= 服务端 SVG 图，alt 属性即原始 TeX，
 *    由 html2md 还原为 $…$ 行内公式）
 *
 * 牛客题面为中文，抓取时 statementZhMd 直接取原文（translateModel='官方原文'），
 * AI 翻译管线自动跳过。
 */

const NC = 'https://ac.nowcoder.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 官方专辑 id（vip-index 的 topCategoryFilter），当前为 13（牛客竞赛）。 */
export const NC_OFFICIAL_CATEGORY = 13;

/** 标题是否中文：牛客不少题标题是英文（如小白月赛），英文标题交给翻译/MT。 */
export const isZhTitle = (t) => /[\u4e00-\u9fff]/.test(String(t || ''));

/**
 * 牛客官方赛事名模式。匿名前端没有历史列表接口（vip-index 纯 SSR 只出最新
 * 一页且忽略 page 参数），历史比赛只能按 contest id 倒序探测：problem-list
 * 返回 code=0 即有效比赛，再取页面标题按这些模式判定官方赛事。
 */
export const NC_SERIES_RE =
  /牛客\s*(周赛|练习赛|小白月赛|月赛|挑战赛|集训派对|集训营|多校|百校|原创赛|娱乐赛|女生赛| binary|寒假|暑假)/i;

export function isOfficialNowcoderTitle(title) {
  return NC_SERIES_RE.test(String(title));
}

/** 比赛页 <title>（"牛客练习赛158_ACM/NOI/..._牛客竞赛OJ"）→ 比赛名。 */
export function contestNameFromPageTitle(html) {
  const m = /<title>([^<]+)<\/title>/.exec(html);
  if (!m) return null;
  return m[1].split('_')[0].trim();
}

/**
 * 从 fromId 起倒序探测至多 maxProbe 个 contest id，返回发现的官方比赛。
 * 每个候选用 problem-list（小 JSON）探测，命中才抓比赛页取名字。
 */
export async function scanNowcoderContestsById({ fromId, maxProbe = 240, onProgress } = {}) {
  const found = [];
  let probed = 0;
  let id = fromId;
  for (; probed < maxProbe && id > 1000; id--, probed++) {
    let ok = false;
    try {
      const data = await httpGet(`${NC}/acm/contest/problem-list?token=&id=${id}`, {
        json: true,
        timeout: 15000,
        retries: 1,
      });
      ok = data.code === 0 && Array.isArray(data.data?.data) && data.data.data.length > 0;
    } catch {
      ok = false; // 非 JSON（404 页）/网络错 —— 非 比赛 或临时失败，跳过
    }
    if (ok) {
      try {
        const html = await httpGet(`${NC}/acm/contest/${id}`, { timeout: 20000, retries: 1 });
        const name = contestNameFromPageTitle(html);
        if (name && isOfficialNowcoderTitle(name)) {
          found.push({
            id: String(id),
            platform: 'nowcoder',
            title: name,
            startTime: null, // 无接口提供时间；站点按 id 排序展示
            durationSeconds: null,
            url: nowcoderContestUrl(id),
          });
        }
      } catch {}
    }
    if (onProgress && probed % 20 === 0) onProgress(probed, maxProbe, found.length);
    await new Promise((r) => setTimeout(r, 280));
  }
  return { contests: found, scanned: probed, nextId: id + 1 };
}

export function nowcoderContestUrl(contestId) {
  return `${NC}/acm/contest/${contestId}`;
}

export function nowcoderProblemUrl(contestId, index) {
  return `${NC}/acm/contest/${contestId}/${index}`;
}

/**
 * 抓取官方比赛列表（已结束，新→旧）。
 * @param {number} pages 最多翻的页数（每页 20 条）
 */
export async function fetchNowcoderContests(pages = 5) {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= pages; page++) {
    const html = await httpGet(
      `${NC}/acm/contest/vip-index?topCategoryFilter=${NC_OFFICIAL_CATEGORY}&page=${page}&pageSize=20`,
      { timeout: 25000, retries: 2 },
    );
    const $ = loadHtml(html);
    const items = $('div.platform-item[data-id]').toArray();
    if (!items.length) break;
    const now = Date.now();
    for (const node of items) {
      const el = $(node);
      let meta;
      try {
        // data-json 为 HTML 属性里的双层实体编码 JSON
        meta = JSON.parse(el.attr('data-json').replace(/&quot;/g, '"'));
      } catch {
        continue;
      }
      const id = el.attr('data-id');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const startTime = Number(meta.contestStartTime) || 0;
      const endTime = Number(meta.contestEndTime) || 0;
      if (!endTime || endTime > now) continue; // 只要已结束
      out.push({
        id,
        platform: 'nowcoder',
        title: String(meta.contestName || `contest-${id}`).trim(),
        startTime: new Date(startTime).toISOString(),
        durationSeconds: Math.round((endTime - startTime) / 1000) || null,
        url: nowcoderContestUrl(id),
      });
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  out.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  return out;
}

/** 题目清单（problemId / index / title）。 */
export async function fetchNowcoderProblemList(contestId) {
  const data = await httpGet(`${NC}/acm/contest/problem-list?token=&id=${contestId}`, {
    json: true,
    timeout: 25000,
  });
  if (data.code !== 0 || !data.data?.data) throw new Error(data.msg || 'problem-list failed');
  return data.data.data
    .map((p) => ({
      index: String(p.index ?? '').trim(),
      problemId: p.problemId ?? null,
      title: String(p.title ?? '').trim(),
    }))
    .filter((p) => /^[A-Za-z]/.test(p.index))
    .sort((a, b) => a.index.localeCompare(b.index, undefined, { numeric: true }));
}

/** 时限/空间：'时间限制：C/C++/Rust/Pascal 1秒，其他语言2秒' / '空间限制：C/C++/Rust/Pascal 256 M' */
function parseLimits(text) {
  let timeLimitMs = null;
  let memoryLimitMb = null;
  const tm = text.match(/时间限制[：:][^\d]*(\d+(?:\.\d+)?)\s*秒/);
  if (tm) timeLimitMs = Math.round(parseFloat(tm[1]) * 1000);
  const mm = text.match(/空间限制[：:][^\d]*(\d+)\s*M/i);
  if (mm) memoryLimitMb = parseInt(mm[1], 10);
  return { timeLimitMs, memoryLimitMb };
}

const SECTION_ZH = {
  '题目描述': '## 题目描述',
  '输入描述': '## 输入格式',
  '输出描述': '## 输出格式',
  '备注': '## 说明',
};

function headingMd(raw) {
  const t = String(raw).replace(/[::\s]+$/g, '').trim();
  return SECTION_ZH[t] ?? `## ${t}`;
}

/**
 * 中英文粗判：剥掉公式/代码/链接/图片后按 CJK 字符占比。
 * 官方中文题 >0.9，ICPC 系英文题 <0.02，实测无灰区，阈值 0.2。
 */
function detectLanguage(md) {
  const t = String(md)
    .replace(/\$[^$\n]+?\$/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ');
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  return cjk / Math.max(1, cjk + latin) >= 0.2 ? 'zh' : 'en';
}

/**
 * 抓取单个题面（中文）。返回 { statementMd, samples, timeLimitMs, memoryLimitMb, language }。
 * 结构：question-intr（时限）+ 顶级 h2 小节（题目描述 / 输入描述: / 输出描述: /
 * 示例N（内嵌 h3 输入/输出/说明）/ 备注:）。
 */
export async function fetchNowcoderStatement(contestId, index) {
  const html = await httpGet(nowcoderProblemUrl(contestId, index), { timeout: 25000, retries: 2 });
  const $ = loadHtml(html);
  const opts = { base: nowcoderProblemUrl(contestId, index) };

  const container = $('div.question-module').first();
  if (!container.length) throw new Error('statement container not found');

  const limits = parseLimits(container.find('.subject-item-wrap').first().text() || '');
  container.find('.question-intr').first().remove();
  // 去掉题面操作按钮等噪声
  container.find('.js-full-question, .js-small-question, .icon-fullscreen').remove();

  const sections = [];

  const walk = (title, nodes) => {
    const holder = $('<div>').append(nodes);
    const md = nodesToMd($, holder.children().toArray(), opts);
    if (md) sections.push(`${headingMd(title)}\n\n${md}`);
  };

  // 结构：.terminal-topic > h2.subject-item-title「题目描述」 + .subject-describe
  // （描述文本与后续 h2 小节平级嵌在其内：输入描述 / 输出描述 / 备注）。
  // 样例为独立的 .question-oi 区块（hd=示例N，bd 内 输入/输出/说明 三个 mod，
  // 干净样例文本存于 textarea[data-clipboard-text-id]），先摘出再走小节流。
  const samples = [];
  container.find('.question-oi').each((_, oi) => {
    const el = $(oi);
    const sample = { input: '', output: '' };
    el.find('.question-oi-mod').each((_, mod) => {
      const name = $(mod).children('h2').first().text().replace(/[:：\s]+$/g, '').trim();
      const ta = $(mod).find('textarea[data-clipboard-text-id]').first();
      const text = (ta.length ? ta.text() : preText($(mod).find('pre').first()))
        .replace(/\r/g, '')
        .replace(/\n+$/, '\n');
      if (/^输入/.test(name)) sample.input = text;
      else if (/^输出/.test(name)) sample.output = text;
      else {
        $(mod).find('a, button').remove();
        const rest = nodesToMd($, $(mod).find('.question-oi-cont').children().toArray(), opts);
        if (rest) {
          const note = rest.replace(/\$\\hspace\{\d+pt\}\$/g, '').replace(/\n{3,}/g, '\n\n').trim();
          sample.note = (sample.note ? sample.note + '\n\n' : '') + note;
        }
      }
    });
    samples.push(sample);
    el.remove();
  });

  const describe = container.find('.subject-describe').first();
  const nodes = describe.length ? describe.children().toArray() : container.find('.terminal-topic').children().toArray();
  let curTitle = container.find('h2.subject-item-title').first().text().trim() || '题目描述';
  let curNodes = [];
  for (const node of nodes) {
    if (node.tagName === 'h2') {
      if (curNodes.length || curTitle) walk(curTitle, curNodes);
      curTitle = $(node).text().trim();
      curNodes = [];
    } else {
      curNodes.push(node);
    }
  }
  if (curNodes.length || curTitle) walk(curTitle, curNodes);

  // 牛客用 $\hspace{15pt}$ 作段落缩进，展示无意义，剥离
  const statementMd = sections
    .join('\n\n')
    .replace(/\$\\hspace\{\d+pt\}\$/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!statementMd && samples.length === 0) throw new Error('empty statement');

  // 牛客多为官方中文（译文=原文），但 ICPC 系赛事题面是英文 —— 英文题
  // statementZhMd 置空，交给翻译管线（CI）与站内 MT 兜底
  const language = detectLanguage(statementMd);

  return {
    statementMd,
    statementZhMd: language === 'zh' ? statementMd : null,
    samples,
    timeLimitMs: limits.timeLimitMs,
    memoryLimitMb: limits.memoryLimitMb,
    language,
  };
}
