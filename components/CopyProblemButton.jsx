'use client';

/**
 * 「复制题目」按钮：一键把题目全文组装为 Markdown 复制到剪贴板。
 *
 * 全文 = 标题 + 元信息（来源/时限/内存）+ 题面 + 样例（含说明）；
 * 题面语言跟随当前题面语言模式（设置里的 对照/英文/中文）：
 *   en   → 原文题面
 *   zh   → 中文题面（无存档译文时回退原文）
 *   both → 原文 + 分隔线 + 中文译文
 */

import { Check, Copy, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useProblemLang } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { PLATFORMS } from '@/lib/platforms';

/** 围栏代码块：内容本身含 ``` 时升级为四反引号围栏。 */
function fenced(text) {
  const t = String(text ?? '').replace(/\n+$/, '');
  const fence = t.includes('```') ? '````' : '```';
  return `${fence}\n${t}\n${fence}`;
}

/** CF 抓取残留的占位说明（"Input/Copy/Output/Copy"）不算真说明。 */
function meaningfulNote(note) {
  const t = String(note || '').trim();
  return t && !/^(?:input|output|copy|\s)+$/i.test(t) ? t : '';
}

function samplesMarkdown(samples) {
  if (!samples?.length) return '';
  const out = ['## 样例'];
  samples.forEach((s, i) => {
    const n = i + 1;
    if (typeof s.input === 'string') out.push(`### 样例 ${n} 输入`, fenced(s.input));
    if (typeof s.output === 'string') out.push(`### 样例 ${n} 输出`, fenced(s.output));
    const note = meaningfulNote(s.note);
    if (note) out.push(`### 样例 ${n} 说明`, note);
  });
  return out.join('\n\n');
}

function buildProblemMarkdown(p, mode) {
  const label = PLATFORMS.find((x) => x.id === p.platform)?.label ?? p.platform;
  const heading = `# ${p.index ? `${p.index}. ` : ''}${p.titleZh || p.title}`;
  const altTitle = p.titleZh && p.titleZh !== p.title ? `（${p.title}）` : '';
  const meta = [
    p.url ? `- 来源：${label} — ${p.url}` : `- 来源：${label}`,
    p.timeLimitMs
      ? `- 时间限制：${(p.timeLimitMs / 1000).toFixed(p.timeLimitMs % 1000 ? 1 : 0)} s`
      : null,
    p.memoryLimitMb ? `- 内存限制：${p.memoryLimitMb} MB` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const en = String(p.statementMd || '').trim();
  const zh = typeof p.statementZhMd === 'string' && p.statementZhMd.trim() ? p.statementZhMd.trim() : null;
  const parts = [heading + altTitle, meta];
  if (mode === 'both') {
    parts.push(en);
    if (zh) parts.push('---', zh);
  } else if (mode === 'zh' && zh) {
    parts.push(zh);
  } else {
    parts.push(en);
  }
  const sm = samplesMarkdown(p.samples);
  if (sm) parts.push(sm);
  return parts.join('\n\n');
}

export default function CopyProblemButton({
  platform,
  index,
  title,
  titleZh,
  url,
  timeLimitMs,
  memoryLimitMb,
  statementMd,
  statementZhMd,
  samples,
}) {
  const lang = useProblemLang(platform);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const flash = (setter) => {
    setter(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 1500);
  };

  const copy = async () => {
    const md = buildProblemMarkdown(
      { platform, index, title, titleZh, url, timeLimitMs, memoryLimitMb, statementMd, statementZhMd, samples },
      lang.mode,
    );
    // clipboard API 仅安全上下文可用;非安全上下文走 execCommand 降级,失败给出提示
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
      } else {
        const ta = document.createElement('textarea');
        ta.value = md;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('execCommand copy failed');
      }
      setFailed(false);
      flash(setCopied);
    } catch {
      setCopied(false);
      flash(setFailed);
    }
  };
  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      onClick={copy}
      title="复制题目全文为 Markdown（语言跟随当前题面模式）"
    >
      {copied ? <Check className="size-3.5" /> : failed ? <X className="size-3.5 text-destructive" /> : <Copy className="size-3.5" />}
      {copied ? '已复制' : failed ? '复制失败' : '复制题目'}
    </Button>
  );
}
