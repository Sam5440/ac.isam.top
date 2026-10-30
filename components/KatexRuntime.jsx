'use client';

import { useEffect } from 'react';
import katex from 'katex';

/**
 * 把 lib/render.js 输出的 `<code class="zs-math">` 惰性 token 换成真正的
 * KaTeX 标记。MutationObserver 全局监听，首次预渲染、Tab 切换等任何
 * 重新插入的节点都会被捕捉；转换幂等，失败的公式保留原文不再重试。
 */

let installed = false;

function convertIn(root) {
  const tokens = root.querySelectorAll?.('code.zs-math');
  if (!tokens || !tokens.length) return;
  for (const token of tokens) {
    if (token.dataset.kx) continue;
    token.dataset.kx = '1';
    const raw = token.textContent || '';
    let tex = raw;
    if (token.dataset.display === '1' && raw.startsWith('$$') && raw.endsWith('$$')) {
      tex = raw.slice(2, raw.length - 2);
    } else if (raw.startsWith('$') && raw.endsWith('$') && raw.length > 1) {
      tex = raw.slice(1, raw.length - 1);
    }
    let html;
    try {
      html = katex.renderToString(tex, {
        displayMode: token.dataset.display === '1',
        throwOnError: false,
        strict: false,
      });
    } catch {
      continue;
    }
    const holder = document.createElement('template');
    holder.innerHTML = html;
    token.replaceWith(holder.content);
  }
}

function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  let queued = false;
  const sweep = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      convertIn(document.body);
    });
  };
  new MutationObserver(sweep).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: false,
    attributes: false,
  });
}

export default function KatexRuntime() {
  useEffect(() => {
    install();
    queueMicrotask(() => convertIn(document.body));
  }, []);
  return null;
}
