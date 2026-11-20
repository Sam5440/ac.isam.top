'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Clock3, Download, ExternalLink, Flag, Link2, Pause, Play, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { clockSnapshot, formatElapsed, decodeSimShare, encodeSimShare, parseSimProblemList } from '@/lib/sim-contest.mjs';

const STORE_KEY = 'ac-simulator-contests-v1';
const PLATFORM_NAME = { atcoder: 'AtCoder', codeforces: 'CodeForces', 'cf-gyms': 'Gym', nowcoder: '牛客' };
const listText = (ps) => ps.map((p) => `${PLATFORM_NAME[p.platform] || p.platform} | ${p.id} | ${p.points ?? 1} | ${p.alias || ''}`).join('\n');
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emptyContest = () => ({ id: uid(), name: '我的模拟赛', problems: [], createdAt: Date.now(), elapsedMs: 0, runningSince: null, activeProblem: null, problemTimes: {}, completed: {} });

function contestHref(value, withAliases = true) {
  const contestId = encodeURIComponent(String(value.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80));
  return `/contests/codeforces/sim-${contestId}#data=${encodeSimShare(value, withAliases)}`;
}

async function resolveProblems(rows) {
  const res = await fetch('/api/simulator/problems', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ problems: rows.map(({ platform, id }) => ({ platform, id })) }) });
  const body = await res.json();
  if (!res.ok || body.problems?.length !== rows.length) throw new Error(body.error || '题库核验失败');
  const occurrences = new Map();
  return rows.map((p, i) => {
    const base = `${p.platform}:${p.id.toLowerCase()}`;
    const n = occurrences.get(base) || 0;
    occurrences.set(base, n + 1);
    return { ...p, ...body.problems[i], key: n ? `${base}:${n}` : base };
  });
}

