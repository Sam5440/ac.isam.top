'use client';

import { useEffect } from 'react';

/**
 * PWA 注册器只安装最小应用壳。题目与编译器运行时由用户在设置中主动选择。
 *
 * 换版自愈（AC_STALE_RELOAD）：导航版本门卫秒开了一个旧版构建页面、后台
 * revalidate 发现线上已换版时，SW 会通知本页重载。sessionStorage 按构建号
 * 去重——同一构建只自动刷新一次，不会循环；隐私模式 sessionStorage 抛错时
 * 用内存标记兜底。
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return undefined;
    if (!('serviceWorker' in navigator)) return undefined;

    navigator.serviceWorker.register('/sw.js').catch(() => {});

    let reloadedOnce = false;
    const onMessage = (event) => {
      if (event.data?.type !== 'AC_STALE_RELOAD') return;
      const build = String(event.data.build || '');
      if (!build || reloadedOnce) return;
      try {
        if (sessionStorage.getItem('ac-stale-reload') === build) return;
        sessionStorage.setItem('ac-stale-reload', build);
      } catch {
        reloadedOnce = true;
      }
      location.reload();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  return null;
}
