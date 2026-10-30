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

/** markdown → 段落块数组（保留代码块完整性；按空行切分）。 */
export function splitBlocks(md) {
  if (!md) return [];
  const out = [];
  let buf = [];
  let inFence = false;
  for (const line of String(md).split('\n')) {
    if (/^```/.test(line.trim())) inFence = !inFence;
    if (!inFence && line.trim() === '' && buf.length) {
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

  // 2) 小节标题对齐
  const enSecs = toSections(en);
  const zhSecs = toSections(zh);
  const zhByKey = new Map();
  for (const s of zhSecs) if (s.key && !zhByKey.has(s.key)) zhByKey.set(s.key, s);
  const used = new Set();
  const segs = [];
  let aligned = 0;
  for (const es of enSecs) {
    const zs = es.key && zhByKey.get(es.key);
    if (zs && !used.has(zs)) {
      used.add(zs);
      aligned++;
      if (es.heading !== null) segs.push({ en: es.heading, zh: zs.heading ?? es.heading });
      if (es.blocks.length === zs.blocks.length) {
        es.blocks.forEach((b, i) => segs.push({ en: b, zh: zs.blocks[i] }));
      } else {
        segs.push({ en: joinBlocks(es.blocks), zh: joinBlocks(zs.blocks) });
      }
    } else {
      if (es.heading !== null) segs.push({ en: es.heading, zh: null });
      for (const b of es.blocks) segs.push({ en: b, zh: null });
    }
  }
  if (aligned >= 2) return segs;

  // 3) 对齐失败：整篇回退为单段
  return [{ en: joinBlocks(en), zh: joinBlocks(zh) }];
}
