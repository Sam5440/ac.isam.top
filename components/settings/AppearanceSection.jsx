'use client';

/**
 * 设置页外观相关块（v1.8 拆分）：
 *  - <ThemeGallery />        主题库网格（内置 3 + 模板 4 + 自定义）+ 从模板新建 / 编辑 / 删除（实时预览）
 *  - <CustomCssBlock />      全局自定义 CSS
 *  - <IdeThemeBindingRow />  代码编辑器主题是否跟随网页外观
 */

import { useEffect, useState } from 'react';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';

import { useSettings } from '@/components/settings';
import { allThemes, deleteCustomTheme, mappedIdeTheme, saveCustomTheme, swatchOf, TEMPLATE_THEMES } from '@/lib/themes';
import { EDITOR_THEMES } from '@/lib/compiler/themes';
import { Field, inputCls, Pad, Row, SegButtons, SmallButton, SubBlock, textareaCls } from './controls';

const KIND_LABEL = { builtin: '内置', template: '模板', custom: '自定义' };

export function ThemeGallery() {
  const { settings, setSettings, customThemes, reloadCustomThemes } = useSettings();
  const themes = allThemes(customThemes);
  const [tplId, setTplId] = useState(TEMPLATE_THEMES[0].id);
  // 编辑态：{ id, name, base, css }；id 存在且在 customThemes 中 = 编辑，否则新建
  const [editing, setEditing] = useState(null);

  // 实时预览：防抖注入 ac-theme-preview-css（置于 ac-theme-css 之后生效），
  // 同时临时把 data-theme/base 类切到编辑中的主题
  useEffect(() => {
    if (!editing) return undefined;
    const root = document.documentElement;
    const apply = () => {
      root.setAttribute('data-theme', editing.id);
      root.classList.toggle('dark', editing.base === 'dark');
      root.classList.remove('eink');
      let el = document.getElementById('ac-theme-preview-css');
      if (!el) {
        el = document.createElement('style');
        el.id = 'ac-theme-preview-css';
        document.head.appendChild(el);
      }
      el.textContent = editing.css || '';
    };
    const t = setTimeout(apply, 250);
    return () => clearTimeout(t);
  }, [editing]);

  const stopPreview = () => {
    document.getElementById('ac-theme-preview-css')?.remove();
    // 让 Provider 的主题 effect 重放，恢复当前主题的 data-theme/类名/样式
    reloadCustomThemes();
  };

  const startNew = () => {
    const tpl = TEMPLATE_THEMES.find((t) => t.id === tplId) || TEMPLATE_THEMES[0];
    const id = `custom-${Date.now().toString(36)}`;
    setEditing({
      id,
      name: `${tpl.label} · 我的主题`,
      base: tpl.base,
      // 模板 CSS 的选择器带着模板自身 id，复制时改写为新主题 id 才能生效
      css: tpl.css.replaceAll(`html[data-theme="${tpl.id}"]`, `html[data-theme="${id}"]`),
    });
  };

  const startEdit = (t) => setEditing({ id: t.id, name: t.name, base: t.base, css: t.css });

  const cancel = () => {
    setEditing(null);
    stopPreview();
  };

  const save = () => {
    const name = (editing.name || '').trim() || '我的主题';
    const { id, base, css } = editing;
    saveCustomTheme({ id, name, base, css });
    setEditing(null);
    document.getElementById('ac-theme-preview-css')?.remove();
    setSettings({ theme: id }); // 保存即应用
    reloadCustomThemes();
  };

  const remove = (t) => {
    if (!window.confirm(`删除自定义主题「${t.name}」？`)) return;
    const next = deleteCustomTheme(t.id);
    if (settings.theme === t.id) setSettings({ theme: 'dark' });
    reloadCustomThemes();
    if (editing?.id === t.id) setEditing(null);
    return next;
  };

  return (
    <>
      <Pad>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {themes.map((t) => {
            const active = settings.theme === t.id;
            const sw = swatchOf(t);
            return (
              <div
                key={t.id}
                className={`group relative overflow-hidden rounded-lg border transition-all ${
                  active ? 'border-primary ring-2 ring-primary/40' : 'hover:border-primary/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSettings({ theme: t.id })}
                  aria-pressed={active}
                  className="block w-full text-left"
                >
                  <span className="flex h-9">
                    {sw.slice(0, 4).map((c, i) => (
                      <span key={i} className="flex-1" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="flex items-center justify-between gap-1 px-2.5 py-1.5">
                    <span className="truncate text-xs font-medium">{t.label}</span>
                    <span className="text-muted-foreground shrink-0 rounded border px-1 text-[9px]">
                      {KIND_LABEL[t.kind] || t.kind}
                    </span>
                  </span>
                </button>
                {t.kind === 'custom' && (
                  <span className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      aria-label={`编辑 ${t.name}`}
                      className="bg-background/90 rounded border p-1 shadow"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(t)}
                      aria-label={`删除 ${t.name}`}
                      className="bg-background/90 rounded border p-1 shadow"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-muted-foreground/70 text-[11px] leading-relaxed">
          点击即应用；顶栏的外观按钮可在全部主题间快速循环。
        </p>
      </Pad>

      <Row label="自定义主题" hint="以模板为起点复制一份主题 CSS 编辑，保存前整个页面即为实时预览；自定义主题卡片悬停可编辑 / 删除。">
        <select
          value={tplId}
          onChange={(e) => setTplId(e.target.value)}
          aria-label="选择模板"
          className={`${inputCls} w-auto py-1 text-xs`}
        >
          {TEMPLATE_THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              模板：{t.label}
            </option>
          ))}
        </select>
        <SmallButton onClick={startNew} disabled={!!editing}>
          <Plus className="size-3.5" />
          新建
        </SmallButton>
      </Row>

      {editing && (
        <Pad>
          <SubBlock
            title={`编辑自定义主题：${editing.name || '未命名'}`}
            hint={'CSS 须以 html[data-theme="主题id"] 为选择器覆盖标准变量；保存前界面即为实时预览。'}
            right={
              <div className="flex shrink-0 items-center gap-1.5">
                <SmallButton onClick={cancel}>取消</SmallButton>
                <SmallButton tone="primary" onClick={save}>
                  保存并应用
                </SmallButton>
              </div>
            }
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="主题名称">
                <input
                  className={inputCls}
                  value={editing.name}
                  onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                  placeholder="我的主题"
                />
              </Field>
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs font-medium">明暗基准（决定 dark: 样式变体与原生控件配色）</span>
                <SegButtons
                  options={[
                    { id: 'dark', label: '暗色基准' },
                    { id: 'light', label: '浅色基准' },
                  ]}
                  value={editing.base}
                  onChange={(v) => setEditing((p) => ({ ...p, base: v }))}
                />
              </div>
            </div>
            <Field label="主题 CSS">
              <textarea
                className={`${textareaCls} min-h-56`}
                spellCheck={false}
                value={editing.css}
                onChange={(e) => setEditing((p) => ({ ...p, css: e.target.value }))}
              />
            </Field>
          </SubBlock>
        </Pad>
      )}
    </>
  );
}

/** 代码编辑器（Monaco）主题与网页外观的绑定：跟随 / 手动。 */
export function IdeThemeBindingRow() {
  const { settings, setSettings, customThemes } = useSettings();
  const mapped =
    EDITOR_THEMES.find((t) => t.id === mappedIdeTheme(settings.theme, customThemes))?.label || '站点暗色（默认）';
  const manual = settings.ideThemeBinding === 'manual';
  return (
    <Row
      label="编辑器配色跟随网页外观"
      hint={
        manual
          ? '已改为手动：在下方「编辑器主题」或 /ide 编辑器设置中自选，切换网页主题不再联动。'
          : `切换网页主题时自动映射为最接近的编辑器配色（当前：${mapped}）。`
      }
    >
      <SegButtons
        options={[
          { id: 'auto', label: '跟随网页' },
          { id: 'manual', label: '手动' },
        ]}
        value={settings.ideThemeBinding || 'auto'}
        onChange={(v) => setSettings({ ideThemeBinding: v })}
      />
    </Row>
  );
}

/** 全局自定义 CSS：叠加在任意主题之上，所有页面生效。 */
export function CustomCssBlock() {
  const { settings, setSettings } = useSettings();
  const empty = !(settings.customCss || '').trim();
  return (
    <Row
      stack
      label="全局自定义 CSS"
      hint="叠加在任意主题之上，所有页面生效（适合微调间距、隐藏元素、覆盖个别组件样式）。"
    >
      <textarea
        className={textareaCls}
        spellCheck={false}
        aria-label="全局自定义 CSS"
        placeholder={'/* 例如：题面卡片更大圆角 */\n.rounded-xl { border-radius: 1rem; }'}
        value={settings.customCss || ''}
        onChange={(e) => setSettings({ customCss: e.target.value })}
      />
      {!empty && (
        <SmallButton onClick={() => setSettings({ customCss: '' })}>
          <RotateCcw className="size-3" />
          清空
        </SmallButton>
      )}
    </Row>
  );
}
