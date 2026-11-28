'use client';

/**
 * 设置页「题面与翻译」分区（v1.8 重排）：
 *  - 基础：默认题面语言 / 默认翻译渠道 / 每次打开重置 / 牛客题目默认翻译
 *  - 题目页：比赛题目切换条、题号竖条；首页「最新比赛」类型
 *  - 译文外观：字号 / 颜色 / 加粗斜体下划线
 *  - 高级（折叠）：对照优先级链、「译」浮标渠道、AI 自定义翻译接口、渠道体检
 */

import { useEffect, useRef, useState } from 'react';
import { Activity, RotateCcw } from 'lucide-react';

import {
  ARCHIVED_CHANNELS,
  channelLabel,
  CHANNELS,
  DEFAULT_PRIORITY,
  useSettings,
} from '@/components/settings';
import {
  DEFAULT_ZH_STYLE,
  isTranslationStyleCustomized,
  normalizeTranslationStyle,
  TRANSLATION_FONTS,
  TRANSLATION_PRESETS,
  translationAppearance,
} from '@/lib/translation-style.mjs';
import { resolveTranslationCfg } from '@/lib/ai-providers';
import { toast } from '@/lib/toast';
import { clearMtStats, HEALTH_SAMPLE, loadMtStats, rankedStats, runHealthCheck } from '@/lib/mt-health';
import ModuleAssignPicker from './ModuleAssignPicker';
import { CONTEST_TYPES } from '@/lib/contest-type';
import { Advanced, ChipToggle, Group, inputCls, Pad, Row, SegButtons, SmallButton, SubBlock, SwitchRow } from './controls';

const MT_CHANNELS = ARCHIVED_CHANNELS; // deepl / youdao / caiyun / iflyrec
const TEST_COUNT = 50;

