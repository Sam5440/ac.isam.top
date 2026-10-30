'use client';

/**
 * 分段对照题面（参考 ys_problem_web/components/StatementBody.jsx 移植）。
 *
 * 服务端经 lib/statement-segments.js 把 statementMd / statementZhMd 切成
 * 一一对应的段落数组传入。CI 存档译文作为 'ai' 渠道；存档未覆盖的
 * （段落, 渠道）对由本机实时补齐：lib/zh-store.js 轮转调度四家机器翻译
 * （IndexedDB 持久化），AI（用户自定义翻译）走访问者自己的 OpenAI 兼容
 * 接口。语言模式（对照/英文/中文）与优先级链来自设置。
 */

import { useEffect, useRef, useState } from 'react';

import { useAiSegment } from '@/components/ai-translate';
import { channelLabel, useSettings, DEFAULT_PRIORITY } from '@/components/settings';
import { hydrateSegments, useZhSegment } from '@/lib/zh-store';
import { renderRich } from '@/lib/render';

function SpinnerNote({ children }) {
  return (
    <span className="text-muted-foreground/70 inline-flex items-center gap-1.5 text-[12px]">
      <span className="border-current border-t-transparent inline-block size-3 animate-spin rounded-full border-2" />
      {children}
    </span>
  );
}

function UntranslatedMark({ note }) {
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-500">
      <span aria-hidden>⚠</span> {note || '本段暂无翻译'}
    </span>
  );
}

/* ---------------- end-of-line source chips ---------------- */

const ICON_GLOBE =
  '<svg class="inline-block size-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
const ICON_SPARKLES =
  '<svg class="inline-block size-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden><path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/></svg>';

const SOURCE_LABELS = { deepl: 'DeepL', youdao: '有道', caiyun: '彩云', iflyrec: '讯飞' };

const sourceChipHtml = (source) => {
  const ai = source === 'ai:builtin' || source === 'ai:external';
  const icon = ai ? ICON_SPARKLES : ICON_GLOBE;
  const label =
    source === 'ai:builtin'
      ? 'AI (CI翻译)'
      : source === 'ai:external'
        ? 'AI 外置'
        : SOURCE_LABELS[source] || source;
  const tone = ai
    ? 'border-violet-500/40 bg-violet-500/10 text-violet-400'
    : 'border-border bg-muted text-muted-foreground';
  return `<span class="ml-1.5 inline-flex items-center gap-0.5 rounded border px-1 py-px align-middle text-[10px] leading-4 ${tone}">${icon}${label}</span>`;
};

