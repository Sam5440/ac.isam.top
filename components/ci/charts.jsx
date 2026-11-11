'use client';

/**
 * /ci 抓取日志页的手绘 SVG 图表组件（无图表库，参考姊妹项目
 * ys_problem_web/components/logs-view.jsx 的设计：Sparkline / Donut /
 * ActivityChart / RunOutputChart / ChartTip）。
 *
 * 时间锚点统一取「最新一次运行的 startedAt」而非 Date.now()——服务端渲染
 * 与客户端首帧产出同一棵树，避免 hydration 不一致；远端同步只经 setState
 * 在挂载后生效。
 */

import { useId, useMemo, useState } from 'react';

const DAY = 86_400_000;
export const RETENTION_DAYS = 60;

/* ---------------------------------- helpers --------------------------------- */

export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const dayLabel = (key) => {
  const [, m, d] = key.split('-');
  return `${Number(m)}/${Number(d)}`;
};

export function fmtDur(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 1) return '<1 秒';
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m} 分 ${rs} 秒` : `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 时 ${m % 60} 分`;
}

/** 整数 y 轴：小值逐 1，大值取好看整数步长。 */
export function niceScale(yMax) {
  if (yMax <= 6) return { max: yMax, ticks: Array.from({ length: yMax + 1 }, (_, i) => i) };
  const rawStep = yMax / 3;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) || 10 * mag;
  const max = Math.ceil(yMax / step) * step;
  return { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step) };
}

/* Tailwind 风格 SVG 调色板（与全站语义色一致） */
export const TONE = {
  emerald: { solid: '#10b981', light: '#34d399' },
  sky: { solid: '#0ea5e9', light: '#38bdf8' },
  violet: { solid: '#8b5cf6', light: '#a78bfa' },
  amber: { solid: '#f59e0b', light: '#fbbf24' },
  red: { solid: '#ef4444', light: '#f87171' },
  zinc: { solid: '#71717a', light: '#a1a1aa' },
};

/* ------------------------------- Sparkline ------------------------------- */

export function Sparkline({ data = [], tone = 'emerald', width: w = 76 }) {
  const id = useId();
  const t = TONE[tone] || TONE.emerald;
  const h = 32;
  if (!data.length || data.every((v) => v === 0)) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="h-8 shrink-0" style={{ width: w }} aria-hidden>
        <line x1="0" y1={h - 6} x2={w} y2={h - 6} stroke={t.solid} strokeOpacity="0.25" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 4" />
      </svg>
    );
  }
  const max = Math.max(...data, 1);
  const px = (i) => (data.length === 1 ? w / 2 : (i / (data.length - 1)) * (w - 4) + 2);
  const py = (v) => h - 4 - (v / max) * (h - 10);
  const pts = data.map((v, i) => `${px(i)},${py(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 shrink-0" style={{ width: w }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={t.light} stopOpacity="0.35" />
          <stop offset="100%" stopColor={t.light} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`2,${h - 2} ${pts} ${w - 2},${h - 2}`} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke={t.solid} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((v, i) => (
        <circle key={i} cx={px(i)} cy={py(v)} r="2.5" fill={t.solid} />
      ))}
    </svg>
  );
}

/* --------------------------------- Donut --------------------------------- */

export function Donut({ success, fail }) {
  const id = useId();
  const total = success + fail;
  const pct = total ? Math.round((success / total) * 100) : 100;
  const r = 46;
  const c = 2 * Math.PI * r;
  const failLen = total ? (fail / total) * c : 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" className="-rotate-90 h-32 w-32">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={TONE.emerald.light} />
            <stop offset="100%" stopColor={TONE.emerald.solid} />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" className="text-border" strokeWidth="11" />
        {total > 0 && (
          <circle cx="60" cy="60" r={r} fill="none" stroke={`url(#${id})`} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${c - failLen} ${c}`} />
        )}
        {fail > 0 && (
          <circle cx="60" cy="60" r={r} fill="none" stroke={TONE.red.solid} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${failLen} ${c}`} strokeDashoffset={-(c - failLen)} />
        )}
      </svg>
      <div className="min-w-0 space-y-1.5">
        <p className="text-3xl font-bold leading-none tabular-nums">{pct}<span className="text-muted-foreground text-base">%</span></p>
        <p className="text-muted-foreground text-[11px]">运行成功率</p>
        <p className="flex items-center gap-1.5 text-[11px]">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />正常 {success}
        </p>
        <p className="flex items-center gap-1.5 text-[11px]">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" />失败 {fail}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------- ChartTip -------------------------------- */

