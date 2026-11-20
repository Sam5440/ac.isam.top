'use client';

import { useEffect, useState } from 'react';
import { actionLabel, actionsPages } from '@/lib/ci-actions.mjs';

export default function RunJobs({ run }) {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    actionsPages({ runId: run.runId, signal: controller.signal }).then(setJobs).catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [run.runId, run.updatedAt, run.conclusion]);
  return <div className="space-y-2 border-t px-4 py-3 text-xs">
    <h3 className="font-semibold">作业与步骤</h3>
    {error ? <p>作业同步失败：{error}，可查看 GitHub 原始日志。</p> : !jobs ? <p>正在加载作业…</p> : !jobs.length ? <p>GitHub 暂无作业记录。</p> : jobs.map((job) => <details key={job.id}>
      <summary className="cursor-pointer break-words">{job.name} · {actionLabel(job.conclusion || job.status)}</summary>
      <ol className="my-2 space-y-1 pl-4">{job.steps?.map((s) => <li key={s.number}>{s.number}. {s.name} · {actionLabel(s.conclusion || s.status)}</li>)}</ol>
      <a className="text-primary underline" href={job.html_url} target="_blank" rel="noreferrer">查看作业原始日志</a>
    </details>)}
  </div>;
}
