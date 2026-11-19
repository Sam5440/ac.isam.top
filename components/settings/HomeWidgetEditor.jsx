'use client';

import { useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, BarChart3, BookOpen, CalendarDays, Clock3, CloudSun, FileCode2, Grip,
  History, LayoutGrid, Library, Plus, SquareStack, Timer, TrendingUp, Trophy, Trash2, X,
} from 'lucide-react';
import { CATALOG, MAX_HEIGHT, MAX_WIDGETS, MAX_WIDTH, createWidget, gridNumber, insertWidget, packWidgets, resizeWidget, widgetTitle } from '@/lib/home-grid.mjs';
import { cellStyle, gridStyle, useGridColumns } from '@/components/home/widget-grid';
import { inputCls } from './controls';

const icons = { hero: Library, stats: BarChart3, contests: Trophy, problems: BookOpen, history: History, 'history-contests': CalendarDays, files: FileCode2, 'cf-rating': TrendingUp, clock: Clock3, weather: CloudSun, 'site-update': Timer };
const iconButton = 'inline-grid size-8 shrink-0 place-items-center rounded-md border bg-card hover:bg-accent disabled:opacity-35';
const groups = [...new Set(Object.values(CATALOG).map((spec) => spec.group))];

function LibraryList({ add, begin, end, full }) {
  return groups.map((group) => <section key={group} className="mb-4 last:mb-0">
    <h4 className="text-muted-foreground mb-1.5 text-xs font-medium">{group}</h4>
    {Object.entries(CATALOG).filter(([, spec]) => spec.group === group).map(([type, spec]) => {
      const Icon = icons[type];
      return <button key={type} type="button" draggable={!full} disabled={full} aria-label={`添加${spec.label}`}
        className="group flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent disabled:opacity-50 active:cursor-grabbing"
        onClick={() => add(type)} onDragStart={(event) => begin(event, createWidget(type, crypto.randomUUID()), true)} onDragEnd={end}>
        <Icon className="text-muted-foreground size-4 shrink-0" />{spec.label}<Plus className="text-muted-foreground ml-auto size-3" />
      </button>;
    })}
  </section>);
}

function Sketch({ widget }) {
  const { type, params } = widget;
  if (type === 'hero') return <span className="block"><strong className="text-xl">AC 题库</strong><small className="block">AtCoder · Codeforces · 牛客</small></span>;
  if (type === 'clock') return <span className="font-mono text-xl tabular-nums">09:41</span>;
  if (type === 'weather') return <span>{params.city || '默认城市'} · °{params.unit === 'fahrenheit' ? 'F' : 'C'}</span>;
  if (type === 'cf-rating') return <span className="font-mono">{params.handle || 'Rating'}</span>;
  if (params.limit) return <span className="block"><span>{params.platform || (params.kind === 'practiced' ? '最近做过' : '列表')} · {params.limit} 条</span><span className="mt-2 flex max-w-48 flex-col gap-1.5" aria-hidden="true"><i className="h-1 w-4/5 rounded bg-border" /><i className="h-1 w-3/5 rounded bg-border" /></span></span>;
  return null;
}

