'use client';

/**
 * 设置页「翻译」分区：默认语言与「每次打开重置默认」开关、默认翻译渠道
 * （CI 翻译）、对照优先级、侧栏渠道、译文样式、AI 自定义翻译接口、
 * 渠道体检（50 次真实翻译成功率排行 + 一键按成功率重排优先级链）。
 */

import { useEffect, useRef, useState } from 'react';
import { Activity, Languages, RotateCcw } from 'lucide-react';

import {
  ARCHIVED_CHANNELS,
  channelLabel,
  CHANNELS,
  DEFAULT_PRIORITY,
  DEFAULT_ZH_STYLE,
  useSettings,
} from '@/components/settings';
import { resolveTranslationCfg } from '@/lib/ai-providers';
import { clearMtStats, HEALTH_SAMPLE, loadMtStats, rankedStats, runHealthCheck } from '@/lib/mt-health';
import { ChipToggle, inputCls, SegButtons, SectionCard, SubBlock, ToggleRow } from './controls';

const MT_CHANNELS = ARCHIVED_CHANNELS; // deepl / youdao / caiyun / iflyrec
const TEST_COUNT = 50;

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

export default function TranslationSection() {
  const { settings, setSettings, lang, setLang, aiReady } = useSettings();

  // ---- 渠道体检 ----
  const [healthChannels, setHealthChannels] = useState(MT_CHANNELS);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({}); // { [ch]: { done, success } }
  const [stats, setStats] = useState({});
  const abortRef = useRef(null);

  useEffect(() => {
    setStats(loadMtStats());
    return () => abortRef.current?.abort();
  }, []);

  // 渠道体检使用全局服务商解析出的翻译接口配置（改配置即时生效，无「保存」步骤）
  const aiForm = resolveTranslationCfg(settings);

  // 切换默认题面语言：立即作用于当前浏览，同时存为默认
  const pickLangMode = (mode) => {
    setLang((prev) => ({ mode, channel: prev.channel }));
    setSettings({ defaultLangMode: mode });
  };

  // 默认翻译渠道：立即应用到当前浏览
  const pickDefaultChannel = (id) => {
    setSettings({ defaultZhChannel: id });
    setLang((prev) => ({ ...prev, channel: id }));
  };

  const toggleChannel = (id) => {
    const has = settings.sidebarChannels.includes(id);
    const next = has
      ? settings.sidebarChannels.filter((c) => c !== id)
      : [...CHANNELS.map((c) => c.id).filter((c) => settings.sidebarChannels.includes(c) || c === id)];
    setSettings({ sidebarChannels: next });
  };

  const movePriority = (i, d) => {
    const next = [...(settings.zhPriority || [])];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSettings({ zhPriority: next });
  };

  const zhStyle = settings.zhStyle || DEFAULT_ZH_STYLE;
  const patchZhStyle = (p) =>
    setSettings((prev) => ({ ...prev, zhStyle: { ...(prev.zhStyle || DEFAULT_ZH_STYLE), ...p } }));
  const resetZhStyle = () => setSettings({ zhStyle: { ...DEFAULT_ZH_STYLE } });
  const zhStyleCustomized =
    zhStyle.color || zhStyle.fontSize !== '' || zhStyle.bold || zhStyle.italic || zhStyle.underline;

  const toggleHealthChannel = (id) => {
    if (running) return;
    setHealthChannels((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const startHealth = async () => {
    if (running || !healthChannels.length) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setProgress({});
    try {
      await runHealthCheck({
        channels: healthChannels,
        // 与「测试连接」同源（AI-8）：体检也用当前表单值,旧实现用已保存的
        // settings.ai —— 改了 Key 未保存就体检会拿旧 Key 全军覆没,统计被
        // 0% 覆盖
        cfg: aiForm,
        count: TEST_COUNT,
        gapMs: 800,
        signal: ctrl.signal,
        onProgress: ({ channel, done, success }) =>
          setProgress((p) => ({ ...p, [channel]: { done, success } })),
      });
    } finally {
      setRunning(false);
      setStats(loadMtStats());
    }
  };

  const stopHealth = () => {
    abortRef.current?.abort();
    setRunning(false);
    setStats(loadMtStats());
  };

  // 按成功率重排优先级链：CI 翻译（'ai'，仓库存档、不参与体检）固定链首，
  // 其余测过的按成功率降序在前，没测过的保持原相对顺序殿后
  const applyRanking = () => {
    const prio = settings.zhPriority || [];
    const ranked = rankedStats(stats)
      .map((r) => r.channel)
      .filter((id) => prio.includes(id));
    const rest = prio.filter((id) => !ranked.includes(id));
    const tail = rest.filter((id) => id !== 'ai');
    const ai = rest.includes('ai') ? ['ai'] : [];
    if (ranked.length) setSettings({ zhPriority: [...ai, ...ranked, ...tail] });
  };

  const ranking = rankedStats(stats);
  const hasProgress = Object.keys(progress).length > 0;

  return (
    <SectionCard
      id="translation"
      icon={Languages}
      title="翻译"
      desc="题面语言与译文来源：默认行为、渠道优先级、外观样式与质量体检。"
    >
      <ToggleRow
        label="每次打开网页时重置为默认翻译"
        hint="开启后，刷新 / 重新打开网页时题面语言与翻译渠道都会重置为下方的默认值（默认语言 + 默认渠道）；关闭则保留上次使用的选择。"
        checked={settings.resetLangOnLoad !== false}
        onChange={(v) => setSettings({ resetLangOnLoad: v })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">默认题面语言</p>
          <SegButtons
            ariaLabel="默认题面语言"
            options={[
              { id: 'both', label: '对照' },
              { id: 'en', label: '英文' },
              { id: 'zh', label: '中文' },
            ]}
            value={settings.defaultLangMode}
            onChange={pickLangMode}
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">默认翻译渠道（默认 AI · CI 翻译）</p>
          <select
            className={inputCls}
            value={settings.defaultZhChannel || 'ai'}
            onChange={(e) => pickDefaultChannel(e.target.value)}
          >
            {CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SubBlock
        title="对照翻译优先级"
        hint="每段取首个已有译文的渠道，段落结尾标注来源；缺失的译文由本机向各渠道实时请求（约每 3 秒一条），结果保存在本机浏览器。AI (CI翻译) = CI 任务自动翻译的存档。想让全站优先显示某个渠道的译文，把它排到第一位即可。"
      >
        <ul className="space-y-1">
          {(settings.zhPriority || []).map((id, i) => (
            <li key={id} className="flex items-center justify-between rounded-md border px-2.5 py-1 text-xs">
              <span>
                <span className="text-muted-foreground mr-2 inline-block w-3">{i + 1}</span>
                {channelLabel(id)}
              </span>
              <span className="flex gap-0.5">
                <button
                  type="button"
                  onClick={() => movePriority(i, -1)}
                  disabled={i === 0}
                  aria-label={`${channelLabel(id)} 上移`}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground rounded px-1.5 py-0.5 transition-colors disabled:opacity-25"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => movePriority(i, 1)}
                  disabled={i === settings.zhPriority.length - 1}
                  aria-label={`${channelLabel(id)} 下移`}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground rounded px-1.5 py-0.5 transition-colors disabled:opacity-25"
                >
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ul>
      </SubBlock>

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs font-medium">左下角「译」字浮标中显示的翻译渠道</p>
        <div className="flex flex-wrap gap-1.5">
          {CHANNELS.map((c) => (
            <ChipToggle key={c.id} on={settings.sidebarChannels.includes(c.id)} onClick={() => toggleChannel(c.id)}>
              {c.label}
            </ChipToggle>
          ))}
        </div>
      </div>

      <SubBlock
        title="译文样式"
        hint="题面中文译文的外观；来源芯片、行内代码与公式不受影响。"
        right={
          zhStyleCustomized && (
            <button
              type="button"
              onClick={resetZhStyle}
              className="text-muted-foreground hover:text-foreground shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition-colors"
            >
              <RotateCcw className="mr-0.5 inline size-3" />
              恢复默认
            </button>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
            字号
            <input
              type="number"
              min={8}
              max={40}
              value={zhStyle.fontSize}
              placeholder="默认"
              onChange={(e) => patchZhStyle({ fontSize: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) })}
              className="bg-background w-16 rounded-md border px-2 py-1 text-sm outline-none focus:border-primary/60"
            />
            <span>px</span>
          </label>
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
            颜色
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(zhStyle.color) ? zhStyle.color : '#8b8b9e'}
              onChange={(e) => patchZhStyle({ color: e.target.value })}
              aria-label="译文颜色"
              className="bg-background size-7 cursor-pointer rounded-md border p-0.5"
            />
          </label>
          <div className="ml-auto flex items-center gap-1">
            {[
              { key: 'bold', label: 'B', cls: 'font-bold', name: '加粗' },
              { key: 'italic', label: 'I', cls: 'italic', name: '斜体' },
              { key: 'underline', label: 'U', cls: 'underline', name: '下划线' },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={!!zhStyle[t.key]}
                aria-label={`译文${t.name}`}
                title={`译文${t.name}`}
                onClick={() => patchZhStyle({ [t.key]: !zhStyle[t.key] })}
                className={`inline-flex size-7 items-center justify-center rounded-md border text-xs transition-colors ${t.cls} ${
                  zhStyle[t.key]
                    ? 'border-primary/60 bg-primary/10 text-foreground ring-1 ring-primary/50'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-background rounded-md border px-2.5 py-2">
          <p className="zh-styled text-[13px] leading-6">
            预览：给定一个整数 n，输出 2n 的值。每次修改立即生效并保存在本机。
          </p>
        </div>
      </SubBlock>

      <SubBlock
        title="AI（用户自定义翻译）· 接口来源"
        hint="接口地址与 API Key 已收敛到「AI 服务商」分区统一配置，此处仅展示当前挑选结果；模型可在「AI 服务商 → 功能模块挑选」中覆盖。"
      >
        <p className={`rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed ${aiReady ? 'text-emerald-500 border-emerald-500/30' : 'text-amber-500 border-amber-500/40'}`}>
          {aiReady
            ? `当前翻译接口：${aiForm.baseUrl || '（未挑选）'} · 模型 ${aiForm.model}`
            : '尚未配置：请到「AI 服务商」分区添加服务商（Base URL + API Key）。'}
        </p>
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          前往「AI 服务商」分区可切换服务商或覆盖翻译模型（本分区不再重复提供接口表单）。
        </p>
      </SubBlock>

      <SubBlock
        title="渠道体检 · 50 次真实翻译成功率排行"
        hint={`对每个勾选的渠道连发 ${TEST_COUNT} 次真实翻译请求（固定样本题面，含公式与行内代码），按成功率排行；测完可一键把对照优先级链重排为成功率顺序。AI (CI翻译) 为仓库存档、无实时接口，不参与测试。`}
        right={
          <div className="flex shrink-0 items-center gap-1.5">
            {ranking.length > 0 && (
              <button
                type="button"
                onClick={applyRanking}
                className="text-muted-foreground hover:text-foreground rounded-md border px-2 py-0.5 text-[11px] transition-colors"
              >
                按成功率重排优先级
              </button>
            )}
            {running ? (
              <button
                type="button"
                onClick={stopHealth}
                className="rounded-md border border-red-500/50 px-2.5 py-0.5 text-[11px] text-red-400 transition-colors hover:bg-red-500/10"
              >
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={startHealth}
                disabled={!healthChannels.length}
                className="bg-primary text-primary-foreground rounded-md px-2.5 py-0.5 text-[11px] font-medium disabled:opacity-40"
              >
                开始测试
              </button>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {MT_CHANNELS.map((id) => (
            <ChipToggle
              key={id}
              on={healthChannels.includes(id)}
              onClick={() => toggleHealthChannel(id)}
              title={running ? '测试进行中，先停止再调整' : undefined}
            >
              {channelLabel(id)}
            </ChipToggle>
          ))}
          <ChipToggle
            on={healthChannels.includes('ai_custom')}
            onClick={() => toggleHealthChannel('ai_custom')}
            title={aiReady ? undefined : '先在上方配置 AI 接口'}
          >
            {channelLabel('ai_custom')}
            {!aiReady && <span className="ml-1 text-[9px] text-amber-500">未配置</span>}
          </ChipToggle>
        </div>

        {hasProgress && (
          <ul className="space-y-1.5">
            {Object.entries(progress).map(([ch, p]) => (
              <li key={ch} className="flex items-center gap-2 text-xs">
                <span className="w-36 shrink-0 truncate">{channelLabel(ch)}</span>
                <span className="bg-muted h-1.5 min-w-16 flex-1 overflow-hidden rounded-full">
                  <span
                    className="bg-primary block h-full rounded-full transition-all"
                    style={{ width: `${((p.done || 0) / TEST_COUNT) * 100}%` }}
                  />
                </span>
                <span className="text-muted-foreground w-32 shrink-0 text-right tabular-nums">
                  {p.done}/{TEST_COUNT} · 成功 {p.success}
                </span>
              </li>
            ))}
          </ul>
        )}

        {ranking.length > 0 && (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-medium">#</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">渠道</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">成功率</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">成功 / 总数</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">平均耗时</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">测试时间</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => (
                  <tr key={r.channel} className="border-t">
                    <td className="px-2.5 py-1.5 tabular-nums">{i + 1}</td>
                    <td className="px-2.5 py-1.5">{channelLabel(r.channel)}</td>
                    <td
                      className={`px-2.5 py-1.5 text-right font-medium tabular-nums ${
                        r.rate >= 0.9 ? 'text-emerald-500' : r.rate >= 0.6 ? '' : 'text-red-400'
                      }`}
                    >
                      {(r.rate * 100).toFixed(0)}%
                    </td>
                    <td className="text-muted-foreground px-2.5 py-1.5 text-right tabular-nums">
                      {r.success} / {r.attempted}
                    </td>
                    <td className="text-muted-foreground px-2.5 py-1.5 text-right tabular-nums">
                      {r.avgMs != null ? `${(r.avgMs / 1000).toFixed(2)}s` : '—'}
                    </td>
                    <td className="text-muted-foreground px-2.5 py-1.5 text-right">{fmtDate(r.testedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground/70 text-[11px] leading-relaxed">
            <Activity className="mr-0.5 inline size-3" />
            测试会真实请求上游接口（样本：{HEALTH_SAMPLE.slice(0, 24)}…）；结果保存在本机浏览器。
          </p>
          {Object.keys(stats).length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearMtStats();
                setStats({});
              }}
              className="text-muted-foreground hover:text-foreground shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition-colors"
            >
              清空统计
            </button>
          )}
        </div>
      </SubBlock>
    </SectionCard>
  );
}
