'use client';

import { useEffect } from 'react';

/**
 * PWA 注册器：生产环境注册 /sw.js 并触发离线题库同步。
 * 同步在 注册完成、8 秒兜底、页面回到可见 三个时机各发一次（SW 侧有 syncing
 * 互斥 + 已缓存跳过，重复触发只多一次 manifest 请求，代价可忽略）。
 * 离线条数上限读自设置（stmt-settings-v1.offlineLimit，默认 100）。
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return undefined;
    if (!('serviceWorker' in navigator)) return undefined;

    const limit = () => {
      try {
        const s = JSON.parse(localStorage.getItem('stmt-settings-v1') || '{}');
        return [30, 50, 100, 200].includes(s.offlineLimit) ? s.offlineLimit : 100;
      } catch {
        return 100;
      }
    };
    const sync = () => {
      navigator.serviceWorker.ready
        .then((reg) => reg.active?.postMessage({ type: 'SYNC_OFFLINE', limit: limit() }))
        .catch(() => {});
    };

    navigator.serviceWorker.register('/sw.js').catch(() => {});
    const t1 = setTimeout(sync, 1500);
    const t2 = setTimeout(sync, 8000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