function WithSourceChip({ html, source, className }) {
  const chip = sourceChipHtml(source);
  const withChip = /<\/p>\s*$/.test(html) ? html.replace(/<\/p>(\s*)$/, `${chip}</p>$1`) : html + chip;
  return <div className={`zh-styled ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: withChip }} />;
}

/** Fires once the wrapped element scrolls near the viewport. */
function useNearViewport() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, visible];
}

function AiZhLine({ en, ai, note }) {
  const [ref, visible] = useNearViewport();
  const state = useAiSegment(en, ai, visible && !!(ai?.baseUrl && ai?.apiKey));
  return (
    <div ref={ref}>
      {state.status === 'loading' && <SpinnerNote>AI 翻译中…</SpinnerNote>}
      {state.status === 'error' && <UntranslatedMark note={`AI 翻译失败（${state.error}）`} />}
      {state.status === 'done' && <WithSourceChip html={renderRich(state.text)} source="ai:external" />}
      {state.status === 'idle' && <UntranslatedMark note={note ? `${note}（AI）` : '请在设置中配置 AI 接口'} />}
    </div>
  );
}

/** 存档（CI 'ai' 渠道）+ 本机实时渠道合并；存档优先平局。 */
function mergedChannels(archivedZh, rec) {
  const merged = {};
  if (rec) {
    for (const [ch, t] of Object.entries(rec.zh)) {
      if (typeof t === 'string' && t.trim()) merged[ch] = t;
    }
  }
  if (typeof archivedZh === 'string' && archivedZh.trim()) merged.ai = archivedZh;
  return merged;
}

/** 对照模式的一段译文：沿优先级链取首个有译文的渠道。 */
function ChainZhLine({ segKey, archivedZh, priority, note }) {
  const rec = useZhSegment(segKey);
  const prio = priority?.length ? priority : DEFAULT_PRIORITY;
  const merged = mergedChannels(archivedZh, rec);
  const hitIdx = prio.findIndex((ch) => typeof merged[ch] === 'string' && merged[ch].trim());
  if (hitIdx >= 0) {
    const hitCh = prio[hitIdx];
    return (
      <WithSourceChip
        html={renderRich(merged[hitCh])}
        source={hitCh === 'ai' ? 'ai:builtin' : hitCh}
      />
    );
  }
  const waiting = prio.some((ch) => ch !== 'ai' && rec.status[ch] !== 'failed');
  return (
    <div>
      {waiting ? (
        <SpinnerNote>翻译中…</SpinnerNote>
      ) : (
        <UntranslatedMark note={note ? `${note}（暂无译文）` : undefined} />
      )}
    </div>
  );
}

/** 指定渠道的一段译文。 */
function ZhLine({ segKey, archivedZh, channel, note }) {
  const rec = useZhSegment(segKey);
  const archived = channel === 'ai' && typeof archivedZh === 'string' && archivedZh.trim() ? archivedZh : null;
  const local = typeof rec.zh[channel] === 'string' && rec.zh[channel].trim() ? rec.zh[channel] : null;
  const zh = archived || local;
  if (zh) {
    return <WithSourceChip html={renderRich(zh)} source={channel === 'ai' ? 'ai:builtin' : channel} />;
  }
  if (rec.status[channel] === 'failed') {
    return <UntranslatedMark note={note ? `${note}（${channelLabel(channel)}）` : undefined} />;
  }
  return <SpinnerNote>翻译中…</SpinnerNote>;
}

/**
 * 完整分段题面。
 * @param {string} code 题目 id（segment key 前缀）
 * @param {Array<{en: string, zh: string|null}>} segments 服务端配对好的段落
 * @param {string} title 原文题名
 * @param {string|null} titleZh CI 存档题名
 */
export default function StatementBody({ code, segments, title, titleZh }) {
  const { lang, settings } = useSettings();
  const mode = lang.mode;
  const channel = lang.channel;
  const ai = channel === 'ai_custom' ? settings.ai : null;
  const chain =
    mode === 'both'
      ? { priority: settings.zhPriority }
      : channel === 'ai'
        ? { priority: ['ai'] }
        : null;

  const hasArchive = segments.some((s) => s.zh);
  const zhSegments = segments.map((s, i) => ({
    key: `${code}|p|${i}`,
    text: s.en,
    archived: Boolean(s.zh),
  }));

  useEffect(() => {
    if (mode !== 'en') hydrateSegments(code, zhSegments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, mode, hasArchive]);

  const segKeyOf = (i) => `${code}|p|${i}`;

  const zhLineFor = (seg, i, note) => {
    const segKey = segKeyOf(i);
    if (channel === 'ai_custom') return <AiZhLine en={seg.en} ai={ai} note={note} />;
    if (chain) return <ChainZhLine segKey={segKey} archivedZh={seg.zh} priority={chain.priority} note={note} />;
    return <ZhLine segKey={segKey} archivedZh={seg.zh} channel={channel} note={note} />;
  };

  const titleLine =
    mode !== 'en' ? (
      channel === 'ai_custom' ? (
        <AiZhLine en={title} ai={ai} note="标题" />
      ) : (
        <ChainZhLine segKey={`${code}|title`} archivedZh={titleZh || null} priority={chain.priority} note="标题" />
      )
    ) : null;

  // 中文模式 + AI (CI翻译) 渠道：存档只有整篇级时（配对彻底失败的单段情况
  // 已由 pairSegments 兜底），渲染存档段即可 —— 与分段渲染同一路径。

  return (
    <>
      {titleLine && <div className="text-base font-medium tracking-tight text-foreground/90">{titleLine}</div>}

      {mode === 'en' ? (
        <div className="md-body stmt-body">
          {segments.map((s, i) => (
            <div key={i} dangerouslySetInnerHTML={{ __html: renderRich(s.en) }} />
          ))}
        </div>
      ) : (
        <div className="stmt-body">
          {segments.map((s, i) => (
            <div key={i}>
              <div className="md-body" dangerouslySetInnerHTML={{ __html: renderRich(s.en) }} />
              <div className="stmt-zh mt-1 border-l-2 border-primary/40 pl-3 text-[13px] text-muted-foreground">
                {zhLineFor(s, i)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
