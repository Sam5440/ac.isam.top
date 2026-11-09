'use client';

import { Check, Copy, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

export default function CopyBox({ label, text, tone = 'blue' }) {
  const [state, setState] = useState('idle'); // idle | ok | fail
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const flash = (s) => {
    setState(s);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState('idle'), 1500);
  };

  const copy = async () => {
    // clipboard API 仅安全上下文可用(http 部署/局域网预览下为 undefined),
    // 失败也不再静默 —— 给出「复制失败」反馈
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('execCommand copy failed');
      }
      flash('ok');
    } catch {
      flash('fail');
    }
  };
  const toneCls =
    tone === 'green'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'amber'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-blue-600 dark:text-blue-400';
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5">
        <span className={`text-xs font-semibold uppercase tracking-wider ${toneCls}`}>{label}</span>
        <Button variant="ghost" size="icon" className="size-6" onClick={copy} aria-label={`复制${label}`}>
          {state === 'ok' ? (
            <Check className="size-3.5" />
          ) : state === 'fail' ? (
            <X className="size-3.5 text-destructive" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-6 text-foreground/90">
        <code>{text}</code>
      </pre>
    </div>
  );
}
