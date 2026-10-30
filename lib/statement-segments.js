/**
 * 站内 markdown 题面的分段工具（client/server 通用）。
 *
 * 数据管道把整篇题面存为一个 markdown 字符串（statementMd / statementZhMd）。
 * 对照式逐段翻译需要按段落配对：按空行切块后，若原文与译文块数一致则逐块
 * 配对（翻译管线被要求保持段落结构，绝大多数题满足）；不一致时配对失败，
 * CI 译文只能作为整篇回退（statementZhMd 全文），逐段翻译交给本机渠道。
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

/**
 * 配对原文/译文块。返回 { paired: [en, zh|null][], wholeFallback: zhDoc|null }。
 * - 块数一致 → paired，每块可独立显示译文（CI 存档渠道 'ai' 覆盖全部块）
 * - 不一致 → paired 每块译文 null，wholeFallback = 整篇译文
 */
export function pairBlocks(enMd, zhMd) {
  const en = splitBlocks(enMd);
  const zh = splitBlocks(zhMd);
  const ok = zhMd && en.length === zh.length;
  return {
    enBlocks: en,
    zhBlocks: ok ? zh : null,
    wholeFallback: !ok ? zhMd || null : null,
  };
}
