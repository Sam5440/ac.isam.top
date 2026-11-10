'use client';

/**
 * 全站 Toast 宿主（app/layout.jsx 挂载，全站单实例）。
 * 右下角堆叠：图标 + 文案 + 自动消失进度条；点击立即关闭；上滑淡入。
 * 样式走现有 CSS 变量（bg-popover 等），深浅主题自适应。
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { dismiss, subscribe } from '@/lib/toast';

const KIND_META = {
  info: { Icon: Info, cls: 'text-sky-500' },
  success: { Icon: CheckCircle2, cls: 'text-emerald-500' },
  error: { Icon: XCircle, cls: 'text-red-500' },
};

export default function ToastHost() {
  const [items, setItems] = useState([]);

  useEffect(() => subscribe(setItems), []);

  if (!items.length) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-[90] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => {
        const { Icon, cls } = KIND_META[t.kind] || KIND_META.info;
        return (
          <div
            key={t.id}
            className="toast-in pointer-events-auto relative overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
          >
            <button
              type="button"
              className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left text-[13px] leading-5"
              onClick={() => dismiss(t.id)}
            >
              <Icon className={`mt-0.5 size-4 shrink-0 ${cls}`} aria-hidden />
              <span className="min-w-0 flex-1 break-words">{t.msg}</span>
              <X className="text-muted-foreground/60 mt-0.5 size-3.5 shrink-0" aria-hidden />
            </button>
            {t.duration > 0 && (
              <span
                className="toast-progress absolute bottom-0 left-0 h-0.5 bg-foreground/20"
                style={{ animationDuration: `${t.duration}ms` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
