'use client';

/**
 * 百度统计的「客户端路由补报」。
 *
 * hm.js 只在页面加载时自动上报一次页面浏览；本站是 App Router 的客户端路由，
 * 站内跳转不会重新加载页面，不补报就只会统计到每个会话的第一个页面。
 *
 * 为什么不用 usePathname / useSearchParams：布局里的组件在「只改查询串」的跳转
 * （题库翻页 `?page=2` → `?page=3`、切平台 `?platform=cf`）时拿不到新的 searchParams，
 * 这类页面浏览会整批漏掉（2026-11-25 浏览器实测）。改为直接观察 History API +
 * popstate，路径与查询串的任意变化都能覆盖。
 *
 * - 首屏不补报：那一次由 hm.js 自己上报，重复补报会把 PV 翻倍。
 * - 上报路径走 `lib/baidu-analytics.mjs` 的 trackPath（丢弃 hash，
 *   模拟赛 `#data=` 分享载荷不进统计）。
 * - `_hmt` 队列在 `<head>` 的内联脚本里已初始化，hm.js 未加载完时 push 不会丢。
 */

import { useEffect } from 'react';

import { trackPath } from '@/lib/baidu-analytics.mjs';

/** 模块级状态：只装一次监听，并记住上一次上报的地址（组件重挂载后仍然有效）。 */
let installed = false;
let lastUrl = null;

function report() {
  const url = trackPath(window.location.pathname, window.location.search);
  if (lastUrl === null) {
    // 首屏基线：交给 hm.js 自动上报
    lastUrl = url;
    return;
  }
  if (url === lastUrl) return;
  lastUrl = url;
  (window._hmt = window._hmt || []).push(['_trackPageview', url]);
}

export default function BaiduAnalytics() {
  useEffect(() => {
    if (typeof window === 'undefined' || installed) return undefined;
    installed = true;
    report();

    const { pushState, replaceState } = window.history;
    // 统计出问题绝不能影响导航：报告逻辑一律吞掉异常
    const safeReport = () => {
      try {
        report();
      } catch {
        /* 忽略 */
      }
    };
    window.history.pushState = function patchedPushState(...args) {
      const result = pushState.apply(this, args);
      safeReport();
      return result;
    };
    window.history.replaceState = function patchedReplaceState(...args) {
      const result = replaceState.apply(this, args);
      safeReport();
      return result;
    };
    window.addEventListener('popstate', safeReport);

    return () => {
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
      window.removeEventListener('popstate', safeReport);
      installed = false;
    };
  }, []);

  return null;
}