'use client';

/**
 * 应用级错误边界（渲染/客户端异常统一入口）。
 * 无论何种错误都必须给用户留出口：重试 / 刷新 / 返回首页；
 * 离线与 chunk 加载失败（站点刚更新后旧缓存页常见）分别给出针对性提示。
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

const CHUNK_FAIL_RE =
  /Failed to fetch dynamically imported|Loading chunk|ChunkLoadError|error loading dynamically imported module|dynamically imported module/i;

export default function Error({ error, reset }) {
  const [offline, setOffline] = useState(false);
  const [chunkFail, setChunkFail] = useState(false);

  useEffect(() => {
    const msg = String(error?.message || '');
    setChunkFail(CHUNK_FAIL_RE.test(msg));
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [error]);

  const reason = offline
    ? '当前处于离线状态，页面所需的部分资源尚未缓存。'
    : chunkFail
      ? '站点刚刚更新，本页引用的旧版脚本已失效，刷新即可加载新版。'
      : '渲染此页面时发生了意外错误。';

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
          onClick={() => {
            if (chunkFail) location.reload();
            else reset();
          }}
          className="border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm transition-colors"
        >
          {chunkFail ? '刷新加载新版' : '重试'}
        </button>
        <Link
          href="/"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-sm transition-colors"
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
      {error?.digest ? (
        <p className="text-muted-foreground/50 font-mono text-[11px]">错误标识：{error.digest}</p>
      ) : null}
    </div>
  );
}
