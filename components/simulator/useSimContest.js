'use client';

import { useCallback, useEffect, useState } from 'react';
import { decodeSimShare, newSimContest, readSimContests, resolveSimProblems, SIM_STORE_EVENT, SIM_STORE_KEY, updateSimContest, writeSimContests } from '@/lib/sim-contest.mjs';

export function useSimContest(id) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    const sync = () => {
      const contest = readSimContests(localStorage).find((item) => item.id === id);
      if (contest) setState({ status: 'ready', contest });
      else setState({ status: 'error', message: '这场模拟赛已从本机删除。' });
    };
    const load = async () => {
      try {
        let contest = readSimContests(localStorage).find((item) => item.id === id);
        if (!contest) {
          const encoded = new URLSearchParams(location.hash.slice(1)).get('data');
          if (!encoded) throw new Error('找不到这场比赛，请从模拟赛列表进入或使用完整分享链接。');
          const definition = decodeSimShare(encoded);
          contest = { ...newSimContest(), ...definition, id };
          const problems = await resolveSimProblems(contest.problems);
          if (!alive) return;
          contest = { ...contest, problems };
          const list = readSimContests(localStorage);
          const existing = list.find((item) => item.id === id);
          if (existing) contest = existing;
          else writeSimContests(localStorage, [contest, ...list]);
        }
        if (!alive) return;
        setState({ status: 'ready', contest });
        // 重新核验兼容旧数据和导入的题单，更新时保留最新计时状态。
        try {
          const problems = await resolveSimProblems(contest.problems);
          if (alive) updateSimContest(localStorage, id, (current) => {
            if (JSON.stringify(current.problems.map(({ platform, id: problemId }) => [platform, problemId])) !== JSON.stringify(contest.problems.map(({ platform, id: problemId }) => [platform, problemId]))) return current;
            return { ...current, problems: problems.map((problem, index) => ({ ...problem, alias: current.problems[index].alias, points: current.problems[index].points })) };
          });
        } catch {
          // 已保存的题单仍可显示，稍后重新进入时再次核验。
        }
      } catch (error) {
        if (alive) setState({ status: 'error', message: error.message });
      }
    };
    load();
    window.addEventListener(SIM_STORE_EVENT, sync);
    const onStorage = (event) => { if (event.key === SIM_STORE_KEY) sync(); };
    window.addEventListener('storage', onStorage);
    return () => { alive = false; window.removeEventListener(SIM_STORE_EVENT, sync); window.removeEventListener('storage', onStorage); };
  }, [id]);

  const update = useCallback((change) => {
    try { updateSimContest(localStorage, id, change); }
    catch { setState((old) => ({ ...old, message: '保存失败，请检查浏览器存储空间。' })); }
  }, [id]);
  return { ...state, update };
}
