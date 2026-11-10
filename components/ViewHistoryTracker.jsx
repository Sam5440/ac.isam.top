'use client';

/**
 * 题目页浏览历史埋点（工作项 3.2）：仅挂题目页，向 lib/view-history 上报。
 *
 *  - 挂载 → touchView（首见建档 / 回访刷新 lastSeen 与标题）；
 *  - document.visibilityState === 'visible' 时每 5s heartbeat(+5000)，
 *    hidden 期间的 tick 跳过（不累计停留）；
 *  - visibilitychange→hidden 与 pagehide 时补记 lastTick 以来的尾差；
 *  - 订阅 ide-bus 'run-finished'（dock 与 ide 来源都算）：problemKey 匹配
 *    当前题时 recordJudge —— cases 全 AC 且无编译错误 → 'ac'，否则 'fail'。
 *
 * 所有写入均 fire-and-forget（lib 层内部静默降级），卸载时清理全部监听。
 */

import { useEffect, useRef } from 'react';

import { on } from '@/lib/ide-bus';
import { heartbeat, recordJudge, touchView } from '@/lib/view-history';

const HEARTBEAT_MS = 5000;

/** run-finished payload → 'ac' | 'fail'（verdict 归一化由 lib 层兜底）。 */
function verdictOf(payload) {
  const cases = Array.isArray(payload?.cases) ? payload.cases : [];
  const allAc = cases.length > 0 && cases.every((c) => String(c?.verdict ?? '').toUpperCase() === 'AC');
  return !payload?.compileError && allAc ? 'ac' : 'fail';
}

export default function ViewHistoryTracker({ platform, problemId, title, titleZh, url }) {
  // lastTick：上次结算到的时刻，hidden/pagehide 时补记 now - lastTick
  const lastTickRef = useRef(Date.now());

  useEffect(() => {
    if (!platform || !problemId) return undefined;
    lastTickRef.current = Date.now();

    touchView({ platform, problemId, title, titleZh, url });

    const settle = () => {
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;
      if (elapsed > 0) heartbeat(platform, problemId, elapsed);
    };

    const interval = setInterval(() => {
      // hidden 期间跳过 tick：不累计停留，也不推进 lastTick（恢复可见时
      // 由 visibilitychange 把 lastTick 拨到当下，避免把离屏时间计入）
      if (document.visibilityState === 'visible') {
        settle();
      } else {
        lastTickRef.current = Date.now();
      }
    }, HEARTBEAT_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        lastTickRef.current = Date.now();
      } else {
        settle();
      }
    };
    const onPageHide = () => settle();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    const offRunFinished = on('run-finished', (payload) => {
      if (payload?.problemKey !== `${platform}:${problemId}`) return;
      recordJudge(platform, problemId, verdictOf(payload));
    });

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      offRunFinished();
    };
  }, [platform, problemId, title, titleZh, url]);

  return null;
}
