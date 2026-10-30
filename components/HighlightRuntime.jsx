'use client';

import hljs from 'highlight.js/lib/common';
import { useEffect } from 'react';

/**
 * 客户端为 `<pre class="code-block" data-lang>` 套 highlight.js 配色。
 * 配色类在 globals.css 里按本站暗色主题定义，不引入外部主题 css。
 */

let installed = false;

function highlightIn(root) {
  const blocks = root.querySelectorAll?.('pre.code-block[data-lang] code');
  if (!blocks || !blocks.length) return;
  for (const code of blocks) {
    if (code.dataset.hl) continue;
    code.dataset.hl = '1';
    const lang = code.closest('pre')?.dataset.lang;
    try {
      if (lang && hljs.getLanguage(lang)) {
        code.innerHTML = hljs.highlight(code.textContent, { language: lang }).value;
      }
    } catch {
      /* 保留纯文本 */
    }
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
      highlightIn(document.body);
    });
  };
  new MutationObserver(sweep).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: false,
    attributes: false,
  });
}

export default function HighlightRuntime() {
  useEffect(() => {
    install();
    queueMicrotask(() => highlightIn(document.body));
  }, []);
  return null;
}
