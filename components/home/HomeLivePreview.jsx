'use client';

import { useEffect, useState } from 'react';
import { Eye, RefreshCw } from 'lucide-react';
import HomeDashboard from './HomeDashboard';

export default function HomeLivePreview({ config }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', data: null, error: '' });
    fetch('/api/home', { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || `首页数据加载失败（HTTP ${response.status}）`);
        setState({ status: 'ready', data: body, error: '' });
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ status: 'error', data: null, error: error.message });
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <section aria-label="首页实时预览" className="overflow-hidden rounded-lg border bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-3">
        <Eye className="text-primary size-4" />
        <h3 className="text-sm font-semibold">带数据预览</h3>
        <span className="text-muted-foreground text-xs">与首页使用同一渲染组件，修改会即时反映在这里</span>
        <button type="button" aria-label="重新加载预览数据" onClick={() => setAttempt((value) => value + 1)} className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-xs">
          <RefreshCw className={`size-3.5 ${state.status === 'loading' ? 'animate-spin' : ''}`} />刷新数据
        </button>
      </header>
      <div className="px-3 sm:px-5">
        {state.status === 'loading' && <div className="space-y-3 py-8" aria-label="预览数据加载中"><div className="bg-muted h-24 animate-pulse rounded-xl" /><div className="bg-muted h-40 animate-pulse rounded-xl" /></div>}
        {state.status === 'error' && <p role="alert" className="py-8 text-center text-sm text-red-400">{state.error}</p>}
        {state.status === 'ready' && <HomeDashboard data={state.data} config={config} preview />}
      </div>
    </section>
  );
}
