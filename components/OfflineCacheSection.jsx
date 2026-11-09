'use client';

import { useCallback, useEffect, useState } from 'react';

import { useSettings } from '@/components/settings';

const LIMIT_OPTIONS = [30, 50, 100, 200];
const CACHE_NAMES = ['ac-shell', 'ac-pages', 'ac-assets', 'ac-runtime', 'ac-imgs'];
const META_KEY = '/__offline_meta__';

/**
 * 设置面板「离线缓存」区块：PWA 安装状态、离线题库（最近 N 场比赛）同步进度
 * 与占用统计、手动同步 / 清除。数据直接读 Cache Storage（页面同源可读），
 * 同步进度经 SW postMessage（OFFLINE_SYNC）推送。
 */
export default function OfflineCacheSection() {
  const { settings, setSettings } = useSettings();
  const [swActive, setSwActive] = useState(false);
  const [stats, setStats] = useState(null); // {pages, assets, runtime, imgs, usageMB, quotaMB}
  const [meta, setMeta] = useState(null); // {lastSyncAt, contests, pages, ...}
  const [prog, setProg] = useState(null); // {phase, done, total, added, error}
  const [cleared, setCleared] = useState(false);

  const refresh = useCallback(async () => {
    if (!('caches' in window)) return;
    try {
      const s = { pages: 0, assets: 0, runtime: 0, imgs: 0, usageMB: null, quotaMB: null };
      for (const n of CACHE_NAMES) {
        // 先 has 再 open:open 会创建不存在的缓存,仅打开设置页就生成 5 个
        // 空桶（审查 P3-15）
        if (!(await caches.has(n))) continue;
        const keys = await (await caches.open(n)).keys();
        if (n === 'ac-pages') s.pages = keys.filter((k) => !k.url.startsWith('/__offline_meta__')).length;
        else if (n === 'ac-assets') s.assets = keys.length;
        else if (n === 'ac-runtime') s.runtime = keys.length;
        else if (n === 'ac-imgs') s.imgs = keys.length;
      }
      if (navigator.storage?.estimate) {
        const e = await navigator.storage.estimate();
        if (e.usage != null) s.usageMB = Math.round(e.usage / 1048576);
        if (e.quota != null) s.quotaMB = Math.round(e.quota / 1048576);
      }
      const m = await caches.match(META_KEY);
      setStats(s);
      setMeta(m ? await m.json() : null);
    } catch {}
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    // ready Promise 在 SW 激活后 resolve（PWA-15:旧实现只在挂载时读一次
    // registration,SW 晚于挂载激活后按钮永久保持禁用）
    navigator.serviceWorker.ready.then(() => setSwActive(true)).catch(() => {});
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type === 'OFFLINE_SYNC') {
        setProg(d);
        if (d.phase === 'done' || d.phase === 'error' || d.phase === 'aborted') refresh();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    refresh();
    const iv = setInterval(refresh, 8000);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMsg);
      clearInterval(iv);
    };
  }, [refresh]);

  const syncNow = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({ type: 'SYNC_OFFLINE', limit: settings.offlineLimit || 100 });
    } catch {}
  };

  const clearAll = async () => {
    if (!window.confirm('清除全部离线缓存（题库页面 / 静态资源 / 编译器运行时）？已下载的 Pyodide 缓存不受影响。')) return;
    // 先中止进行中的同步（PWA-7 竞态:否则 worker 会继续写回并重写 meta）
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      reg?.active?.postMessage({ type: 'ABORT_SYNC' });
      await new Promise((r) => setTimeout(r, 300));
    } catch {}
    let failed = 0;
    for (const n of CACHE_NAMES) {
      try {
        await caches.delete(n);
      } catch {
        failed++;
      }
    }
    setCleared(true);
    setMeta(null);
    setProg(null);
    await refresh();
    if (failed) window.alert(`${failed} 个缓存桶删除失败（可能被占用），稍后会自动重建。`);
  };

  const limit = settings.offlineLimit || 100;
  const syncing = prog && (prog.phase === 'pages' || prog.phase === 'manifest' || prog.phase === 'compiler');
  const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '尚未同步');

  return (
    <div className="space-y-1.5" data-testid="offline-cache-section">
      <p className="text-muted-foreground text-xs font-medium">离线缓存（PWA）</p>
      <div className="text-muted-foreground/70 space-y-1 text-[11px] leading-relaxed">
        <p>
          安装到桌面 / 手机后可离线使用。后台自动保存最近
          <span className="text-foreground font-medium"> {limit} </span>
          场比赛的全部题目页（含译文与公式），编译器首次在线使用后即离线可用；Pyodide
          需在上方「编译器运行时」中下载后才可离线运行 Python。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {LIMIT_OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setSettings({ offlineLimit: n })}
            aria-pressed={limit === n}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
              limit === n ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            最近 {n} 场
          </button>
        ))}
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span>SW：{swActive ? '✓ 运行中' : '首次访问后生效'}</span>
        <span>上次同步：{fmtTime(meta?.lastSyncAt)}</span>
        {meta?.contests != null && <span>已离线 {meta.contests} 场 / {meta.pages} 页</span>}
        {stats && (
          <span>
            静态资源 {stats.assets} · 编译器 {stats.runtime} · 图片 {stats.imgs}
            {stats.usageMB != null && ` · 占用 ${stats.usageMB} MB${stats.quotaMB ? ` / 配额 ${stats.quotaMB} MB` : ''}`}
          </span>
        )}
      </div>

      {syncing && prog.total > 0 && (
        <div className="space-y-1">
          <div className="bg-border h-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full transition-all"
              style={{ width: `${Math.min(100, Math.round((prog.done / prog.total) * 100))}%` }}
            />
          </div>
          <p className="text-muted-foreground text-[11px]">
            {prog.phase === 'compiler'
              ? `正在预取编译器运行时 ${prog.done}/${prog.total}（约 145MB,离线编译用）`
              : `正在同步离线题库 ${prog.done}/${prog.total}（新增 ${prog.added}）`}
          </p>
        </div>
      )}
      {prog?.phase === 'error' && <p className="text-[11px] text-red-400">✗ 同步失败：{prog.error}</p>}
      {prog?.phase === 'aborted' && <p className="text-muted-foreground text-[11px]">已中止同步。</p>}
      {prog?.phase === 'done' && (
        <p className="text-[11px] text-emerald-500">✓ 同步完成：{prog.meta?.pages ?? prog.total} 页 · 新增 {prog.added}</p>
      )}
      {cleared && <p className="text-muted-foreground text-[11px]">已清除，下次在线访问将自动重建。</p>}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={syncNow}
          disabled={!swActive}
          className="hover:bg-accent rounded-md border px-2.5 py-1 text-xs text-foreground transition-colors disabled:opacity-50"
        >
          立即同步
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="text-muted-foreground hover:text-foreground rounded-md border px-2.5 py-1 text-xs transition-colors"
        >
          清除离线缓存
        </button>
      </div>
    </div>
  );
}