function makeLog(contests) {
  return `# 模拟赛记录\n\n${contests.map((contest) => {
    const duration = contest.elapsedMs + (contest.runningSince ? Date.now() - contest.runningSince : 0);
    return `## ${contest.name}\n\n- 开始：${contest.startedAt ? new Date(contest.startedAt).toLocaleString('zh-CN') : '未开始'}\n- 总用时：${formatElapsed(duration)}\n- 题目：${contest.problems.length}\n\n| 平台 | 题号 | 分值 | 题名 | 别名 | 用时 | 状态 |\n| --- | --- | ---: | --- | --- | --- | --- |\n${contest.problems.map((p) => `| ${PLATFORM_NAME[p.platform] || p.platform} | ${p.id} | ${p.points} | ${(p.titleZh || p.title || '').replaceAll('|', '\\|')} | ${(p.alias || '').replaceAll('|', '\\|')} | ${formatElapsed(contest.problemTimes?.[p.key] || 0)} | ${contest.completed?.[p.key] ? '完成' : '未完成'} |`).join('\n')}\n`;
  }).join('\n')}`;
}

export default function Simulator() {
  const [saved, setSaved] = useState([]);
  const [contest, setContest] = useState(null);
  const [text, setText] = useState('');
  const [includeAliases, setIncludeAliases] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch {}
    list = Array.isArray(list) ? list.filter((c) => c && typeof c.name === 'string' && Array.isArray(c.problems)) : [];
    const shared = new URLSearchParams(location.hash.slice(1)).get('data') || new URLSearchParams(location.search).get('data');
    if (shared) {
      try {
        const data = decodeSimShare(shared);
        const next = { ...emptyContest(), ...data, startedAt: null };
        setContest(next);
        setText(listText(data.problems));
      } catch (error) { setMessage(error.message); setContest(emptyContest()); }
    } else if (list.length) { setContest(list[0]); setText(listText(list[0].problems)); }
    else setContest(emptyContest());
    setSaved(Array.isArray(list) ? list : []);
    setInitialized(true);
  }, []);

  // A share URL stores the compact problem list; resolve current titles/availability on the recipient's device.
  useEffect(() => {
    if (!contest?.problems?.length || contest.problems[0]?.key) return;
    let alive = true;
    resolveProblems(contest.problems).then((problems) => {
      if (alive) setContest((old) => old?.id === contest.id && old.problems === contest.problems ? { ...old, problems } : old);
    }).catch(() => { if (alive) setMessage('题库核验失败，请点击「解析并核验题目」重试。'); });
    return () => { alive = false; };
  }, [contest?.id]);

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (initialized) { try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch { setMessage('本机存储不可用，请导出比赛日志。'); } } }, [initialized, saved]);

  const parsed = useMemo(() => parseSimProblemList(text), [text]);
  const clock = contest ? clockSnapshot(contest, now) : null;
  const elapsed = clock?.elapsedMs || 0;
  const needsValidation = !!contest && (parsed.errors.length > 0 || parsed.rows.length !== contest.problems.length || parsed.rows.some((r, i) => {
    const p = contest.problems[i];
    return !p.key || p.platform !== r.platform || p.id.toLowerCase() !== r.id.toLowerCase() || p.points !== r.points || p.alias !== r.alias;
  }));
  useEffect(() => {
    if (clock?.expired && contest?.runningSince) setContest((c) => ({ ...c, ...clockSnapshot(c, Date.now()), runningSince: null, activeProblemSince: null }));
  }, [clock?.expired, contest?.runningSince]);
  const mutateContest = useCallback((fn) => setContest((old) => old ? fn(old) : old), []);
  useEffect(() => {
    if (contest) setSaved((list) => list.some((item) => item.id === contest.id && item !== contest) ? list.map((item) => item.id === contest.id ? contest : item) : list);
  }, [contest]);

  const validate = async () => {
    if (parsed.errors.length) { setMessage(`请先修正 ${parsed.errors.length} 行格式错误。`); return; }
    if (!parsed.rows.length) { setMessage('请先输入题目列表。'); return; }
    setChecking(true); setMessage('');
    try {
      const problems = await resolveProblems(parsed.rows);
      mutateContest((old) => old.id === contest.id ? { ...old, problems, activeProblem: problems.some((p) => p.key === old.activeProblem) ? old.activeProblem : null } : old);
      const missing = problems.filter((p) => !p.found).length;
      setMessage(missing ? `已解析 ${problems.length} 题；${missing} 题不在本站题库，已附上原题比赛链接。` : `已验证 ${problems.length} 题，全部在本站题库中。`);
    } catch (error) { setMessage(`验证失败：${error.message}`); }
    finally { setChecking(false); }
  };

  const startClock = () => mutateContest((old) => ({ ...old, startedAt: old.startedAt || Date.now(), runningSince: Date.now(), activeProblemSince: old.activeProblem ? Date.now() : null }));
  const pauseClock = () => mutateContest((old) => {
    if (!old.runningSince) return old;
    return { ...old, ...clockSnapshot(old, Date.now()), runningSince: null, activeProblemSince: null };
  });
  const resetClock = () => mutateContest((old) => ({ ...old, elapsedMs: 0, runningSince: null, startedAt: null, activeProblem: null, activeProblemSince: null, problemTimes: {}, completed: {} }));

  const activateProblem = (key) => mutateContest((old) => {
    const { problemTimes: times, expired } = clockSnapshot(old, Date.now());
    if (expired || !old.runningSince) return old;
    return { ...old, activeProblem: old.activeProblem === key ? null : key,
      activeProblemSince: key === old.activeProblem || !old.runningSince ? null : Date.now(), problemTimes: times };
  });
  const markComplete = (key) => mutateContest((old) => {
    const time = Date.now();
    const snapshot = clockSnapshot(old, time);
    const times = snapshot.problemTimes;
    const activeProblemSince = old.activeProblem === key ? null
      : old.activeProblemSince && old.runningSince ? time : old.activeProblemSince;
    return { ...old, activeProblem: old.activeProblem === key ? null : old.activeProblem,
      activeProblemSince,
      problemTimes: times, completed: { ...old.completed, [key]: !old.completed?.[key] } };
  });

  const saveContest = () => {
    if (!contest) return;
    const next = { ...contest, name: contest.name.trim() || '未命名模拟赛' };
    setContest(next);
    setSaved((list) => [next, ...list.filter((item) => item.id !== next.id)]);
    if (location.hash || location.search) history.replaceState(history.state, '', location.pathname);
    setMessage('模拟赛已保存到本机。');
  };
  const prepareContestEntry = () => {
    if (!contest || needsValidation || !contest.problems.length) return;
    const current = { ...contest, name: contest.name.trim() || '未命名模拟赛' };
    const nextSaved = [current, ...saved.filter((item) => item.id !== current.id)];
    try { localStorage.setItem(STORE_KEY, JSON.stringify(nextSaved)); } catch {}
    setContest(current);
    setSaved(nextSaved);
  };
  const leaveContest = () => {
    if (contest?.runningSince) {
      const paused = { ...contest, ...clockSnapshot(contest, Date.now()), runningSince: null, activeProblemSince: null };
      setSaved((list) => list.map((entry) => entry.id === contest.id ? paused : entry));
    }
    if (location.hash || location.search) history.replaceState(history.state, '', location.pathname);
    setMessage('');
  };
  const newContest = () => { leaveContest(); setContest(emptyContest()); setText(''); };
  const selectContest = (item) => {
    if (item.id === contest?.id) return;
    leaveContest(); setContest(item); setText(listText(item.problems));
  };
  const deleteContest = (id) => {
    setSaved((list) => list.filter((item) => item.id !== id));
    if (contest?.id === id) newContest();
  };
  const shareUrl = () => `${location.origin}${contestHref(contest, includeAliases)}`;
  const copyShare = async () => {
    try { await navigator.clipboard.writeText(shareUrl()); setMessage('比赛链接已复制。'); }
    catch { setMessage(shareUrl()); }
  };
  const downloadLog = () => {
    const exportList = contest?.problems.length ? [...saved.filter((item) => item.id !== contest.id), contest] : saved;
    const snapshot = exportList.map((c) => ({ ...c, ...clockSnapshot(c, Date.now()), runningSince: null, problems: c.problems.map((p) => includeAliases ? p : { ...p, alias: '' }) }));
    const blob = new Blob([makeLog(snapshot)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `模拟赛记录-${new Date().toISOString().slice(0, 10)}.md`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!contest) return <div className="py-20 text-center text-muted-foreground">正在载入模拟赛…</div>;
  const totalPoints = contest.problems.reduce((sum, p) => sum + (Number(p.points) || 0), 0);
  return <div className="mx-auto max-w-6xl space-y-6 py-8 sm:py-10">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-primary font-mono text-xs uppercase tracking-[0.2em]">Practice / 01</p><h1 className="mt-2 text-3xl font-bold tracking-tight">模拟赛工作台</h1><p className="text-muted-foreground mt-2 max-w-2xl text-sm">贴入题目清单，核验题目后开始计时。赛程和计时数据保存在当前设备。</p></div>
      <Button variant="outline" onClick={downloadLog}><Download className="size-4" />导出全部比赛日志</Button>
    </header>

    <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <Button className="w-full" onClick={newContest}><Plus className="size-4" />新建模拟赛</Button>
        <Card><CardContent className="p-3"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">已保存 · {saved.length}</h2>
          <div className="space-y-1">{saved.map((item) => <div key={item.id} className={`flex items-center rounded-lg ${item.id === contest.id ? 'bg-primary/10' : 'hover:bg-muted'}`}>
            <button className="min-w-0 flex-1 px-3 py-2 text-left" onClick={() => selectContest(item)}><span className="block truncate text-sm font-medium">{item.name}</span><span className="text-muted-foreground text-[11px]">{item.problems.length} 题 · {formatElapsed(clockSnapshot(item, now).elapsedMs)}</span></button>
            <Link href={contestHref(item, includeAliases)} aria-label={`进入${item.name}`} title="进入比赛" className="text-muted-foreground p-2 hover:text-primary"><ExternalLink className="size-3.5" /></Link>
            <button aria-label={`删除${item.name}`} className="text-muted-foreground p-2 hover:text-destructive" onClick={() => deleteContest(item.id)}><Trash2 className="size-3.5" /></button>
          </div>)}{!saved.length && <p className="text-muted-foreground px-2 py-4 text-xs">保存后可在此切换多场模拟赛。</p>}</div>
        </CardContent></Card>
      </aside>

      <main className="min-w-0 space-y-5">
        <Card className="overflow-hidden border-primary/20">
          <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 sm:p-7">
            <label className="text-muted-foreground text-xs font-medium" htmlFor="sim-name">比赛名称</label>
            <Input id="sim-name" className="mt-1 max-w-xl border-0 bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0" value={contest.name} onChange={(e) => mutateContest((old) => ({ ...old, name: e.target.value.slice(0, 100) }))} />
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="rounded-xl border bg-background/75 px-4 py-2.5"><div className="text-muted-foreground flex items-center gap-1.5 text-[10px] uppercase tracking-widest"><Clock3 className="size-3" />比赛计时</div><output aria-label="比赛计时" className="mt-1 block font-mono text-3xl font-semibold tabular-nums tracking-wider">{formatElapsed(elapsed)}</output></div>
              <label className="text-muted-foreground text-xs">限时（分钟）<Input type="number" min="1" max="1440" placeholder="不限时" className="mt-1 w-24" disabled={!!contest.startedAt} value={contest.minutes || ''} onChange={(e) => { const minutes = Math.min(1440, Math.max(0, Math.floor(Number(e.target.value)))); mutateContest((c) => ({ ...c, minutes })); }} /></label>
              {contest.minutes > 0 && <span className="text-sm font-mono">{clock.expired ? '时间到' : `剩余 ${formatElapsed(contest.minutes * 60000 - elapsed)}`}</span>}
              {!contest.runningSince ? <Button disabled={clock.expired || !contest.problems.length || needsValidation} onClick={startClock}><Play className="size-4" />{elapsed ? '继续比赛' : '开始比赛'}</Button> : <Button variant="outline" onClick={pauseClock}><Pause className="size-4" />暂停计时</Button>}
              <Button variant="ghost" onClick={resetClock}><RotateCcw className="size-4" />重置</Button>
              <span className="text-muted-foreground text-xs">{contest.problems.length} 题 · {totalPoints} 分</span>
              <span className="flex-1" />
              {!contest.problems.length || needsValidation ? (
                <Button variant="outline" disabled><span>进入比赛</span><ExternalLink className="size-4" /></Button>
              ) : (
                <Button asChild variant="outline">
                  <Link href={contestHref(contest, includeAliases)} onClick={prepareContestEntry}>进入比赛<ExternalLink className="size-4" /></Link>
                </Button>
              )}
              <Button variant="outline" disabled={!contest.problems.length || needsValidation} onClick={saveContest}><Save className="size-4" />保存比赛</Button>
            </div>
          </div>
          <CardContent className="grid gap-3 border-t bg-card/60 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeAliases} onChange={(e) => setIncludeAliases(e.target.checked)} />分享时带上题目别名</label><Button size="sm" variant="outline" onClick={copyShare} disabled={needsValidation || !contest.problems.length}><Link2 className="size-3.5" />复制当场链接</Button></div>
            <p className="text-muted-foreground text-[11px]">链接包含题号与比赛名{includeAliases ? '及别名' : '（不含别名）'}，计时记录仅保存在本机。</p>
          </CardContent>
        </Card>

        <Card><CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">题目清单</h2><p className="text-muted-foreground mt-1 text-xs">支持 `|` 或 Tab 分隔：平台 | 题号 | 分值 | 别名；每行一道题。</p></div><Button onClick={validate} disabled={checking || !!contest.runningSince || !text.trim()}><Check className="size-4" />{checking ? '正在核验…' : '解析并核验题目'}</Button></div>
          <textarea aria-label="题目列表" disabled={!!contest.runningSince} value={text} onChange={(e) => setText(e.target.value)} spellCheck="false" placeholder={'CodeForces | 1519B | 1 | 道路是曲折的，前途是光明的\nAtCoder | abc034_b | 1 | \n牛客 | 25005 | 1 |'} className="bg-muted/35 min-h-48 w-full resize-y rounded-lg border px-3 py-3 font-mono text-xs leading-6 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15 disabled:opacity-60" />
          {parsed.errors.length > 0 && <ul className="space-y-1 text-xs text-destructive">{parsed.errors.slice(0, 12).map((err) => <li key={err.line}>第 {err.line} 行：{err.message}</li>)}</ul>}
          {message && <p role="status" className="text-muted-foreground text-xs break-all">{message}</p>}
        </CardContent></Card>

        <section className="space-y-3" aria-label="比赛题目">
          {contest.problems.map((problem, i) => {
            const currentMs = clock.problemTimes[problem.key] || 0;
            return <Card key={problem.key || `${problem.platform}-${problem.id}-${i}`} className={`overflow-hidden transition ${contest.completed?.[problem.key] ? 'border-emerald-500/40' : contest.activeProblem === problem.key ? 'border-primary/60 shadow-[0_0_0_1px] shadow-primary/10' : ''}`}>
              <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                <span className="text-muted-foreground w-7 font-mono text-xs">{String(i + 1).padStart(2, '0')}</span>
                <span className="bg-muted rounded px-2 py-1 text-[10px] font-semibold">{PLATFORM_NAME[problem.platform]}</span>
                <span className="font-mono text-sm font-semibold">{problem.id}</span>
                <span className="text-muted-foreground text-xs">{problem.points} 分</span>
                <span className="min-w-0 flex-1 basis-40"><span className="block text-sm">{problem.alias || problem.titleZh || problem.title || '—'}</span>{problem.alias && (problem.titleZh || problem.title) && <span className="text-muted-foreground block truncate text-[11px]">{problem.titleZh || problem.title}</span>}</span>
                {problem.found == null ? <span className="text-muted-foreground text-xs">待核验</span> : problem.found ? <Link className="text-primary inline-flex items-center gap-1 text-xs hover:underline" href={`/problems/${problem.platform}/${encodeURIComponent(String(problem.id))}`} target="_blank">打开题面<ExternalLink className="size-3" /></Link>
                  : <a className="text-amber-500 inline-flex items-center gap-1 text-xs hover:underline" href={problem.originalUrl} target="_blank" rel="noreferrer">题库无此题 · 原题链接<ExternalLink className="size-3" /></a>}
                <span className="w-20 text-right font-mono text-xs tabular-nums">{formatElapsed(currentMs)}</span>
                <Button size="sm" variant={contest.activeProblem === problem.key ? 'secondary' : 'outline'} onClick={() => activateProblem(problem.key)} disabled={!contest.runningSince}>{contest.activeProblem === problem.key ? <><Pause className="size-3.5" />暂停本题</> : <><Play className="size-3.5" />开始本题</>}</Button>
                <Button disabled={!problem.key} aria-label={contest.completed?.[problem.key] ? '撤销完成' : '标记完成'} size="icon-sm" variant="ghost" onClick={() => markComplete(problem.key)}><Flag className={`size-4 ${contest.completed?.[problem.key] ? 'text-emerald-500' : 'text-muted-foreground'}`} /></Button>
              </div>
              {problem.found === false && <p className="border-t bg-amber-500/5 px-4 py-2 text-xs text-amber-600 dark:text-amber-400">本站题库未收录 {PLATFORM_NAME[problem.platform]} {problem.id}。</p>}
            </Card>;
          })}
          {!contest.problems.length && <div className="rounded-xl border border-dashed py-10 text-center"><Clock3 className="text-muted-foreground mx-auto size-6" /><p className="mt-2 text-sm font-medium">题目清单还没载入</p><p className="text-muted-foreground mt-1 text-xs">粘贴上方列表并解析，即可开始模拟赛。</p></div>}
        </section>
      </main>
    </div>
  </div>;
}
