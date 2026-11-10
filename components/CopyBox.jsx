'use client';

import { Check, Copy, Sigma, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import MathPre from '@/components/MathPre';
import { hasMathTex } from '@/lib/math-detect';

export default function CopyBox({ label, text, tone = 'blue' }) {
  const [state, setState] = useState('idle'); // idle | ok | fail
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // 展示形态：null=自动（含公式走渲染），true/false=强制原文/渲染；
  // 切换按钮仅在有公式可切换的盒子里出现，只影响显示、不影响复制内容。
  const [raw, setRaw] = useState(null);
  const hasMath = hasMathTex(text);

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
        <div className="flex items-center gap-0.5">
          {hasMath && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setRaw((r) => !r)}
              aria-label={raw ? `显示渲染结果（${label}）` : `显示原始文本（${label}）`}
              title={raw ? '显示渲染结果' : '显示原始文本'}
            >
              <Sigma className="size-3.5" />
            </Button>
          )}
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
      </div>
      <MathPre text={text} raw={raw} />
    </div>
  );
}
