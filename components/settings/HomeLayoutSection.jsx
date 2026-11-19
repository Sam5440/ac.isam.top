'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, RotateCcw, Save } from 'lucide-react';

import { useSettings } from '@/components/settings';
import { Group, Pad, Row, SegButtons, SmallButton, inputCls, textareaCls } from '@/components/settings/controls';
import HomeWidgetEditor from './HomeWidgetEditor';
import HomeLivePreview from '@/components/home/HomeLivePreview';
import { DEFAULT_WIDGETS, normalizeWidgets } from '@/lib/home-grid.mjs';
import { HOME_PRESETS, VISUAL_HOME_PRESETS } from '@/lib/home-presets.mjs';
import {
  DEFAULT_HOME_WEATHER, HOME_LAYOUT_LIMIT, HOME_WIDGETS, normalizeCfHandle,
  normalizeHomeWeather,
} from '@/lib/home-layout.mjs';
import { toast } from '@/lib/toast';

export default function HomeLayoutSection() {
  const router = useRouter();
  const { settings, setSettings } = useSettings();
  const [draft, setDraft] = useState(settings.homeLayout);
  const [handle, setHandle] = useState(settings.homeCfHandle || '');
  const [weather, setWeather] = useState(settings.homeWeather || DEFAULT_HOME_WEATHER);
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState(settings.homeLayoutMode);
  const [widgets, setWidgets] = useState(settings.homeWidgets);
  useEffect(() => setMode(settings.homeLayoutMode), [settings.homeLayoutMode]);
  useEffect(() => setWidgets(settings.homeWidgets), [settings.homeWidgets]);

  useEffect(() => setDraft(settings.homeLayout), [settings.homeLayout]);
  useEffect(() => setHandle(settings.homeCfHandle || ''), [settings.homeCfHandle]);
  useEffect(() => setWeather(settings.homeWeather || DEFAULT_HOME_WEATHER), [settings.homeWeather]);

  const save = (goHome = false) => {
    if (draft.length > HOME_LAYOUT_LIMIT) {
      toast.error(`HTML 不能超过 ${HOME_LAYOUT_LIMIT.toLocaleString('zh-CN')} 个字符`);
      return;
    }
    const nextWeather = normalizeHomeWeather(weather);
    setSettings({
      homeLayoutMode: mode,
      homeWidgets: normalizeWidgets(widgets),
      homeLayout: draft,
      homeCfHandle: normalizeCfHandle(handle),
      homeWeather: nextWeather,
    });
    setWeather(nextWeather);
    toast.success('首页布局已保存');
    if (goHome) router.push('/');
  };

  const fillPreset = (preset) => {
    setDraft(preset.html);
    setSelected(preset.id);
    toast.info(`已填入「${preset.label}」，保存后生效`);
  };

  const applyVisualPreset = (preset) => {
    setWidgets(normalizeWidgets(preset.widgets));
    setSelected(preset.id);
    toast.info(`已选择「${preset.label}」，保存后生效`);
  };

  const cancel = () => {
    setMode(settings.homeLayoutMode);
    setWidgets(settings.homeWidgets);
    setDraft(settings.homeLayout);
    setHandle(settings.homeCfHandle);
    setWeather(settings.homeWeather);
    setSelected('');
  };
  const dirty = mode !== settings.homeLayoutMode || draft !== settings.homeLayout || handle !== settings.homeCfHandle ||
    JSON.stringify(widgets) !== JSON.stringify(settings.homeWidgets) || JSON.stringify(weather) !== JSON.stringify(settings.homeWeather);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegButtons ariaLabel="布局模式" value={mode} onChange={setMode} options={[{ id: 'visual', label: '小组件布局' }, { id: 'html', label: '高级 HTML' }]} />
        <span role="status" className="text-muted-foreground text-xs">{dirty ? '有未保存的修改' : '已保存的布局'}</span>
      </div>
      {mode === 'visual' ? <>
        <Group title="可视化预设" desc="10 套方案均可直接选择并继续修改；手机自动变为单列，电脑按两列或四列排布。">
          <Pad>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {VISUAL_HOME_PRESETS.map((preset) => (
                <button key={preset.id} type="button" data-visual-preset={preset.id} onClick={() => applyVisualPreset(preset)} aria-pressed={selected === preset.id}
                  className={`rounded-xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 ${selected === preset.id ? 'border-primary/60 bg-primary/5' : 'bg-background'}`}>
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">{preset.label}{selected === preset.id && <Check className="text-primary size-4" />}</span>
                  <span className="text-primary mt-1.5 block text-[11px]">{preset.device}</span>
                  <span className="text-muted-foreground mt-1 block text-[11px] leading-relaxed">{preset.description}</span>
                </button>
              ))}
            </div>
          </Pad>
        </Group>
        <HomeWidgetEditor widgets={widgets} onChange={(next) => { setWidgets(next); setSelected(''); }} />
        <SmallButton onClick={() => { setWidgets(DEFAULT_WIDGETS); setSelected(''); }}><RotateCcw className="size-3" />恢复默认四列布局</SmallButton>
      </> : <>
      <Group title="预设布局" desc="选择预设只会填入下方编辑器，检查并保存后才会替换当前首页。共 12 套，可继续自由修改。">
        <Pad>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {HOME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => fillPreset(preset)}
                aria-pressed={selected === preset.id}
                className={`rounded-xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 ${selected === preset.id ? 'border-primary/60 bg-primary/5' : 'bg-background'}`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">{preset.label}{selected === preset.id && <Check className="text-primary size-4" />}</span>
                <span className="text-muted-foreground mt-1.5 block text-[11px] leading-relaxed">{preset.description}</span>
                <span className="text-primary mt-2 block text-[11px]">填入编辑器</span>
              </button>
            ))}
          </div>
        </Pad>
      </Group>

      <Group title="组件默认参数" desc="HTML 组件上的 handle、city、latitude、longitude、unit 属性会覆盖这里的默认值。">
        <Row label="Codeforces Handle" hint="供所有未单独指定 handle 的 <ac-cf-rating> 使用。">
          <input aria-label="Codeforces Handle" className={`${inputCls} w-48`} value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="例如 tourist" />
        </Row>
        <Row label="默认城市" hint="指定 city 属性时由 Open-Meteo 地理编码查询坐标。">
          <input aria-label="天气默认城市" className={`${inputCls} w-48`} value={weather.city || ''} onChange={(event) => setWeather((prev) => ({ ...prev, city: event.target.value }))} />
        </Row>
        <Row label="默认坐标" hint="纬度范围 -90～90，经度范围 -180～180。">
          <div className="flex items-center gap-2">
            <input aria-label="天气纬度" type="number" min={-90} max={90} step="any" className={`${inputCls} w-28`} value={weather.latitude} onChange={(event) => setWeather((prev) => ({ ...prev, latitude: event.target.value }))} />
            <input aria-label="天气经度" type="number" min={-180} max={180} step="any" className={`${inputCls} w-28`} value={weather.longitude} onChange={(event) => setWeather((prev) => ({ ...prev, longitude: event.target.value }))} />
          </div>
        </Row>
        <Row label="温度单位">
          <select aria-label="天气温度单位" className={`${inputCls} w-36`} value={weather.unit} onChange={(event) => setWeather((prev) => ({ ...prev, unit: event.target.value }))}>
            <option value="celsius">摄氏度 °C</option>
            <option value="fahrenheit">华氏度 °F</option>
          </select>
        </Row>
      </Group>

      <Group
        title="首页 HTML"
        desc="支持常用 HTML、Tailwind 类与受约束的行内样式。script、iframe、事件属性和危险 URL 会在渲染时移除。组件建议写成开闭标签对。"
        right={<div className="flex gap-2"><SmallButton onClick={() => fillPreset(HOME_PRESETS[0])}><RotateCcw className="size-3" />填入经典布局</SmallButton></div>}
      >
        <Pad>
          <textarea
            aria-label="首页 HTML 布局"
            className={`${textareaCls} min-h-[28rem] resize-y whitespace-pre`}
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={`text-[11px] tabular-nums ${draft.length > HOME_LAYOUT_LIMIT ? 'text-red-400' : 'text-muted-foreground'}`}>{draft.length.toLocaleString('zh-CN')} / {HOME_LAYOUT_LIMIT.toLocaleString('zh-CN')} 字符 · 保存在本机并随设置导出</span>
          </div>
        </Pad>
      </Group>

      <Group title="组件参考" desc="kind 可取 recent（近期已举办）、latest（按时间最新）、upcoming（未来）、fetched（最近拉取）；history 组件使用 viewed / practiced。limit 范围 1～24。">
        <Pad>
          <div className="grid gap-3 lg:grid-cols-2">
            {HOME_WIDGETS.map((widget) => (
              <details key={widget.tag} className="rounded-lg border bg-background px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium">{widget.label}<code className="text-muted-foreground ml-2 font-normal">{widget.tag}</code></summary>
                <pre className="text-muted-foreground mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">{widget.example}</pre>
              </details>
            ))}
          </div>
          <div className="text-muted-foreground space-y-1 rounded-lg border border-dashed p-3 text-[11px] leading-relaxed">
            <p>普通 HTML 示例：<code>&lt;div class="grid gap-4 md:grid-cols-2"&gt;…&lt;/div&gt;</code>。</p>
            <p>天气可写 <code>&lt;ac-weather city="上海"&gt;&lt;/ac-weather&gt;</code>；CF 可写 <code>&lt;ac-cf-rating handle="tourist"&gt;&lt;/ac-cf-rating&gt;</code>。</p>
            <p>比赛组件支持 platform="atcoder / codeforces / cf-gyms / nowcoder"；所有链接与文本均可与普通 HTML 混排。</p>
          </div>
        </Pad>
      </Group>
      </>}
      <HomeLivePreview config={{
        homeLayoutMode: mode,
        homeWidgets: widgets,
        homeLayout: draft,
        homeCfHandle: normalizeCfHandle(handle),
        homeWeather: normalizeHomeWeather(weather),
      }} />
      <div className="home-layout-actions sticky bottom-[max(.5rem,env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-card p-2 shadow-sm">
        <SmallButton disabled={!dirty} onClick={cancel}>取消修改</SmallButton>
        <SmallButton onClick={() => save(false)}><Save className="size-3.5" />保存布局</SmallButton>
        <SmallButton tone="primary" onClick={() => save(true)}>保存并查看首页<ExternalLink className="size-3.5" /></SmallButton>
      </div>
    </div>
  );
}
