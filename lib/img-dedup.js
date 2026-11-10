import { parseFragment, serialize } from 'parse5';

/**
 * 对照模式图片去重（纯模块，node 可测）。
 *
 * 对照模式下 EN 段与 ZH 段各自经 renderRich 渲染，翻译保留原图时同一张图
 * 会在中英两侧各渲染一次。这里用 parse5 解析 html 收集 / 剔除 <img src>：
 *  - extractImgSrcs：收集全部 img src（parse5 解析属性时天然完成实体解码，
 *    `&amp;` 与字面 `&` 归一为同一字符串）；
 *  - imgDedup：删除 src ∈ seenSrcs 的 img，并对同一 html 内的重复 src
 *    只保留首次出现；其余内容（含 referrerpolicy 等属性）原样保留。
 */

function imgSrcOf(node) {
  const attr = (node.attrs ?? []).find((a) => a.name.toLowerCase() === 'src');
  return attr?.value || null;
}

function collectImgSrcs(parent, into) {
  for (const child of parent.childNodes ?? []) {
    if (child.tagName?.toLowerCase() === 'img') {
      const src = imgSrcOf(child);
      if (src) into.add(src);
    }
    collectImgSrcs(child, into);
  }
}

/** 收集 html 中全部 <img> 的 src（去重为 Set）。非字符串 / 空串 → 空 Set。 */
export function extractImgSrcs(html) {
  const srcs = new Set();
  if (typeof html !== 'string' || !html) return srcs;
  collectImgSrcs(parseFragment(html), srcs);
  return srcs;
}

function dropSeenImgs(parent, seenSrcs, localSeen) {
  for (let i = 0; i < (parent.childNodes?.length ?? 0);) {
    const child = parent.childNodes[i];
    if (child.tagName?.toLowerCase() === 'img') {
      const src = imgSrcOf(child);
      if (src && (seenSrcs.has(src) || localSeen.has(src))) {
        parent.childNodes.splice(i, 1);
        continue;
      }
      if (src) localSeen.add(src);
    } else {
      dropSeenImgs(child, seenSrcs, localSeen);
    }
    i += 1;
  }
}

/**
 * 删除 html 中 src 已出现在 seenSrcs 的 <img>，并按遍历顺序对 html 内部
 * 重复的 src 只保留第一张。非字符串 / 空串 → ''。
 */
export function imgDedup(html, seenSrcs) {
  if (typeof html !== 'string' || !html) return '';
  const fragment = parseFragment(html);
  dropSeenImgs(fragment, seenSrcs instanceof Set ? seenSrcs : new Set(seenSrcs ?? []), new Set());
  return serialize(fragment);
}
