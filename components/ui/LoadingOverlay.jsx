'use client';

/**
 * 统一加载组件集：全站 spinner / 骨架 / 遮罩的唯一实现（工作项 0 基建）。
 *  - <Spinner />                 纯旋转环（可嵌按钮）
 *  - <SpinnerNote text? />       旋转环 + 说明文字（替代各处 ad-hoc spinner）
 *  - <Skeleton className? />     shimmer 骨架块
 *  - <LoadingOverlay text? />    绝对定位遮罩（父容器需 relative）
 */

export function Spinner({ className = 'size-4' }) {
  return (
    <span
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70 ${className}`}
      role="status"
      aria-label="加载中"
    />
  );
}

export function SpinnerNote({ text = '加载中…', className = '' }) {
  return (
    <p className={`text-muted-foreground flex items-center gap-2 py-6 text-sm ${className}`}>
      <Spinner className="size-4" />
      <span>{text}</span>
    </p>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`skeleton-shimmer bg-muted/60 rounded-md ${className}`} aria-hidden />;
}

export function LoadingOverlay({ text = '处理中…' }) {
  return (
    <div className="bg-background/60 absolute inset-0 z-20 grid place-items-center backdrop-blur-sm">
      <div className="flex items-center gap-2.5 rounded-lg border bg-popover px-4 py-2.5 text-[13px] shadow-lg">
        <Spinner className="size-4" />
        <span>{text}</span>
      </div>
    </div>
  );
}
