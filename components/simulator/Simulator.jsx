'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Plus, Search, Settings2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { clockSnapshot, decodeSimShare, exportSimContests, formatElapsed, importSimContests, newSimContest, parseSimProblemList, readSimContests, reconcileSimProblems, resolveSimProblems, SIM_STORE_EVENT, SIM_STORE_KEY, simContestHref, writeSimContests } from '@/lib/sim-contest.mjs';
import { formatDateTime } from '@/lib/utils';

const PLATFORM_NAME = { atcoder: 'AtCoder', codeforces: 'Codeforces', 'cf-gyms': 'Gym', nowcoder: '牛客' };
const listText = (problems) => problems.map((p) => `${PLATFORM_NAME[p.platform] || p.platform} | ${p.id} | ${p.points ?? 1} | ${p.alias || ''}`).join('\n');

function download(contents, filename, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeLog(contests) {
  return `# 模拟赛记录\n\n${contests.map((contest) => {
    const clock = clockSnapshot(contest, Date.now());
    const escape = (text) => String(text || '').replaceAll('|', '\\|');
    return `## ${contest.name}\n\n- 开始：${contest.startedAt ? new Date(contest.startedAt).toLocaleString('zh-CN') : '未开始'}\n- 总用时：${formatElapsed(clock.elapsedMs)}\n- 题目：${contest.problems.length}\n\n| 平台 | 题号 | 分值 | 题名 | 别名 | 用时 | 状态 |\n| --- | --- | ---: | --- | --- | --- | --- |\n${contest.problems.map((p) => `| ${PLATFORM_NAME[p.platform] || p.platform} | ${p.id} | ${p.points} | ${escape(p.titleZh || p.title)} | ${escape(p.alias)} | ${formatElapsed(clock.problemTimes[p.key] || 0)} | ${contest.completed?.[p.key] ? '完成' : '未完成'} |`).join('\n')}\n`;
  }).join('\n')}`;
}

function ContestEditor({ initial, onCancel, onSaved }) {
  const [contest, setContest] = useState(initial);
  const [text, setText] = useState(listText(initial.problems));
  const [checkedText, setCheckedText] = useState(initial.problems.length && initial.problems.every((p) => p.key && p.found != null) ? listText(initial.problems) : null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const parsed = useMemo(() => parseSimProblemList(text), [text]);
  const validate = async () => {
    if (parsed.errors.length || !parsed.rows.length) { setMessage('请先输入题目并修正格式错误。'); return; }
    setChecking(true);
    try {
      const problems = await resolveSimProblems(parsed.rows);
      setContest((old) => ({ ...old, problems }));
      setCheckedText(text);
      setMessage(`已解析 ${problems.length} 题，其中 ${problems.filter((p) => !p.found).length} 题未收录。`);
    } catch (error) { setMessage(`核验失败：${error.message}`); }
    finally { setChecking(false); }
  };
  const save = () => {
    try {
      const list = readSimContests(localStorage);
      const latest = list.find((item) => item.id === contest.id);
      if (latest?.runningSince && listText(latest.problems) !== listText(contest.problems)) {
        setMessage('比赛正在计时，请先暂停再修改题单。');
        return;
      }
      const next = { ...contest, ...(latest ? { elapsedMs: latest.elapsedMs, runningSince: latest.runningSince, startedAt: latest.startedAt, minutes: latest.startedAt ? latest.minutes : contest.minutes, ...reconcileSimProblems(latest, contest.problems) } : {}), name: contest.name.trim() || '未命名模拟赛' };
      writeSimContests(localStorage, [next, ...list.filter((item) => item.id !== next.id)]);
      onSaved(next);
    } catch { setMessage('保存失败，请检查浏览器存储空间。'); }
  };
  return <div className="space-y-5 py-10">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-bold tracking-tight">{initial.problems.length ? '比赛设置' : '新建比赛'}</h1><p className="text-muted-foreground mt-2 text-sm">设置比赛名称、限时与题单。</p></div><Button variant="outline" onClick={onCancel}>返回列表</Button></div>
    <Card><CardContent className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_160px]">
      <label className="text-sm font-medium">比赛名称<Input aria-label="比赛名称" className="mt-2" maxLength={100} value={contest.name} onChange={(e) => setContest((old) => ({ ...old, name: e.target.value }))} /></label>
      <label className="text-sm font-medium">限时（分钟）<Input aria-label="限时（分钟）" className="mt-2" type="number" min="1" max="1440" placeholder="不限时" disabled={Boolean(contest.startedAt)} value={contest.minutes || ''} onChange={(e) => setContest((old) => ({ ...old, minutes: Math.min(1440, Math.max(0, Math.floor(Number(e.target.value)))) }))} /></label>
    </CardContent></Card>
    <Card><CardContent className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">比赛题目</h2><p className="text-muted-foreground mt-1 text-xs">每行一道题，按平台 | 题号 | 分值 | 别名排列，也可使用 Tab 分隔。</p></div><Button onClick={validate} disabled={checking || !!contest.runningSince}><Check className="size-4" />{checking ? '正在核验…' : '解析并核验题目'}</Button></div>
      <textarea aria-label="题目列表" disabled={!!contest.runningSince} value={text} onChange={(e) => setText(e.target.value)} spellCheck="false" placeholder={'Codeforces | 1519B | 1 | 道路是曲折的\nAtCoder | abc034_b | 1 |'} className="bg-muted/35 min-h-56 w-full resize-y rounded-lg border px-3 py-3 font-mono text-xs leading-6 outline-none focus:border-primary/60 disabled:opacity-60" />
      {parsed.errors.length > 0 && <ul className="space-y-1 text-xs text-destructive">{parsed.errors.slice(0, 12).map((error) => <li key={error.line}>第 {error.line} 行：{error.message}</li>)}</ul>}
      {message && <p role="status" className="text-muted-foreground text-sm">{message}</p>}
      {contest.problems.length > 0 && checkedText === text && <div className="divide-y rounded-lg border" aria-label="已核验题目">{contest.problems.map((p, index) => <div key={p.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="text-muted-foreground w-7 font-mono">{index + 1}</span><span className="min-w-0 flex-1">{p.alias || p.titleZh || p.title || p.id}<span className="text-muted-foreground ml-2 text-xs">{PLATFORM_NAME[p.platform]} {p.id}</span></span>{p.found === false && <a href={p.originalUrl} target="_blank" rel="noreferrer" className="text-amber-600 text-xs">本站未收录 · 原题链接</a>}</div>)}</div>}
    </CardContent></Card>
    <div className="flex flex-wrap gap-2"><Button onClick={save} disabled={checking || checkedText !== text || !contest.problems.length}>保存并进入比赛</Button><Button variant="outline" onClick={onCancel}>取消</Button></div>
  </div>;
}

export default function Simulator() {
  const [contests, setContests] = useState([]);
  const [ready, setReady] = useState(false);
  const [editor, setEditor] = useState(null);
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    const sync = () => setContests(readSimContests(localStorage));
    sync();
    const edit = new URLSearchParams(location.search).get('edit');
    const item = readSimContests(localStorage).find((c) => c.id === edit);
    if (item) setEditor(item);
    else {
      const shared = new URLSearchParams(location.hash.slice(1)).get('data') || new URLSearchParams(location.search).get('data');
      if (shared) {
        try { setEditor({ ...newSimContest(), ...decodeSimShare(shared) }); }
        catch (error) { setMessage(error.message); }
      }
    }
    setReady(true);
    window.addEventListener(SIM_STORE_EVENT, sync);
    const onStorage = (event) => { if (event.key === SIM_STORE_KEY) sync(); };
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(SIM_STORE_EVENT, sync); window.removeEventListener('storage', onStorage); };
  }, []);
  const filtered = useMemo(() => contests.filter((c) => `${c.name} ${c.id}`.toLowerCase().includes(query.trim().toLowerCase())), [contests, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 50, currentPage * 50);
  const selection = contests.filter((c) => selected.includes(c.id));
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const existing = readSimContests(localStorage);
      const imported = importSimContests(text, existing);
      writeSimContests(localStorage, [...imported, ...existing]);
      setMessage(`已导入 ${imported.length} 场比赛。`);
    } catch (error) { setMessage(`导入失败：${error.message}`); }
  };
  const remove = () => {
    if (!selection.length || !window.confirm(`确定删除选中的 ${selection.length} 场比赛？`)) return;
    try { writeSimContests(localStorage, readSimContests(localStorage).filter((c) => !selected.includes(c.id))); setSelected([]); setMessage('已删除所选比赛。'); }
    catch { setMessage('删除失败，请检查浏览器存储空间。'); }
  };
  if (!ready) return <div className="text-muted-foreground py-20 text-center">正在载入模拟赛…</div>;
  if (editor) return <ContestEditor key={editor.id} initial={editor} onCancel={() => { setEditor(null); history.replaceState(history.state, '', '/simulator'); }} onSaved={(contest) => { location.href = simContestHref(contest); }} />;
  return <div className="space-y-6 py-10">
    <div><h1 className="text-3xl font-bold tracking-tight">模拟赛</h1><p className="text-muted-foreground mt-2 text-sm">浏览和管理保存在本机的模拟赛。</p></div>
    <div className="flex flex-wrap items-center gap-2"><Button onClick={() => setEditor(newSimContest())}><Plus className="size-4" />新建比赛</Button><Button variant="outline" onClick={() => { setManage(!manage); setSelected([]); }}><Settings2 className="size-4" />{manage ? '完成管理' : '管理比赛'}</Button></div>
    {manage && <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3"><Button size="sm" variant="outline" onClick={() => setSelected(filtered.map((c) => c.id))}>全选筛选结果</Button><Button size="sm" variant="outline" onClick={() => setSelected([])}>取消选择</Button><span className="text-muted-foreground text-xs">已选 {selection.length} 场</span><Button size="sm" variant="outline" disabled={!selection.length} onClick={() => download(exportSimContests(selection), '模拟赛.json', 'application/json;charset=utf-8')}><Download className="size-4" />导出比赛</Button><Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}><Upload className="size-4" />导入比赛</Button><input ref={inputRef} type="file" accept="application/json,.json" className="hidden" aria-label="导入比赛文件" onChange={importFile} /><Button size="sm" variant="outline" disabled={!selection.length} onClick={() => download(makeLog(selection), '模拟赛记录.md', 'text/markdown;charset=utf-8')}>导出比赛日志</Button><Button size="sm" variant="destructive" disabled={!selection.length} onClick={remove}>删除所选</Button></div>}
    {message && <p role="status" className="text-muted-foreground text-sm">{message}</p>}
    <div className="flex flex-wrap items-center gap-3"><div className="relative w-full sm:w-72"><Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" /><Input aria-label="搜索比赛名称或编号" placeholder="搜索比赛名称或编号…" className="pl-8" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></div><Badge variant="secondary" className="shrink-0 tabular-nums sm:ml-auto">{filtered.length} 场</Badge></div>
    <Card><CardContent className="divide-y p-0">{!visible.length && <div className="text-muted-foreground p-8 text-center text-sm">{contests.length ? '没有匹配的比赛' : '还没有模拟赛，点击新建比赛开始。'}</div>}{visible.map((contest) => <div key={contest.id} className="flex items-center">{manage && <input type="checkbox" aria-label={`选择 ${contest.name}`} className="ml-4 size-4" checked={selected.includes(contest.id)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, contest.id] : old.filter((id) => id !== contest.id))} />}<Link href={simContestHref(contest)} className="contest-row hover:bg-accent/40 grid min-w-0 flex-1 items-center gap-x-3 px-4 py-3 transition-colors"><Badge variant="outline" className="w-full justify-center">模拟赛</Badge><Badge variant="outline" className="text-muted-foreground hidden w-full justify-center sm:inline-flex">自定义</Badge><span className="text-muted-foreground hidden truncate font-mono text-xs sm:block">{contest.id}</span><span className="min-w-0 truncate text-sm font-medium">{contest.name}</span><span className="text-muted-foreground hidden justify-center text-xs md:flex">{contest.minutes ? `${contest.minutes} 分钟` : '不限时'}</span><span className="text-muted-foreground hidden text-right text-xs tabular-nums md:block">{contest.createdAt ? formatDateTime(new Date(contest.createdAt).toISOString()) : '—'}</span><Badge variant="secondary" className="w-full justify-center tabular-nums">{contest.problems.length} 题</Badge></Link>{manage && <Button size="sm" variant="ghost" onClick={() => setEditor(contest)}>设置</Button>}</div>)}</CardContent></Card>
    {pages > 1 && <div className="flex items-center justify-center gap-3"><Button variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</Button><span className="text-muted-foreground text-sm">{currentPage} / {pages}</span><Button variant="outline" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页</Button></div>}
  </div>;
}
