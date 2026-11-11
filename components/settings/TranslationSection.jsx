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
  DEFAULT_ZH_STYLE,
  useSettings,
} from '@/components/settings';
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
        desc="题面中文译文的外观；来源标签、行内代码与公式不受影响。"
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
            <div className="flex items-center gap-1">
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
            <p className="zh-styled text-[13px] leading-6">预览：给定一个整数 n，输出 2n 的值。每次修改立即生效并保存在本机。</p>
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
