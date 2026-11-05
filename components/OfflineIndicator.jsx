'use client';

/**
 * 离线状态角标（右下角悬浮，pointer-events:none 不挡操作）：
 * 断网时显示「离线模式」提示，恢复联网时短暂显示「已恢复联网」。
 * 仅提示，不打断：已缓存题目/页面照常可用。
 */

import { useEffect, useState } from 'react';

export default function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  const [recovered, setRecovered] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOffline = () => {
      setOnline(false);
      setRecovered(false);
    };
    const goOnline = () => {
      setOnline(true);
      setRecovered(true);
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // 恢复提示 2.5s 后自动隐藏
  useEffect(() => {
    if (!recovered) return undefined;
    const t = setTimeout(() => setRecovered(false), 2500);
    return () => clearTimeout(t);
  }, [recovered]);

  if (online && !recovered) return null;

  return (
    <div aria-live="polite" className="pointer-events-none fixed right-3 bottom-3 z-[60]">
      {online ? (
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-500 shadow-lg backdrop-blur">
          ✓ 已恢复联网
        </span>
      ) : (
        <span className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-500 shadow-lg backdrop-blur">
          📴 离线模式 · 已缓存题目可正常浏览
        </span>
      )}
    </div>
  );
}
