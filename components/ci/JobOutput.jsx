'use client';

import { useEffect, useMemo, useState } from 'react';
import { cacheRate } from '@/lib/ci-usage.mjs';
import { parseJobLog } from '@/lib/ci-job-log.mjs';

export function UsageTable({ calls }) {
  return <details className="text-xs"><summary className="cursor-pointer font-semibold">AI 调用用量 · {calls?.length ?? '未知'} 次</summary>
    {!calls ? <p>此存档未记录逐次用量。</p> : !calls.length ? <p>本轮没有 AI 请求。</p> : <div className="mt-2 overflow-x-auto"><table className="w-full text-left tabular-nums">
      <thead><tr>{['时间（UTC）', '任务 / 对象', '尝试', '响应', '输入', '输出', '合计', '缓存命中', '命中率'].map((h) => <th key={h} className="whitespace-nowrap p-1">{h}</th>)}</tr></thead>
      <tbody>{calls.map((c, i) => <tr key={i} className="border-t">{[c.at, `${c.task} · ${c.target}`, c.attempt, c.responseOk ? '已响应' : `异常 ${c.httpStatus ?? ''}`, c.input, c.output, c.total, c.cached, cacheRate(c)].map((v, j) => <td className="p-1" key={j}>{v ?? '未知'}</td>)}</tr>)}</tbody>
    </table></div>}
  </details>;
}

export function JobOutput({ job }) {
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [scope, setScope] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!attempt) return;
    const controller = new AbortController();
    setError('');
    fetch(`/api/ci/jobs/${job.id}/log`, { signal: controller.signal }).then(async (res) => {
      const body = await res.text();
      if (!res.ok) throw new Error(body || `HTTP ${res.status}`);
      setText(body);
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [attempt, job.id]);
  const log = useMemo(() => parseJobLog(text || ''), [text]);
  const filtered = useMemo(() => log.rows.filter((r) => (!group || group === r.group) && (!scope || scope === r.scope) && (!level || level === r.level) && r.raw.toLowerCase().includes(query.toLowerCase())), [log, query, group, scope, level]);
  if (!attempt || error) return <div className="my-2">{error && <p role="alert">{error}</p>}<button type="button" className="text-primary underline" onClick={() => setAttempt((n) => n + 1)}>{error ? '重试读取日志' : '查看完整过程日志'}</button></div>;
  if (text === null) return <p>正在读取日志…</p>;
  return <div className="my-2 space-y-2">
    {log.calls.length > 0 && <UsageTable calls={log.calls} />}
    <div className="flex flex-wrap gap-2">{[['全部分组', log.groups, group, setGroup], ['全部阶段', log.scopes, scope, setScope], ['全部级别', ['错误', '警告', '输出'], level, setLevel]].map(([label, options, value, set]) =>
      <select className="bg-background max-w-full rounded border" key={label} aria-label={label} value={value} onChange={(e) => { set(e.target.value); setPage(0); }}><option value="">{label}</option>{options.map((opt) => <option key={opt}>{opt}</option>)}</select>)}</div>
    <div className="flex flex-wrap items-center gap-2"><input className="rounded border bg-background px-2 py-1" aria-label="搜索日志" placeholder="搜索日志" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
      <span>{filtered.length} 行 · 第 {page + 1} / {Math.max(1, Math.ceil(filtered.length / 200))} 页</span>
      <button disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><button disabled={(page + 1) * 200 >= filtered.length} onClick={() => setPage(page + 1)}>下一页</button></div>
    <pre className="max-h-96 overflow-auto rounded border p-2 text-[11px]">{filtered.slice(page * 200, (page + 1) * 200).map((r) => r.raw).join('\n') || '无匹配输出'}</pre>
  </div>;
}
