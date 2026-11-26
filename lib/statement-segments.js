/**
 * 站内 markdown 题面的分段工具（client/server 通用）。
 *
 * 数据管道把整篇题面存为一个 markdown 字符串（statementMd / statementZhMd）。
 * 对照式逐段翻译需要把原文/译文切成一一对应的段落数组：
 *
 *  1. 先按空行切块（代码块保持完整）；
 *  2. 块数一致 → 逐块配对；
 *  3. 不一致 → 按 `##` 小节标题对齐（中英标题归一为同一键），小节内块数
 *     一致则逐块配对，否则整节配对；无法对齐的小节译文记 null（交给本机
 *     实时翻译渠道补齐）。
 */

/**
 * 逐字符扫描数学定界符，返回行末是否仍处在公式里。
 * `$` 与 `$$` 各自切换（$ 转义忽略），围栏代码块内不扫描。
 * 为什么需要：题面里有跨空行的大公式（codeforces/1060h 的 `$\begin{array}…\end{array}$`
 * 交互表），按空行硬切会把公式拦腰截断成几段半截公式，渲染出 KaTeX 报错框。
 */
function scanMathState(line, state) {
  let next = state;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '\\') {
      i += 1;
      continue;
    }
    if (line[i] !== '$') continue;
    if (line[i + 1] === '$') {
      next = next === 'display' ? 'none' : 'display';
      i += 1;
    } else {
      next = next === 'inline' ? 'none' : next === 'display' ? 'display' : 'inline';
    }
  }
  return next;
}

/** markdown → 段落块数组（保留代码块与跨行公式的完整性；按空行切分）。 */
export function splitBlocks(md) {
  if (!md) return [];
  const out = [];
  let buf = [];
  let inFence = false;
  let math = 'none';
  for (const line of String(md).split('\n')) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
    } else if (!inFence) {
      math = scanMathState(line, math);
    }
    if (!inFence && math === 'none' && line.trim() === '' && buf.length) {
      out.push(buf.join('\n'));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) out.push(buf.join('\n'));
  return out;
}

/** 小节标题归一键（中英对照），无法识别返回 null。 */
function sectionKey(heading) {
  const t = String(heading)
    .replace(/^#{1,4}\s*/, '')
    .replace(/[*_`]/g, '')
    .trim()
    .toLowerCase();
  if (/^(problem statement|問題文|题目描述)$/.test(t)) return 'PS';
  if (/^(constraints|制約|约束条件|约束)$/.test(t)) return 'CON';
  if (/^(input(\s*format)?|入力|输入格式|输入)$/.test(t)) return 'IN';
  if (/^(output(\s*format)?|出力|输出格式|输出)$/.test(t)) return 'OUT';
  if (/^(notes?|hints?|備考|说明|註|注)$/.test(t)) return 'NOTE';
  if (/^(scoring|配点|评分)$/.test(t)) return 'SCORE';
  if (/^(interaction|交互|入出力例)$/.test(t)) return 'INTER';
  return null;
}

/** 块列表 → 小节序列 [{key|null, heading, blocks}]。 */
function toSections(blocks) {
  const sections = [];
  let cur = { key: null, heading: null, blocks: [] };
  for (const b of blocks) {
    const m = /^#{1,4}\s+/.exec(b);
    const key = m ? sectionKey(b) : null;
    if (key) {
      if (cur.blocks.length || cur.heading) sections.push(cur);
      cur = { key, heading: b, blocks: [] };
    } else {
      cur.blocks.push(b);
    }
  }
  if (cur.blocks.length || cur.heading) sections.push(cur);
  return sections;
}

const joinBlocks = (blocks) => blocks.join('\n\n');

/** 只含图片的块（抓取时图片会插成独立段落，中英两侧数量常不一致）。 */
const IMAGE_ONLY = /^(?:\s*!\[[^\]]*\]\([^)]*\)\s*)+$/;
const isImageOnly = (block) => IMAGE_ONLY.test(String(block ?? '').trim());

/**
 * 块数不等时先去掉「纯图片」块再试一次：题册解析把中文侧的插图单独成段，
 * 而英文侧同一张图被去重（lib/problem-set-html 的 seenImages），
 * 直接按块数比较会整节退化成「一个大段」，其余段落全部拿不到译文。
 * 返回对齐后的 [{en, zh}]；无法对齐返回 null。
 */
function pairBlocksLoose(enBlocks, zhBlocks) {
  if (enBlocks.length === zhBlocks.length) return enBlocks.map((b, i) => ({ en: b, zh: zhBlocks[i] }));
  const enNoImg = enBlocks.filter((b) => !isImageOnly(b));
  const zhNoImg = zhBlocks.filter((b) => !isImageOnly(b));
  if (enNoImg.length !== zhNoImg.length) return null;
  return enBlocks.map((b) => {
    if (isImageOnly(b)) return { en: b, zh: null };
    const idx = enNoImg.indexOf(b);
    return { en: b, zh: zhNoImg[idx] ?? null };
  });
}

/**
 * 配对原文/译文。返回 segments: [{ en, zh|null }]（一一对应，zh 为该段的
 * CI 存档译文，null 表示存档未覆盖）。
 */
export function pairSegments(enMd, zhMd) {
  const en = splitBlocks(enMd);
  const zh = splitBlocks(zhMd);
  if (!zhMd) return en.map((b) => ({ en: b, zh: null }));

  // 1) 块数一致：直接逐块配对
  if (en.length === zh.length) return en.map((b, i) => ({ en: b, zh: zh[i] }));

  // 2) 只差「纯图片」块（题册解析在中文侧把插图单独成段、英文侧去重）：
  //    剔除图片块后逐块配对，比整篇退化成一段准确得多
  const loose = pairBlocksLoose(en, zh);
  if (loose) return loose;

  // 3) 小节标题对齐
  const enSecs = toSections(en);
  const zhSecs = toSections(zh);
  const zhByKey = new Map();
  for (const s of zhSecs) if (s.key && !zhByKey.has(s.key)) zhByKey.set(s.key, s);
  // 无小节标题的段（题面开头的引入、结尾的样例说明）数量一致时按出现顺序
  // 配对；数量不一致就不猜，宁可留空交给调用方。
  const zhUnkeyed = zhSecs.filter((s) => !s.key);
  const enUnkeyedCount = enSecs.filter((s) => !s.key).length;
  let unkeyedCursor = 0;
  const used = new Set();
  const segs = [];
  let aligned = 0;
  for (const es of enSecs) {
    const zs = es.key
      ? zhByKey.get(es.key)
      : zhUnkeyed.length === enUnkeyedCount
        ? zhUnkeyed[unkeyedCursor]
        : null;
    if (!es.key && zs) unkeyedCursor += 1;
    if (zs && !used.has(zs)) {
      used.add(zs);
      // 只有「识别出的小节」才算对齐成功，无标题段配对不抬高可信度
      if (es.key) aligned += 1;
      if (es.heading !== null) segs.push({ en: es.heading, zh: zs.heading ?? es.heading });
      const pairs = pairBlocksLoose(es.blocks, zs.blocks);
      if (pairs) {
        segs.push(...pairs);
      } else {
        segs.push({ en: joinBlocks(es.blocks), zh: joinBlocks(zs.blocks) });
      }
    } else {
      if (es.heading !== null) segs.push({ en: es.heading, zh: null });
      for (const b of es.blocks) segs.push({ en: b, zh: null });
    }
  }
  if (aligned >= 2) return segs;

  // 4) 对齐失败：整篇回退为单段
  return [{ en: joinBlocks(en), zh: joinBlocks(zh) }];
}
