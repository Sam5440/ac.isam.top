'use client';

/**
 * 设置页「外观」分区：主题库（内置 3 + 模板 4 + 自定义）网格、
 * 从模板新建/编辑/删除自定义主题（实时预览）、全局自定义 CSS。
 */

import { useEffect, useState } from 'react';
import { Palette, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';

import { useSettings } from '@/components/settings';
import { allThemes, deleteCustomTheme, saveCustomTheme, swatchOf, TEMPLATE_THEMES } from '@/lib/themes';
import { Field, inputCls, SegButtons, SectionCard, SubBlock, textareaCls } from './controls';

const KIND_LABEL = { builtin: '内置', template: '模板', custom: '自定义' };

export default function AppearanceSection() {
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

  const customCssEmpty = !(settings.customCss || '').trim();

  return (
    <SectionCard
      id="appearance"
      icon={Palette}
      title="外观"
      desc="内置主题、四套模板主题与自定义主题；自定义 CSS 可叠加在任意主题之上。"
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs font-medium">主题（点击应用；顶栏按钮可在全部主题间快捷循环）</p>
          <div className="flex items-center gap-1.5">
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
            <button
              type="button"
              onClick={startNew}
              disabled={!!editing}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-40"
            >
              <Plus className="size-3.5" />
              从模板新建
            </button>
          </div>
        </div>

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
                <button type="button" onClick={() => setSettings({ theme: t.id })} className="block w-full text-left">
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
                  <span className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
          自定义主题卡片悬停可编辑 / 删除。模板主题的代码编辑器（Monaco）建议配色：Nord→One Dark、Dracula→Dracula、Gruvbox→Monokai、樱花→Solarized Light，可在「编译器」分区里选择。
        </p>
      </div>

      {editing && (
        <SubBlock
          title={`编辑自定义主题：${editing.name || '未命名'}`}
          hint={'CSS 须以 html[data-theme="主题id"] 为选择器覆盖标准变量；保存前下方界面即为实时预览。'}
          right={
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={cancel}
                className="text-muted-foreground hover:text-foreground rounded-md border px-2 py-0.5 text-[11px] transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={save}
                className="bg-primary text-primary-foreground rounded-md px-2.5 py-0.5 text-[11px] font-medium"
              >
                保存并应用
              </button>
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
      )}

      <SubBlock
        title="全局自定义 CSS"
        hint="任意主题之上叠加，所有页面生效（适合微调间距、隐藏元素、覆盖个别组件样式）。"
        right={
          !customCssEmpty && (
            <button
              type="button"
              onClick={() => setSettings({ customCss: '' })}
              className="text-muted-foreground hover:text-foreground shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition-colors"
            >
              <RotateCcw className="mr-0.5 inline size-3" />
              清空
            </button>
          )
        }
      >
        <textarea
          className={textareaCls}
          spellCheck={false}
          placeholder={'/* 例如：题面卡片更大圆角 */\n.rounded-xl { border-radius: 1rem; }'}
          value={settings.customCss || ''}
          onChange={(e) => setSettings({ customCss: e.target.value })}
        />
      </SubBlock>
    </SectionCard>
  );
}