export function ChartTip({ tip }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[11px] whitespace-nowrap shadow-xl"
      style={{ left: tip.left, top: tip.top }}
    >
      {tip.node}
    </div>
  );
}

/* ------------------------------ ActivityChart ------------------------------ */

/**
 * 每日运行柱状图（绿=正常，红=有失败），悬停提示、点击定位到当天的运行。
 * 窗口 = windowDays 天（默认 30），以 anchorMs（最新运行日）为终点。
 */
export function ActivityChart({ runs, anchorMs, windowDays = 30, onPickDay }) {
  const id = useId();
  const [tip, setTip] = useState(null);
  const days = useMemo(() => {
    const byDay = new Map();
    for (const r of runs) {
      if (!r.startedAt) continue;
      const k = isoDay(Date.parse(r.startedAt));
      const e = byDay.get(k) || { ok: 0, bad: 0 };
      if (r.failure) e.bad += 1;
      else e.ok += 1;
      byDay.set(k, e);
    }
    return Array.from({ length: windowDays }, (_, i) => {
      const key = isoDay(anchorMs - (windowDays - 1 - i) * DAY);
      return { key, ok: 0, bad: 0, ...(byDay.get(key) || {}) };
    });
  }, [runs, anchorMs, windowDays]);

  const W = 860;
  const H = 200;
  const padL = 30;
  const padR = 8;
  const padT = 14;
  const padB = 26;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const slot = iw / days.length;
  const { max: yMax, ticks } = niceScale(Math.max(1, ...days.map((d) => d.ok + d.bad)));
  const y = (v) => padT + ih - (v / yMax) * ih;
  const barW = Math.min(10, slot * 0.62);
  const labelEvery = Math.max(1, Math.ceil(days.length / 10));

  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <ChartTip tip={tip} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          <linearGradient id={`${id}-ok`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TONE.emerald.light} />
            <stop offset="100%" stopColor={TONE.emerald.solid} />
          </linearGradient>
          <linearGradient id={`${id}-bad`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TONE.red.light} />
            <stop offset="100%" stopColor={TONE.red.solid} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-border" strokeOpacity={t === 0 ? 0.9 : 0.45} strokeDasharray={t === 0 ? '' : '3 4'} />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" className="fill-muted-foreground text-[9px] tabular-nums">{t}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const tot = d.ok + d.bad;
          const oy = y(d.ok);
          const by = y(tot);
          return (
            <g key={d.key}>
              {tot > 0 && (
                <>
                  <rect x={cx - barW / 2} y={oy} width={barW} height={Math.max(2, padT + ih - oy)} rx={Math.min(3, barW / 2)} fill={`url(#${id}-ok)`} />
                  {d.bad > 0 && (
                    <rect x={cx - barW / 2} y={by} width={barW} height={Math.max(2, oy - by)} rx={Math.min(3, barW / 2)} fill={`url(#${id}-bad)`} />
                  )}
                </>
              )}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[9px]">{dayLabel(d.key)}</text>
              )}
              <rect
                x={padL + slot * i} y={padT} width={slot} height={ih} fill="transparent"
                className={tot > 0 ? 'cursor-pointer' : ''}
                onMouseEnter={() =>
                  setTip({
                    left: `${((padL + slot * i + slot / 2) / W) * 100}%`,
                    top: `${(Math.min(y(tot), padT + ih / 2) / H) * 100}%`,
                    node: (
                      <>
                        <p className="font-medium">{d.key}</p>
                        <p className="text-muted-foreground mt-0.5">
                          {tot ? `正常 ${d.ok}${d.bad ? ` · 失败 ${d.bad}` : ''} · 点击定位` : '无运行'}
                        </p>
                      </>
                    ),
                  })
                }
                onClick={() => tot > 0 && onPickDay?.(d.key)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ----------------------------- RunOutputChart ----------------------------- */

/**
 * 单次运行产出对比：每轮两根柱（sky=新抓+回填题面，violet=AI 翻译段数），
 * 空跑画为基线圆点；悬停提示、点击展开对应运行卡片。
 */
export function RunOutputChart({ runsChrono, onPickRun }) {
  const id = useId();
  const [tip, setTip] = useState(null);
  const data = useMemo(
    () =>
      runsChrono.slice(-40).map((r) => ({
        key: r.runId || r.startedAt,
        startedAt: r.startedAt,
        failure: r.failure,
        fetched: (r.stats?.new || 0) + (r.stats?.updated || 0),
        translated: r.stats?.translated || 0,
        failed: r.stats?.failed || 0,
      })),
    [runsChrono],
  );

  const W = 860;
  const H = 210;
  const padL = 30;
  const padR = 8;
  const padT = 14;
  const padB = 34;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const slot = iw / Math.max(1, data.length);
  const { max: yMax, ticks } = niceScale(Math.max(1, ...data.map((d) => Math.max(d.fetched, d.translated))));
  const y = (v) => padT + ih - (v / yMax) * ih;
  const barW = Math.min(14, slot * 0.3);
  const labelEvery = Math.max(1, Math.ceil(data.length / 10));

  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <ChartTip tip={tip} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TONE.sky.light} />
            <stop offset="100%" stopColor={TONE.sky.solid} />
          </linearGradient>
          <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TONE.violet.light} />
            <stop offset="100%" stopColor={TONE.violet.solid} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-border" strokeOpacity={t === 0 ? 0.9 : 0.45} strokeDasharray={t === 0 ? '' : '3 4'} />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" className="fill-muted-foreground text-[9px] tabular-nums">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          return (
            <g key={d.key}>
              {d.fetched > 0 && <rect x={cx - barW - 1} y={y(d.fetched)} width={barW} height={Math.max(2, padT + ih - y(d.fetched))} rx={Math.min(3, barW / 2)} fill={`url(#${id}-f)`} />}
              {d.translated > 0 && <rect x={cx + 1} y={y(d.translated)} width={barW} height={Math.max(2, padT + ih - y(d.translated))} rx={Math.min(3, barW / 2)} fill={`url(#${id}-a)`} />}
              {d.fetched === 0 && d.translated === 0 && <circle cx={cx} cy={padT + ih - 1} r="2" className="fill-muted-foreground/40" />}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 16} textAnchor="middle" className="fill-muted-foreground text-[9px]">{d.startedAt ? dayLabel(isoDay(Date.parse(d.startedAt))) : ''}</text>
              )}
              <rect
                x={padL + slot * i} y={padT} width={slot} height={ih} fill="transparent" className="cursor-pointer"
                onMouseEnter={() =>
                  setTip({
                    left: `${(cx / W) * 100}%`,
                    top: `${(Math.min(y(Math.max(d.fetched, d.translated)), padT + ih / 2) / H) * 100}%`,
                    node: (
                      <>
                        <p className="font-medium">
                          {d.startedAt ? new Date(d.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                          {d.failure ? ' · 失败' : ''}
                        </p>
                        <p className="text-muted-foreground mt-0.5">
                          抓取/回填 {d.fetched} 题 · AI 翻译 {d.translated} 题{d.failed ? ` · 失败 ${d.failed}` : ''} · 点击查看
                        </p>
                      </>
                    ),
                  })
                }
                onClick={() => onPickRun?.(d.key)}
              />
            </g>
          );
        })}
      </svg>
      <div className="text-muted-foreground mt-1 flex items-center gap-4 pl-8 text-[10px]">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-sky-500" />新抓 + 回填题面</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-violet-500" />AI 翻译</span>
      </div>
    </div>
  );
}
