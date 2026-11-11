'use client';

/**
 * 全站路由进度条 + 悬停预取。
 *
 * 卡顿根因（2026-11-11 实测）：线上每次站内跳转都要等服务端 RSC 响应
 * （Vercel CDN 命中时 TTFB 仍 0.8–2.9 s，主要是网络往返），而各处 Link 为控制
 * 流量设了 prefetch={false}、站点也没有 loading.js —— 点击后旧页面原样停留
 * 到响应返回，看起来就是「卡住了」。
 *
 * 本组件做两件事：
 * 1. 点击站内链接（或 router.push，经 ac-nav-start 事件）后立即在顶部
 *    显示细进度条，渐进逼近 90%，pathname/search 变化时补满并淡出。
 * 2. 鼠标悬停 / 触摸按下站内链接时 router.prefetch，抢回 100–300 ms 的
 *    网络时间（仅在用户明确表现出意图时预取，不会像默认 prefetch 那样
 *    批量拉取视口内所有链接）。
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

const START_EVENT = 'ac-nav-start';

/** 供 router.push 调用方手动触发进度条。 */
export function startNavProgress() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(START_EVENT));
}

/** 返回可导航的站内 href（同源、非下载、非新窗口、非纯锚点），否则 null。 */
function internalHref(a, e) {
  if (!a || !a.href) return null;
  if (a.target && a.target !== '_self') return null;
  if (a.hasAttribute('download')) return null;
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) return null;
  let url;
  try {
    url = new URL(a.href, location.href);
  } catch {
    return null;
  }
  if (url.origin !== location.origin) return null;
  // API / 静态资源不是页面
  if (/^\/(api|_next)\//.test(url.pathname) || /\.[a-z0-9]+$/i.test(url.pathname)) return null;
  return url;
}

function ProgressBar() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  const router = useRouter();
  const [state, setState] = useState({ visible: false, value: 0 });
  const timer = useRef(null);
  const hideTimer = useRef(null);
  const active = useRef(false);
  const prefetched = useRef(new Set());

  const clear = () => {
    clearInterval(timer.current);
    clearTimeout(hideTimer.current);
  };

  const start = () => {
    clear();
    active.current = true;
    setState({ visible: true, value: 8 });
    // 渐进：每次走剩余距离的一小部分，越接近 90% 越慢，永远不会「卡在 100%」
    timer.current = setInterval(() => {
      setState((s) => (s.value >= 90 ? s : { visible: true, value: s.value + (90 - s.value) * 0.08 }));
    }, 120);
  };

  const done = () => {
    if (!active.current) return;
    active.current = false;
    clear();
    setState({ visible: true, value: 100 });
    hideTimer.current = setTimeout(() => setState({ visible: false, value: 100 }), 260);
  };

  // 路由完成：pathname 或查询串变化
  useEffect(() => {
    done();
  }, [pathname, search]);

  useEffect(() => {
    // 捕获阶段监听：next/link 在冒泡阶段会 preventDefault（改走客户端路由），
    // 冒泡到 document 时已无法区分「Link 接管」与「别人取消」。
    const onClick = (e) => {
      if (e.defaultPrevented) return;
      const a = e.target.closest?.('a');
      const url = internalHref(a, e);
      if (!url) return;
      // 同页（仅锚点变化或完全相同）不显示
      if (url.pathname === location.pathname && url.search === location.search) return;
      start();
    };
    const prefetch = (e) => {
      const a = e.target.closest?.('a');
      const url = internalHref(a);
      if (!url) return;
      const key = url.pathname + url.search;
      if (key === location.pathname + location.search || prefetched.current.has(key)) return;
      prefetched.current.add(key);
      try {
        router.prefetch(key);
      } catch {
        /* 预取失败无所谓，点击时照常请求 */
      }
    };
    const onPop = () => start();
    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseover', prefetch, { passive: true });
    document.addEventListener('touchstart', prefetch, { passive: true });
    document.addEventListener('focusin', prefetch);
    window.addEventListener(START_EVENT, start);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mouseover', prefetch);
      document.removeEventListener('touchstart', prefetch);
      document.removeEventListener('focusin', prefetch);
      window.removeEventListener(START_EVENT, start);
      window.removeEventListener('popstate', onPop);
      clear();
    };
  }, [router]);

  // 兜底：异常情况下（导航被取消 / 出错）15 s 后自动收起
  useEffect(() => {
    if (!state.visible || state.value >= 100) return;
    const t = setTimeout(done, 15000);
    return () => clearTimeout(t);
  }, [state.visible]);

  return (
    <div
      aria-hidden
      className="nav-progress"
      data-visible={state.visible ? '1' : '0'}
      style={{ transform: `scaleX(${state.value / 100})` }}
    />
  );
}

export default function NavigationProgress() {
  // useSearchParams 需在 Suspense 内，避免整页退化为客户端渲染
  return (
    <Suspense fallback={null}>
      <ProgressBar />
    </Suspense>
  );
}
