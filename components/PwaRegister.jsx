'use client';

import { useEffect } from 'react';

/**
 * PWA 注册器只安装最小应用壳。题目与编译器运行时由用户在设置中主动选择。
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return undefined;
    if (!('serviceWorker' in navigator)) return undefined;

    navigator.serviceWorker.register('/sw.js').catch(() => {});
    return undefined;
  }, []);

  return null;
}
