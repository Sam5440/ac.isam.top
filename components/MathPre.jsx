'use client';

import { useMemo } from 'react';

import { hasMathTex } from '@/lib/math-detect';
import { renderRich } from '@/lib/render';

/**
 * 样例输入/输出展示区（CopyBox 的内容部分）。raw=null 时自动检测：文本含
 * TeX 公式（$…$ / $$…$$ / \(…\) / \[…\] / \begin{…}）则走 renderRich 产出
 * <code class="zs-math"> 惰性 token，由全局 KatexRuntime 换成真正的 KaTeX
 * 标记；无公式保持 <pre><code> 纯文本现状。raw 显式为 true/false 时强制
 * 对应形态（盒头「原文/渲染」∑ 切换按钮的局部状态由 CopyBox 持有）。
 * 渲染形态丢弃 <pre> 改用 whitespace-pre-wrap 的 div，规避 KaTeX token
 * 嵌入 pre 的未知行为；复制永远由 CopyBox 基于原始 text prop，与本组件无关。
 */
export default function MathPre({ text, raw = null, className = '' }) {
  const hasMath = useMemo(() => hasMathTex(text), [text]);
  const showRaw = raw === null ? !hasMath : raw;
  if (showRaw) {
    return (
      <pre className={`overflow-x-auto p-3 font-mono text-[13px] leading-6 text-foreground/90 ${className}`}>
        <code>{text}</code>
      </pre>
    );
  }
  return (
    <div
      className={`whitespace-pre-wrap break-words p-3 font-mono text-[13px] leading-6 text-foreground/90 [&_p]:m-0 ${className}`}
      dangerouslySetInnerHTML={{ __html: renderRich(text) }}
    />
  );
}
