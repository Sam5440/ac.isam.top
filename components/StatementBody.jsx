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

import { useEffect, useMemo, useRef, useState } from 'react';

import { useAiSegment } from '@/components/ai-translate';
import { Spinner } from '@/components/ui/LoadingOverlay';
import { resolveTranslationCfg } from '@/lib/ai-providers';
import { channelLabel, useProblemLang, useSettings, DEFAULT_PRIORITY } from '@/components/settings';
import { hydrateSegments, useZhSegment } from '@/lib/zh-store';
import { extractImgSrcs, imgDedup } from '@/lib/img-dedup';
import { renderRich } from '@/lib/render';
import { translationChannels } from '@/lib/translation-plan.mjs';

/** 行内加载提示：签名与全局 SpinnerNote 不同（children + 行内 span，译文行内嵌），故保留本地形态、内部复用统一 Spinner。 */
function SpinnerNote({ children }) {
  return (
    <span className="text-muted-foreground/70 inline-flex items-center gap-1.5 text-[12px]">
      <Spinner className="size-3" />
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

const sourceChipHtml = (source, model) => {
  const official = source === 'ai:builtin' && model === '官方原文';
  const ai = (source === 'ai:builtin' || source === 'ai:external') && !official;
  const icon = official ? ICON_GLOBE : ai ? ICON_SPARKLES : ICON_GLOBE;
  const label = official
    ? '官方中文'
    : source === 'ai:builtin'
      ? 'AI (CI翻译)'
      : source === 'ai:external'
        ? 'AI 外置'
        : SOURCE_LABELS[source] || source;
  const tone = official
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
    : ai
      ? 'border-violet-500/40 bg-violet-500/10 text-violet-400'
      : 'border-border bg-muted text-muted-foreground';
  return `<span class="ml-1.5 inline-flex items-center gap-0.5 rounded border px-1 py-px align-middle text-[10px] leading-4 ${tone}">${icon}${label}</span>`;
};

function WithSourceChip({ html, source, model, className, seenSrcs }) {
  const chip = sourceChipHtml(source, model);
  const deduped = seenSrcs ? imgDedup(html, seenSrcs) : html;
  const withChip = /<\/p>\s*$/.test(deduped) ? deduped.replace(/<\/p>(\s*)$/, `${chip}</p>$1`) : deduped + chip;
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

function AiZhLine({ en, ai, note, aiReady, seenSrcs }) {
  const [ref, visible] = useNearViewport();
  const state = useAiSegment(en, ai, visible && !!(ai?.baseUrl && ai?.apiKey));
  return (
    <div ref={ref}>
      {state.status === 'loading' && <SpinnerNote>AI 翻译中…</SpinnerNote>}
      {state.status === 'error' && <UntranslatedMark note={`AI 翻译失败（${state.error}）`} />}
      {state.status === 'done' && <WithSourceChip html={renderRich(state.text)} source="ai:external" seenSrcs={seenSrcs} />}
      {state.status === 'idle' &&
        // 区分「未滚动到视口」与「确实未配置」:长题面里未达视口的段落不再
        // 全部挂着误导性的「请在设置中配置 AI 接口」告警
        (!aiReady ? (
          <UntranslatedMark note={note ? `${note}（AI 未配置）` : '请在设置中配置 AI 接口'} />
        ) : (
          <span className="text-muted-foreground/50 text-[11px]">{note ? `${note}（AI）` : '（AI）'}</span>
        ))}
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
function ChainZhLine({ segKey, archivedZh, priority, note, zhModel, seenSrcs }) {
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
        model={hitCh === 'ai' ? zhModel : undefined}
        seenSrcs={seenSrcs}
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
function ZhLine({ segKey, archivedZh, channel, note, zhModel, seenSrcs }) {
  const rec = useZhSegment(segKey);
  const archived = channel === 'ai' && typeof archivedZh === 'string' && archivedZh.trim() ? archivedZh : null;
  const local = typeof rec.zh[channel] === 'string' && rec.zh[channel].trim() ? rec.zh[channel] : null;
  const zh = archived || local;
  if (zh) {
    return (
      <WithSourceChip
        html={renderRich(zh)}
        source={channel === 'ai' ? 'ai:builtin' : channel}
        model={archived ? zhModel : undefined}
        seenSrcs={seenSrcs}
      />
    );
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
 * @param {string} [platform] 题目平台（牛客可设置默认不翻译）
 */
export default function StatementBody({ code, segments, title, titleZh, zhModel, platform }) {
  const { settings } = useSettings();
  const lang = useProblemLang(platform);
  const mode = lang.mode;
  const channel = lang.channel;
  const ai = channel === 'ai_custom' ? resolveTranslationCfg(settings) : null;
  const chain =
    mode === 'both'
      ? { priority: settings.zhPriority }
      : channel === 'ai'
        ? { priority: ['ai'] }
        : null;

  // 官方中文题面（牛客）：原文即译文，对照/中文模式只渲染单份，避免同文重复；
  // 但标题本身是英文时（牛客不少题标题为英文）仍走翻译链
  const sameLang = zhModel === '官方原文';
  const titleIsZh = /[\u4e00-\u9fff]/.test(String(title || ''));
  const zhSegments = useMemo(() => [
    { key: `${code}|title`, text: title, archived: Boolean(titleZh) },
    ...segments.map((s, i) => ({
      key: `${code}|p|${i}`,
      text: s.en,
      archived: Boolean(s.zh),
    })),
  ].map((segment) => ({
    ...segment,
    channels: translationChannels({ mode, channel, priority: settings.zhPriority, archived: segment.archived,
      official: sameLang && (segment.key !== `${code}|title` || titleIsZh) }),
  })), [code, segments, title, titleZh, mode, channel, settings.zhPriority, sameLang, titleIsZh]);

  useEffect(() => {
    if (mode !== 'en') hydrateSegments(code, zhSegments);
  }, [code, mode, zhSegments]);

  const segKeyOf = (i) => `${code}|p|${i}`;

  // 对照模式：EN 段一次性渲染并收集图片 src（渲染结果直接复用于展示，不二次
  // 渲染），三个 ZH 渲染出口据此剔除 EN 已出现的同 src 图片；zh 单独模式
  // 不做去重（本实现视其为无 EN 参照，与计划边界一致）。
  const enRender = useMemo(() => {
    const htmls = segments.map((s) => renderRich(s.en));
    return {
      htmls,
      enSrcs: mode === 'both' ? extractImgSrcs(htmls.join('')) : null,
    };
  }, [segments, mode]);

  const zhLineFor = (seg, i, note) => {
    const segKey = segKeyOf(i);
    if (channel === 'ai_custom') return <AiZhLine en={seg.en} ai={ai} note={note} aiReady={!!(ai?.baseUrl && ai?.apiKey)} seenSrcs={enRender.enSrcs} />;
    if (chain) return <ChainZhLine segKey={segKey} archivedZh={seg.zh} priority={chain.priority} note={note} zhModel={zhModel} seenSrcs={enRender.enSrcs} />;
    return <ZhLine segKey={segKey} archivedZh={seg.zh} channel={channel} note={note} zhModel={zhModel} seenSrcs={enRender.enSrcs} />;
  };

  const titleLine =
    mode !== 'en' ? (
      sameLang && titleIsZh ? (
        <WithSourceChip html={renderRich(title)} source="ai:builtin" model="官方原文" />
      ) : channel === 'ai_custom' ? (
        <AiZhLine en={title} ai={ai} note="标题" aiReady={!!(ai?.baseUrl && ai?.apiKey)} />
      ) : chain ? (
        // chain 仅在对照模式或 AI 渠道时非空；纯中文 + MT 渠道走单渠道 ZhLine
        <ChainZhLine segKey={`${code}|title`} archivedZh={titleZh || null} priority={chain.priority} note="标题" zhModel={zhModel} />
      ) : (
        <ZhLine segKey={`${code}|title`} archivedZh={titleZh || null} channel={channel} note="标题" zhModel={zhModel} />
      )
    ) : null;

  // 官方中文：任何非英文模式都渲染单份原文（带「官方中文」来源芯片）
  if (mode !== 'en' && sameLang) {
    return (
      <>
        {titleLine}
        <div className="stmt-body">
          {segments.map((s, i) => (
            <div key={i} className="md-body">
              <WithSourceChip html={renderRich(s.en)} source="ai:builtin" model="官方原文" />
            </div>
          ))}
        </div>
      </>
    );
  }

  // 中文模式 + AI (CI翻译) 渠道：存档只有整篇级时（配对彻底失败的单段情况
  // 已由 pairSegments 兜底），渲染存档段即可 —— 与分段渲染同一路径。

  return (
    <>
      {titleLine && <div className="text-base font-medium tracking-tight text-foreground/90">{titleLine}</div>}

      {mode === 'en' ? (
        <div className="md-body stmt-body">
          {segments.map((s, i) => (
            <div key={i} dangerouslySetInnerHTML={{ __html: enRender.htmls[i] }} />
          ))}
        </div>
      ) : (
        <div className="stmt-body">
          {segments.map((s, i) => (
            <div key={i}>
              <div className="md-body" dangerouslySetInnerHTML={{ __html: enRender.htmls[i] }} />
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