const PLATFORM_LABEL = { atcoder: 'AtCoder', codeforces: 'Codeforces', nowcoder: '牛客' };

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
  const patchZhStyle = (patch) =>
    setSettings((prev) => {
      const next = normalizeTranslationStyle({ ...(prev.zhStyle || DEFAULT_ZH_STYLE), ...patch });
      if (Object.hasOwn(patch, 'color')) next.colorMode = patch.color ? 'custom' : 'theme';
      return { ...prev, zhStyle: next };
    });
  const resetZhStyle = () => setSettings({ zhStyle: { ...DEFAULT_ZH_STYLE } });
  const zhStyleCustomized = isTranslationStyleCustomized(zhStyle);

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
    toast.info(`开始渠道体检（${healthChannels.length} 个渠道 × ${TEST_COUNT} 次）…`);
    let aborted = false;
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
      if (ctrl.signal.aborted) aborted = true;
    } catch (e) {
      toast.error(`渠道体检出错：${e?.message || e}`);
    } finally {
      setRunning(false);
      setStats(loadMtStats());
      if (!aborted) toast.success('渠道体检完成，结果已保存');
      else toast.info('已停止渠道体检');
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

  const homeTypes = settings.homeContestTypes || [];
  const toggleHomeType = (id) =>
    setSettings({
      homeContestTypes: homeTypes.includes(id) ? homeTypes.filter((t) => t !== id) : [...homeTypes, id],
    });

  return (
    <div className="space-y-6">
      <Group title="默认显示">
        <Row label="默认题面语言" hint="首次打开题目时的显示方式；左下角「译」浮标可随时临时切换。">
          <SegButtons
            ariaLabel="默认题面语言"
            options={[
              { id: 'both', label: '中英对照' },
              { id: 'en', label: '原文' },
              { id: 'zh', label: '仅中文' },
            ]}
            value={settings.defaultLangMode}
            onChange={pickLangMode}
          />
        </Row>
        <Row label="默认翻译渠道" hint="「仅中文」模式使用的译文来源；AI (CI翻译) 为仓库预先翻译好的存档，最快最稳。">
          <select
            className={`${inputCls} w-auto`}
            aria-label="默认翻译渠道"
            value={settings.defaultZhChannel || 'ai'}
            onChange={(e) => pickDefaultChannel(e.target.value)}
          >
            {CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Row>
        <SwitchRow
          label="牛客题目默认开启翻译"
          hint="牛客题目绝大多数是官方中文题面。关闭后打开牛客题目默认只显示原文，不再请求翻译；仍可用「译」浮标对单题临时开启。"
          checked={settings.nowcoderTranslate !== false}
          onChange={(v) => setSettings({ nowcoderTranslate: v })}
        />
        <SwitchRow
          label="每次打开网页时恢复默认"
          hint="开启：刷新或重新打开网页时，题面语言与翻译渠道都回到上面的默认值。关闭：保留上次的选择。"
          checked={settings.resetLangOnLoad !== false}
          onChange={(v) => setSettings({ resetLangOnLoad: v })}
        />
      </Group>

      <Group title="题目页与首页">
        <SwitchRow
          label="比赛题目切换条"
          hint="题目卡上方显示本场比赛全部题目，一键跳转（比赛含 2 题及以上时）。"
          checked={settings.topSwitcher !== false}
          onChange={(v) => setSettings({ topSwitcher: v })}
        />
        <SwitchRow
          label="左侧题号竖条"
          hint="视口左侧中部悬浮的题号快捷条，只显示题号字母。"
          checked={settings.letterRail !== false}
          onChange={(v) => setSettings({ letterRail: v })}
        />
        <Row stack label="首页「最新比赛」显示的类型" hint="未勾选的类型不会出现在首页卡片里（比赛列表页不受影响）。">
          <div className="space-y-2">
            {['atcoder', 'codeforces', 'nowcoder'].map((pf) => (
              <div key={pf} className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground w-20 shrink-0 text-[11px]">{PLATFORM_LABEL[pf]}</span>
                {CONTEST_TYPES.filter((t) => t.platform === pf).map((t) => (
                  <ChipToggle key={t.id} on={homeTypes.includes(t.id)} onClick={() => toggleHomeType(t.id)} title={t.desc}>
                    {t.label}
                  </ChipToggle>
                ))}
              </div>
            ))}
          </div>
        </Row>
      </Group>

      <Group title="比赛日历" desc="「比赛日历」页显示的日期范围；比赛网站可在日历页顶部直接勾选。">
        <Row label="显示今天之前" hint="包含最近已结束 / 进行中的比赛（0–30 天）。">
          <DaysInput
            value={settings.calendarDaysBefore ?? 3}
            max={30}
            onChange={(v) => setSettings({ calendarDaysBefore: v })}
            label="今天之前天数"
          />
        </Row>
        <Row label="显示今天之后" hint="即将开始的比赛范围（0–60 天）。">
          <DaysInput
            value={settings.calendarDaysAfter ?? 15}
            max={60}
            onChange={(v) => setSettings({ calendarDaysAfter: v })}
            label="今天之后天数"
          />
        </Row>
      </Group>

      <Group
        title="译文样式"
        desc="选择 24 种文字效果并即时预览；原文、来源标签、代码与公式不受影响。"
        right={
          zhStyleCustomized && (
            <SmallButton onClick={resetZhStyle}>
              <RotateCcw className="size-3" />
              恢复默认
            </SmallButton>
          )
        }
      >
        <Pad>
          <div className="space-y-3">
            {['常规', '下划线', '边框与背景', '文字效果'].map((group) => {
              const presets = TRANSLATION_PRESETS.filter((preset) => preset.group === group);
              return (
                <fieldset key={group} className="space-y-1.5">
                  <legend className="text-muted-foreground text-[11px] font-medium">{group}</legend>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                    {presets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        role="radio"
                        aria-checked={zhStyle.preset === preset.id}
                        aria-label={preset.label}
                        onClick={() => patchZhStyle({ preset: preset.id })}
                        className={`min-h-[68px] min-w-0 cursor-pointer rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          zhStyle.preset === preset.id
                            ? 'border-primary/70 bg-primary/10 ring-1 ring-primary/40'
                            : 'bg-background hover:border-primary/40 hover:bg-accent/50'
                        }`}
                      >
                        <span className="zh-styled text-foreground block truncate text-[12px] font-medium" data-zh-preset={preset.id} data-zh-gallery>
                          {preset.label}
                        </span>
                        <span className="zh-styled text-muted-foreground mt-1 block truncate text-[12px]" data-zh-preset={preset.id} data-zh-gallery>
                          <span className="zh-copy">
                            <span data-zh-prose="">夜色渐深，答案仍清晰可见。</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <div className="bg-background rounded-md border px-3 py-2.5">
            <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wider">实时预览 · 题面原文</p>
            <p className="text-muted-foreground md-body text-[13px]">Given an integer n, print the value of 2n.</p>
            <div className="zh-styled mt-1 text-[13px]" lang="zh-Hans" {...translationAppearance(zhStyle)}>
              <span className="zh-copy">
                <p><span data-zh-prose="">给定一个整数 n，输出 2n 的值。每次修改都会立即预览并保存在本机。</span></p>
              </span>
            </div>
          </div>
          <div className="space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-muted-foreground shrink-0 text-[11px]">译文颜色</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="译文颜色模式">
                {[
                  { id: 'theme', label: '跟随主题' },
                  { id: 'inverse', label: '反转背景色' },
                  { id: 'custom', label: '自定义' },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={zhStyle.colorMode === option.id}
                    onClick={() => patchZhStyle({
                      colorMode: option.id,
                      ...(option.id === 'custom' && !zhStyle.color ? { color: '#8b8b9e' } : {}),
                    })}
                    className={`min-h-8 cursor-pointer rounded-md border px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      zhStyle.colorMode === option.id ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {zhStyle.colorMode === 'custom' && (
                <label className="bg-background inline-flex h-8 items-center gap-2 rounded-md border px-2 text-xs">
                  <span className="sr-only">自定义译文颜色</span>
                  <input
                    type="color"
                    value={zhStyle.color || '#8b8b9e'}
                    onChange={(event) => patchZhStyle({ color: event.target.value })}
                    aria-label="译文字体颜色"
                    className="size-8 cursor-pointer sm:size-5"
                  />
                  <span className="text-muted-foreground font-mono">{zhStyle.color || '选择颜色'}</span>
                </label>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StyleColor label="边框颜色" value={zhStyle.borderColor} fallback="#6b8afd" ariaLabel="译文边框颜色" onChange={(borderColor) => patchZhStyle({ borderColor })} />
              <StyleColor label="背景颜色" value={zhStyle.backgroundColor} fallback="#ffe56c" ariaLabel="译文背景颜色" onChange={(backgroundColor) => patchZhStyle({ backgroundColor })} />
              <StyleNumber label="字号" value={zhStyle.fontSize} defaultValue="" placeholder="默认" min={8} max={40} step={1} onChange={(fontSize) => patchZhStyle({ fontSize })} />
              <StyleNumber label="缩放比例" value={zhStyle.zoom} defaultValue={100} min={50} max={200} step={1} suffix="%" onChange={(zoom) => patchZhStyle({ zoom })} />
              <StyleNumber label="段间距倍数" value={zhStyle.spacingScale} defaultValue={1} min={0.5} max={10} step={0.1} onChange={(spacingScale) => patchZhStyle({ spacingScale })} />
              <StyleNumber label="行高倍数" value={zhStyle.lineHeight} defaultValue={1.65} min={1} max={3} step={0.05} onChange={(lineHeight) => patchZhStyle({ lineHeight })} />
              <label className="text-muted-foreground col-span-2 flex min-w-0 items-center gap-2 text-xs sm:col-span-1 sm:flex-col sm:items-stretch">
                <span className="shrink-0">字体</span>
                <select
                  className={`${inputCls} min-w-0`}
                  aria-label="译文字体"
                  value={zhStyle.font}
                  onChange={(event) => patchZhStyle({ font: event.target.value })}
                >
                  {TRANSLATION_FONTS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              {zhStyle.font === 'custom' && (
                <label className="text-muted-foreground col-span-2 min-w-0 space-y-1 text-xs sm:col-span-3">
                  自定义字体名称
                  <input
                    type="text"
                    maxLength={160}
                    value={zhStyle.fontFamily}
                    placeholder="例如：Noto Sans SC, sans-serif"
                    onChange={(event) => patchZhStyle({ fontFamily: event.target.value.slice(0, 160) })}
                    className={inputCls}
                    aria-label="自定义译文字体名称"
                  />
                  <span className="text-muted-foreground/70 block text-[10px]">填写本机已安装的字体名称；该字体若未安装会回退到默认字体。</span>
                </label>
              )}
              <StyleNumber label="字重" value={zhStyle.weight} defaultValue="" placeholder="默认" min={100} max={900} step={1} onChange={(weight) => patchZhStyle({ weight })} />
              <button
                type="button"
                aria-label="译文斜体"
                aria-pressed={zhStyle.italic === true}
                onClick={() => patchZhStyle({ italic: zhStyle.italic !== true })}
                className={`min-h-9 cursor-pointer rounded-md border px-3 text-xs italic transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${zhStyle.italic === true ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                斜体{zhStyle.italic === true ? '：开启' : '：关闭'}
              </button>
            </div>
            <p className="text-muted-foreground/70 text-[10px] leading-relaxed">反转色随当前主题背景自动变化；调整边框颜色时，可选择「自定义」并指定译文颜色。</p>
          </div>
        </Pad>
      </Group>

      <Advanced title="高级翻译选项" desc="对照优先级、「译」浮标渠道、AI 自定义翻译接口、渠道成功率体检。">
        <SubBlock
          title="对照模式优先级"
          hint="对照模式下每段取第一个有译文的渠道，段尾标注来源；缺失的译文由本机向各渠道实时请求（约每 3 秒一条）并保存在本机。想让全站优先显示某个渠道，把它排到第一位即可。"
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

        <SubBlock title="左下角「译」浮标中显示的渠道">
          <div className="flex flex-wrap gap-1.5">
            {CHANNELS.map((c) => (
              <ChipToggle key={c.id} on={settings.sidebarChannels.includes(c.id)} onClick={() => toggleChannel(c.id)}>
                {c.label}
              </ChipToggle>
            ))}
          </div>
        </SubBlock>

        <SubBlock
          title="AI（用户自定义翻译）使用的服务商与模型"
          hint="接口地址与 API Key 在「AI 助手 → 服务商」统一配置，这里只挑选用哪个。"
        >
          <ModuleAssignPicker moduleId="translation" label="翻译" />
          <p className={`rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed ${aiReady ? 'text-emerald-500 border-emerald-500/30' : 'text-amber-500 border-amber-500/40'}`}>
            {aiReady
              ? `当前翻译接口：${aiForm.baseUrl || '（未挑选）'} · 模型 ${aiForm.model}${aiForm.proxy ? ' · 经本站转发' : ''}`
              : '尚未配置：请到「AI 助手」分区添加服务商（Base URL + API Key）。'}
          </p>
        </SubBlock>

        <SubBlock
          title={`渠道体检 · ${TEST_COUNT} 次真实翻译成功率排行`}
          hint={`对每个勾选的渠道连发 ${TEST_COUNT} 次真实翻译请求（固定样本，含公式与行内代码），按成功率排行；测完可一键把对照优先级重排为成功率顺序。AI (CI翻译) 为仓库存档，不参与测试。`}
          right={
            <div className="flex shrink-0 items-center gap-1.5">
              {ranking.length > 0 && <SmallButton onClick={applyRanking}>按成功率重排优先级</SmallButton>}
              {running ? (
                <SmallButton tone="danger" onClick={stopHealth}>
                  停止
                </SmallButton>
              ) : (
                <SmallButton tone="primary" onClick={startHealth} disabled={!healthChannels.length}>
                  开始测试
                </SmallButton>
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
              title={aiReady ? undefined : '先配置 AI 接口'}
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
            <div className="overflow-x-auto rounded-md border">
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
              <SmallButton
                onClick={() => {
                  clearMtStats();
                  setStats({});
                }}
              >
                清空统计
              </SmallButton>
            )}
          </div>
        </SubBlock>
      </Advanced>
    </div>
  );
}

/** 天数输入：失焦 / 回车时钳制到 [0, max] 再保存。 */
function DaysInput({ value, max, onChange, label }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number.parseInt(draft, 10);
    const v = Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : value;
    setDraft(String(v));
    if (v !== value) onChange(v);
  };
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <input
        type="number"
        min={0}
        max={max}
        aria-label={label}
        className={`${inputCls} w-20 text-right tabular-nums`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      天
    </span>
  );
}

function StyleColor({ label, value, fallback, ariaLabel, onChange }) {
  return (
    <label className="bg-background flex min-h-9 min-w-0 items-center justify-between gap-2 rounded-md border px-2 text-xs">
      <span className="text-muted-foreground truncate">{label}</span>
      <input
        type="color"
        value={value || fallback}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className="size-8 shrink-0 cursor-pointer sm:size-5"
      />
    </label>
  );
}

function StyleNumber({ label, value, defaultValue, placeholder, min, max, step, suffix, onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (draft.trim() === '') {
      setDraft(String(defaultValue));
      onChange('');
      return;
    }
    const candidate = Number(draft);
    if (!Number.isFinite(candidate)) {
      setDraft(String(value));
      return;
    }
    const bounded = Math.min(max, Math.max(min, candidate));
    const precision = step < 1 ? String(step).split('.')[1]?.length || 0 : 0;
    const rounded = Number((Math.round(bounded / step) * step).toFixed(precision));
    setDraft(String(rounded));
    onChange(rounded);
  };

  return (
    <label className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs sm:flex-col sm:items-stretch">
      <span className="flex shrink-0 items-center justify-between gap-1">
        <span>{label}</span>
        {suffix && <span>{suffix}</span>}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        placeholder={placeholder}
        aria-label={`译文${label}`}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          if (raw === '') return onChange('');
          const next = Number(raw);
          if (Number.isFinite(next) && next >= min && next <= max) onChange(next);
        }}
        onBlur={commit}
        onKeyDown={(event) => event.key === 'Enter' && commit()}
        className={`${inputCls} min-w-0 py-1`}
      />
    </label>
  );
}
