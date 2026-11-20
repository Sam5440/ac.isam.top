'use client';

import { useEffect, useState } from 'react';

import ContestDetailsView from '@/components/ContestDetailsView';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { decodeSimShare } from '@/lib/sim-contest.mjs';

export default function SimulatorContestView({ contestId }) {
  const [state, setState] = useState({ status: 'loading' });
  const [shareHash, setShareHash] = useState(null);

  useEffect(() => {
    const syncHash = () => setShareHash(location.hash);
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  useEffect(() => {
    if (shareHash === null) return;
    let active = true;
    setState({ status: 'loading' });
    try {
      const encoded = new URLSearchParams(shareHash.slice(1)).get('data');
      if (!encoded) throw new Error('这件模拟赛缺少题单数据，请从模拟赛工作台重新进入或复制分享链接。');
      const definition = decodeSimShare(encoded);
      fetch('/api/simulator/problems', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problems: definition.problems.map(({ platform, id }) => ({ platform, id })) }),
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '题库暂时不可用');
        if (!Array.isArray(data.problems) || data.problems.length !== definition.problems.length) throw new Error('题目核验结果不完整');
        if (!active) return;
        const problems = definition.problems.map((problem, index) => ({ ...problem, ...data.problems[index] }));
        setState({
          status: 'ready',
          contest: {
            id: contestId,
            title: definition.name || '自定义模拟赛',
            titleZh: definition.name || '自定义模拟赛',
            durationSeconds: definition.minutes ? definition.minutes * 60 : null,
            totalPoints: problems.reduce((sum, problem) => sum + (Number(problem.points) || 0), 0),
          },
          problems,
        });
      }).catch((error) => { if (active) setState({ status: 'error', message: error.message }); });
    } catch (error) {
      setState({ status: 'error', message: error.message });
    }
    return () => { active = false; };
  }, [contestId, shareHash]);

  if (state.status === 'ready') return <ContestDetailsView contest={state.contest} problems={state.problems} isSimulator />;
  return (
    <div className="mx-auto max-w-5xl py-10">
      <Card><CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        {state.status === 'loading' ? <p className="text-muted-foreground text-sm">正在载入自定义比赛…</p> : <>
          <h1 className="text-lg font-semibold">无法打开模拟赛</h1>
          <p className="text-muted-foreground text-sm">{state.message || '链接中的比赛题单无效或已损坏。'}</p>
          <Button asChild variant="outline"><a href="/simulator">返回模拟赛工作台</a></Button>
        </>}
      </CardContent></Card>
    </div>
  );
}