function Inspector({ widget, index, count, update, move, remove }) {
  const spec = CATALOG[widget.type];
  const selectSize = (key, label, max) => {
    const change = (value) => update(resizeWidget(widget, key === 'w' ? value : widget.w, key === 'h' ? value : widget.h));
    return <label className="text-muted-foreground grid gap-1 text-xs">{label}
      <select className={inputCls} value={widget[key]} onChange={(event) => change(event.target.value)} onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const value = event.key === 'Home' ? 1 : event.key === 'End' ? max : gridNumber(widget[key] + (event.key === 'ArrowDown' ? 1 : -1), max, widget[key]);
        change(value);
      }}>
        {Array.from({ length: max }, (_, offset) => <option key={offset} value={offset + 1}>{offset + 1} 格</option>)}
      </select></label>;
  };
  return <section aria-label="小组件属性" className="space-y-3 border-t bg-card p-4">
    <div className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground font-mono text-xs">{String(index + 1).padStart(2, '0')}</span><h4 className="mr-auto text-sm font-semibold">{widgetTitle(widget)}</h4>
      <button type="button" className={iconButton} title="前移" aria-label="前移" disabled={index === 0} onClick={() => move(-1)}><ArrowUp size={15} /></button>
      <button type="button" className={iconButton} title="后移" aria-label="后移" disabled={index === count - 1} onClick={() => move(1)}><ArrowDown size={15} /></button>
      <button type="button" className={`${iconButton} text-destructive`} title="删除组件" aria-label="删除组件" onClick={remove}><Trash2 size={15} /></button>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {selectSize('w', '宽度', MAX_WIDTH)}{selectSize('h', '高度', MAX_HEIGHT)}
      {Object.entries(spec.fields || {}).map(([key, field]) => {
        const change = (value) => update({ params: { ...widget.params, [key]: value } });
        return <label key={key} className="text-muted-foreground grid min-w-0 gap-1 text-xs">{field.label}
          {field.options ? <select className={inputCls} value={widget.params[key]} onChange={(event) => change(event.target.value)}>
            {Object.entries(field.options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select> : <input className={`${inputCls} min-w-0`} type={field.max ? 'number' : 'text'} min={field.min} max={field.max} step={field.max ? 1 : undefined} inputMode={field.max ? 'numeric' : undefined} maxLength={field.length} value={widget.params[key]} onChange={(event) => change(event.target.value)} onBlur={field.max ? () => change(gridNumber(widget.params[key], field.max)) : undefined} />}
        </label>;
      })}
    </div>
    {spec.fields?.limit && <p className="text-muted-foreground text-xs">显示数量独立控制实际条数（1～24），调整高度不会再改变它；内容增多时首页自动撑高，不会出现组件内滚动条。</p>}
  </section>;
}

export default function HomeWidgetEditor({ widgets, onChange }) {
  const columns = useGridColumns();
  const [selected, select] = useState(widgets[0]?.id);
  const [drag, setDrag] = useState(null);
  const [slot, setSlot] = useState(null);
  const grid = useRef(null);
  const drawer = useRef(null);
  const resize = useRef(null);
  const active = widgets.find((item) => item.id === selected);
  const full = widgets.length >= MAX_WIDGETS;
  const add = (type) => {
    if (full) return;
    const widget = createWidget(type, crypto.randomUUID());
    onChange([...widgets, widget]);
    select(widget.id);
    drawer.current?.close();
  };
  const update = (id, changes) => onChange(widgets.map((widget) => widget.id === id ? { ...widget, ...changes } : widget));
  const begin = (event, widget, isNew = false) => {
    event.dataTransfer.effectAllowed = isNew ? 'copy' : 'move';
    event.dataTransfer.setData('text/plain', widget.id);
    if (!isNew) select(widget.id);
    setDrag({ widget, isNew });
  };
  const end = () => { setDrag(null); setSlot(null); };
  const metrics = () => {
    const rect = grid.current.getBoundingClientRect();
    const style = getComputedStyle(grid.current);
    const gap = parseFloat(style.columnGap);
    return { rect, dx: (rect.width + gap) / columns, dy: parseFloat(style.gridAutoRows) + parseFloat(style.rowGap) };
  };
  const rest = drag ? widgets.filter((item) => item.id !== drag.widget.id) : widgets;
  const startResize = (event, widget) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    select(widget.id);
    resize.current = { ...metrics(), widget, x: event.pageX, y: event.pageY, pointer: event.pointerId };
  };
  const continueResize = (event) => {
    const start = resize.current;
    if (!start || start.pointer !== event.pointerId) return;
    update(start.widget.id, resizeWidget(start.widget, start.widget.w + (event.pageX - start.x) / start.dx, start.widget.h + (event.pageY - start.y) / start.dy));
  };
  const anchorCells = packWidgets(rest, columns);
  const locate = (event) => {
    const { rect, dx, dy } = metrics();
    const col = (event.clientX - rect.left) / dx;
    const row = (event.clientY - rect.top) / dy;
    const target = anchorCells.findIndex((cell) => row >= cell.row && row < cell.row + cell.h && col >= cell.col && col < cell.col + cell.w);
    if (target >= 0) return target + Number(row > anchorCells[target].row + anchorCells[target].h / 2);
    const next = anchorCells.findIndex((cell) => cell.row > row || (cell.row === Math.floor(row) && cell.col > col));
    return next < 0 ? rest.length : next;
  };
  const shown = drag && slot !== null ? insertWidget(widgets, drag.widget, slot) : widgets;
  const cells = packWidgets(shown, columns);
  const library = <LibraryList {...{ add, begin, end, full }} />;

  return <div className="overflow-hidden rounded-lg border bg-card">
    <div className="grid md:grid-cols-[9rem_minmax(0,1fr)] xl:grid-cols-[11rem_minmax(0,1fr)]">
      <aside className="hidden border-r px-3 py-4 md:block"><h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><SquareStack size={16} />模块库</h3>{library}</aside>
      <div className="min-w-0">
        <header className="flex items-center gap-2 border-b px-4 py-3"><LayoutGrid size={16} /><h3 className="text-sm font-semibold">首页画布</h3>
          <span className="text-muted-foreground ml-auto font-mono text-xs">{columns} 列 · {widgets.length} 件</span>
          <button type="button" onClick={() => drawer.current.showModal()} className="flex items-center gap-1 rounded border px-2 py-1 text-xs md:hidden"><Plus size={14} />模块库</button>
        </header>
        <dialog ref={drawer} aria-label="模块库" className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[75dvh] w-full max-w-none rounded-t-2xl border bg-card p-4 text-foreground backdrop:bg-foreground/30" onClick={(event) => { if (event.target === drawer.current && event.clientY < drawer.current.getBoundingClientRect().top) drawer.current.close(); }}>
          <header className="mb-4 flex items-center justify-between"><h3 className="font-semibold">模块库</h3><button type="button" className={iconButton} aria-label="关闭模块库" onClick={() => drawer.current.close()}><X size={16} /></button></header>{library}
        </dialog>
        <div className="home-editor-paper p-3 sm:p-4"
          onDragOver={(event) => { if (!drag) return; event.preventDefault(); event.dataTransfer.dropEffect = drag.isNew ? 'copy' : 'move'; setSlot(locate(event)); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSlot(null); }}
          onDrop={(event) => { if (!drag) return; event.preventDefault(); onChange(insertWidget(widgets, drag.widget, slot ?? locate(event))); select(drag.widget.id); end(); }}>
          <div ref={grid} aria-label="布局预览" className="grid content-start auto-rows-[2.75rem] gap-2" style={gridStyle(columns)}>
            {shown.map((widget, index) => {
              const Icon = icons[widget.type];
              const picked = active?.id === widget.id;
              const landing = drag?.widget.id === widget.id && slot !== null;
              return <div key={widget.id} data-widget={widget.type} data-landing={landing || undefined} style={cellStyle(cells[index])}
                className={`relative min-w-0 overflow-hidden rounded-lg border bg-card ${landing ? 'border-dashed border-primary bg-accent' : picked ? 'border-primary ring-1 ring-inset ring-primary' : 'hover:border-primary/50'}`}>
                <button type="button" draggable aria-label={`选择${widgetTitle(widget)}`} aria-pressed={picked} onDragStart={(event) => begin(event, widget)} onDragEnd={end} onClick={() => select(widget.id)}
                  className="flex size-full cursor-grab flex-col items-stretch gap-2 overflow-hidden p-2.5 text-left active:cursor-grabbing focus-visible:outline-offset-[-3px]">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold"><Icon size={15} className="shrink-0" /><span className="truncate">{widgetTitle(widget)}</span><Grip size={13} className="text-muted-foreground ml-auto shrink-0" /></span>
                  {widget.h > 1 && <span className="text-muted-foreground block text-xs"><Sketch widget={widget} /></span>}
                </button>
                <span aria-hidden="true" data-resize="" title="调整宽高" onPointerDown={(event) => startResize(event, widget)} onPointerMove={continueResize} onLostPointerCapture={() => { resize.current = null; }} className="absolute bottom-0 right-0 grid size-6 touch-none cursor-nwse-resize select-none place-items-center text-muted-foreground"><span className="pointer-events-none size-2 border-b-2 border-r-2" />
                </span>
              </div>;
            })}
            {!shown.length && <p className="text-muted-foreground col-span-full row-span-2 self-center text-center text-sm">画布为空，从模块库添加第一个组件。</p>}
          </div>
        </div>
        {active && <Inspector widget={active} index={widgets.indexOf(active)} count={widgets.length} update={(changes) => update(active.id, changes)} move={(step) => onChange(insertWidget(widgets, active, widgets.indexOf(active) + step))} remove={() => {
          const index = widgets.indexOf(active);
          onChange(widgets.filter((item) => item.id !== active.id)); select((widgets[index + 1] || widgets[index - 1])?.id);
        }} />}
      </div>
    </div>
  </div>;
}
