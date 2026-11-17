'use client';

/**
 * 应用级错误边界（渲染/客户端异常统一入口）。任何错误都必须给用户留出口。
 *
 * 为什么这里要认「构建号」（2026-11-17 排查）：
 * 部署换版后，SW 缓存里可能留着旧构建的整页 HTML / RSC 载荷（导航门卫有
 * 5 分钟盲区；RSC 路径此前完全没有门卫）。这类残留的报错五花八门（webpack
 * 模块表错配的 reading 'call'、Safari 的 Importing a module script failed.、
 * CDN 把旧 chunk 404 成 HTML 的 MIME 报错…），旧版正则一条都认不出来 →
 * 明明刷新就好，却显示通用文案、且主动作是无效的 reset()（原地重渲同一棵
 * 坏树），用户只能自己去「清缓存 + 硬刷」。现在：
 *   1. lib/error-classify.mjs 归类决定文案（stale / server / unknown）；
 *   2. 本页 HTML 的构建号（<meta name="ac-build">）≠ 线上 /ac-build.json
 *      → 自动清掉「本页」的缓存条目并重载一次（按构建号去重，等价于用户
 *      手动的「清缓存 + 刷新」，但只丢这一页、保留离线题库与编译器运行时）；
 *   3. 主动作一律是「刷新页面」，另给「清理页面缓存并刷新」兜底。
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { classifyClientError } from '@/lib/error-classify.mjs';

/** 与 components/PwaRegister.jsx 共用同一去重键（值 = 触发重载的构建号）。 */
const STALE_RELOAD_KEY = 'ac-stale-reload';
const PROBE_TIMEOUT_MS = 2500;
/** 「清理页面缓存并刷新」只丢页面与壳：离线题库的资源在 ac-assets、
 *  编译器运行时在 ac-runtime / compiler-runtime-v1 —— 都必须保留。 */
const PURGE_CACHES = ['ac-pages', 'ac-shell'];

function probeSignal() {
  try {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(PROBE_TIMEOUT_MS)
      : undefined;
  } catch {
    return undefined;
  }
}

function readSession(key) {
  try {
    return sessionStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* 隐私模式：无非是不去重，仍有 sessionStorage 之外的兜底出口 */
  }
}

/** 只删「本页」在 SW 页面缓存里的条目（HTML/壳），保证随后的重载必走网络。 */
async function dropPageCacheEntries() {
  if (typeof caches === 'undefined') return;
  try {
    const pages = await caches.open('ac-pages');
    await Promise.all([location.href, location.pathname].map((url) => pages.delete(url)));
    const shell = await caches.open('ac-shell');
    await shell.delete(location.origin + '/');
  } catch {
    /* 缓存 API 不可用：让随后的 reload 按常规路径重试 */
  }
}

/** 用户手动「清缓存」的自动化版：停同步 → 删页面/壳缓存 → 更新 SW → 重载。 */
async function clearPageCaches() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'ABORT_SYNC' });
  } catch {
    /* 没有 SW 或未受控 */
  }
  try {
    if (typeof caches !== 'undefined') {
      await Promise.all(PURGE_CACHES.map((name) => caches.delete(name)));
    }
  } catch {
    /* 忽略：reload 仍会走网络优先 */
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    await reg?.update?.();
  } catch {
    /* 忽略 */
  }
}

export default function Error({ error, reset }) {
  const [offline, setOffline] = useState(false);
  const [kind, setKind] = useState('unknown');
  const [localBuild, setLocalBuild] = useState('');
  const [onlineBuild, setOnlineBuild] = useState('');
  const [healing, setHealing] = useState(false);
  const [purged, setPurged] = useState(false);

  useEffect(() => {
    // Next 官方模板的标准动作:错误现场进控制台,生产排障依赖它
    console.error(error);
    setKind(classifyClientError(error?.message));
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [error]);

  // 换版自愈：本页是旧构建 → 丢掉本页缓存并自动重载一次（防循环去重）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = document.querySelector('meta[name="ac-build"]')?.getAttribute('content') || '';
      setLocalBuild(local);
      try {
        const res = await fetch('/ac-build.json', { cache: 'no-store', signal: probeSignal() });
        const online = (await res.json())?.build || '';
        if (cancelled || !online) return;
        setOnlineBuild(online);
        if (!local || local === online) return; // 同一构建：是真正的运行时异常
        if (readSession(STALE_RELOAD_KEY) === online) return; // 同一构建只自愈一次
        writeSession(STALE_RELOAD_KEY, online);
        setHealing(true);
        await dropPageCacheEntries();
        location.reload();
      } catch {
        /* 离线或探测失败：保留手动出口 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stale = kind === 'stale';
  const serverRender = kind === 'server';
  const reason = offline
    ? '当前处于离线状态，页面所需的部分资源尚未缓存。'
    : stale
      ? '站点刚刚更新，本页引用的旧版脚本/数据已失效，刷新即可加载新版。'
      : serverRender
        ? '这一次是服务端渲染本页时出错（多为刚部署或数据瞬时异常），刷新一次通常即可。'
        : '渲染此页面时发生了意外错误。';
  const primaryLabel = healing ? '正在刷新…' : stale ? '刷新加载新版' : serverRender ? '刷新重试' : '刷新页面';

  return (
    <div className="flex flex-col items-center gap-4 py-32 text-center" role="alert">
      <div className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-xl text-2xl">
        {offline ? '📴' : '⚠️'}
      </div>
      <h1 className="text-xl font-semibold">{offline ? '离线页面出错' : '页面出错了'}</h1>
      <p className="text-muted-foreground max-w-md text-sm leading-relaxed">{reason}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          disabled={healing}
          onClick={() => location.reload()}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-60"
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={() => reset()}
          title="不刷新，原地重新渲染本页（对旧缓存引起的错误通常无效）"
          className="border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm transition-colors"
        >
          重试
        </button>
        <button
          type="button"
          disabled={healing}
          onClick={async () => {
            setPurged(true);
            await clearPageCaches();
            location.reload();
          }}
          title="清掉本站页面缓存（保留离线题库与编译器运行时）后重新加载"
          className="border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-60"
        >
          清理页面缓存并刷新
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-md px-3 py-1.5 text-sm transition-colors"
        >
          返回首页
        </Link>
        <Link
          href="/problems"
          className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-md px-3 py-1.5 text-sm transition-colors"
        >
          浏览题库
        </Link>
      </div>
      <details className="text-muted-foreground/70 w-full max-w-md text-left text-[11px]">
        <summary className="cursor-pointer select-none text-center">排障信息</summary>
        <div className="mt-1.5 space-y-0.5 font-mono break-words">
          <p>错误：{String(error?.message || '未知')}</p>
          {error?.digest ? <p>标识：{error.digest}</p> : null}
          <p>本页构建：{localBuild || '未知'}</p>
          <p>线上构建：{onlineBuild || '未探测到'}</p>
          {purged ? <p>已清理页面缓存</p> : null}
        </div>
      </details>
    </div>
  );
}
