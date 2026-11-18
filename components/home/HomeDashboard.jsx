'use client';

import Link from 'next/link';
import { createElement, useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, PencilLine } from 'lucide-react';

import { useSettings } from '@/components/settings';
import { DEFAULT_HOME_LAYOUT } from '@/lib/home-presets.mjs';
import { parseHomeLayout } from '@/lib/home-layout.mjs';
import { packWidgets, widgetTitle } from '@/lib/home-grid.mjs';
import { cellStyle, gridStyle, useGridColumns } from './widget-grid';
import {
  HomeCfRating, HomeClock, HomeContests, HomeFiles, HomeHero, HomeHistory,
  HomeHistoryContests, HomeProblems, HomeSection, HomeSiteUpdate, HomeStats, HomeWeather,
} from './HomeWidgets';

function DomNode({ node, data, now }) {
  const attrs = { ...node.attrs };
  const children = <LayoutNodes nodes={node.children} data={data} now={now} />;
  if (node.tag === 'a' && attrs.href) {
    const props = { ...attrs, className: attrs.class };
    delete props.class;
    return attrs.href.startsWith('/') ? <Link {...props}>{children}</Link> : <a {...props}>{children}</a>;
  }
  const props = { ...attrs, className: attrs.class };
  delete props.class;
  if (['br', 'hr', 'img'].includes(node.tag)) return createElement(node.tag, props);
  return createElement(node.tag, props, children);
}

function WidgetNode({ node, data, now }) {
  const { attrs } = node;
  const children = <LayoutNodes nodes={node.children} data={data} now={now} />;
  switch (node.tag) {
    case 'ac-hero': return <HomeHero attrs={attrs} />;
    case 'ac-stats': return <HomeStats attrs={attrs} data={data} />;
    case 'ac-contests': return <HomeContests attrs={attrs} data={data} now={now} />;
    case 'ac-problems': return <HomeProblems attrs={attrs} data={data} />;
    case 'ac-history': return <HomeHistory attrs={attrs} />;
    case 'ac-history-contests': return <HomeHistoryContests attrs={attrs} />;
    case 'ac-files': return <HomeFiles attrs={attrs} />;
    case 'ac-cf-rating': return <HomeCfRating attrs={attrs} />;
    case 'ac-weather': return <HomeWeather attrs={attrs} />;
    case 'ac-clock': return <HomeClock attrs={attrs} />;
    case 'ac-site-update': return <HomeSiteUpdate attrs={attrs} data={data} />;
    case 'ac-section': return <HomeSection attrs={attrs}>{children}</HomeSection>;
    default: return <div className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs text-amber-500">未知首页组件：{node.tag}</div>;
  }
}

function LayoutNodes({ nodes, data, now }) {
  return nodes.map((node, index) => {
    if (node.type === 'text') return node.value;
    if (node.tag.startsWith('ac-')) return <WidgetNode key={`${node.tag}-${index}`} node={node} data={data} now={now} />;
    return <DomNode key={`${node.tag}-${index}`} node={node} data={data} now={now} />;
  });
}

export default function HomeDashboard({ data }) {
  const { settings } = useSettings();
  const initialNow = new Date(data.renderedAt).getTime() || 0;
  const [now, setNow] = useState(initialNow);
  const layout = settings.homeLayout ?? DEFAULT_HOME_LAYOUT;
  const visual = settings.homeLayoutMode === 'visual';
  const nodes = useMemo(() => visual ? [] : parseHomeLayout(layout), [visual, layout]);
  const columns = useGridColumns();
  const widgets = settings.homeWidgets;
  const cells = useMemo(() => visual ? packWidgets(widgets, columns) : [], [visual, widgets, columns]);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="pb-12">
      <div className="flex justify-end pt-4">
        <Link href="/settings#home" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs transition-colors">
          <PencilLine className="size-3.5" />自定义首页
        </Link>
      </div>
      {visual && widgets.length ? (
        <div aria-label="首页小组件" className="mt-4 grid auto-rows-[6rem] gap-3" style={gridStyle(columns)}>
          {widgets.map((widget, index) => {
            const content = <WidgetNode node={{ tag: `ac-${widget.type}`, attrs: widget.params, children: [] }} data={data} now={now} />;
            const href = { contests: '/contests', problems: '/problems', history: '/history', files: '/ide', 'history-contests': '/history' }[widget.type];
            return <div key={widget.id} data-widget={widget.type} className="home-grid-cell min-w-0 overflow-auto" style={cellStyle(cells[index])}>
              {href ? <HomeSection attrs={{ title: widgetTitle(widget), href }}>{content}</HomeSection> : content}
            </div>;
          })}
        </div>
      ) : nodes.length ? <LayoutNodes nodes={nodes} data={data} now={now} /> : (
        <div className="py-20 text-center">
          <LayoutDashboard className="text-muted-foreground mx-auto size-10" />
          <h1 className="mt-4 text-2xl font-semibold">这个首页还是空白</h1>
          <p className="text-muted-foreground mt-2 text-sm">添加小组件，或在高级 HTML 模式中选择预设。</p>
          <Link href="/settings#home" className="text-primary mt-4 inline-block text-sm underline underline-offset-4">开始布局</Link>
        </div>
      )}
    </div>
  );
}
