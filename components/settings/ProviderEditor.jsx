'use client';

/**
 * 单个 AI 服务商的编辑器：基本信息（名称/备注/API 格式/Base URL/Key）+
 * 模型管理（手工添加/删除、从 GET /models 端点拉取、筛选勾选）。
 * 保存回调把完整服务商对象交回父级。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CloudDownload, Plus, Search, Trash2, X } from 'lucide-react';

import { toast } from '@/lib/toast';
import { Spinner } from '@/components/ui/LoadingOverlay';
import { API_FORMATS, fetchProviderModels } from '@/lib/ai-providers';
import { Field, inputCls } from './controls';

export default function ProviderEditor({ initial, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({
    id: initial?.id || null,
    name: initial?.name || '',
    note: initial?.note || '',
    apiFormat: initial?.apiFormat || 'openai',
    baseUrl: initial?.baseUrl || '',
    apiKey: initial?.apiKey || '',
    models: initial?.models || [],
  }));
  const [remote, setRemote] = useState(null); // { state: 'loading'|'done'|'fail', models?, error?, selected?: Set }
  const [filter, setFilter] = useState('');
  const [newModel, setNewModel] = useState('');
  const filterRef = useRef(null);

  const patch = (p) => setForm((prev) => ({ ...prev, ...p }));

  const pullModels = async () => {
    if (!form.baseUrl.trim()) return;
    setRemote({ state: 'loading' });
    toast.info('正在拉取模型列表…');
    const r = await fetchProviderModels({ ...form, baseUrl: form.baseUrl.trim() });
    if (r.ok) {
      // 默认全选新发现的模型（保留已添加的）
      const merged = [...new Set([...form.models, ...r.models])];
      setRemote({ state: 'done', models: r.models, selected: new Set(merged) });
      setFilter('');
      toast.success(`拉取成功：发现 ${r.models.length} 个模型`);
    } else {
      setRemote({ state: 'fail', error: r.error });
      toast.error(`拉取模型列表失败：${r.error}`);
    }
  };

  const applyRemoteSelection = () => {
    if (remote?.state !== 'done') return;
    patch({ models: [...remote.selected] });
    setRemote(null);
  };

  const addManual = () => {
    const m = newModel.trim();
    if (!m || form.models.includes(m)) return;
    patch({ models: [...form.models, m] });
    setNewModel('');
  };

  const canSave = !!form.baseUrl.trim();

  // 拉取结果按筛选词过滤 + 已选置顶分组
  const filtered = useMemo(() => {
    if (remote?.state !== 'done') return [];
    const q = filter.trim().toLowerCase();
    const list = remote.models.filter((m) => !q || m.toLowerCase().includes(q));
    return list;
  }, [remote, filter]);

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{form.id ? '编辑服务商' : '新增服务商'}</p>
        <button
          type="button"
          onClick={onCancel}
          aria-label="取消编辑"
          className="text-muted-foreground hover:text-foreground rounded p-1"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="名称">
          <input
            className={inputCls}
            placeholder="如：SiliconFlow / 自建网关"
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field label="备注" hint="可选：用途、额度、模型偏好等">
          <input
            className={inputCls}
            placeholder="备注"
            value={form.note}
            onChange={(e) => patch({ note: e.target.value })}
          />
        </Field>
        <Field label="API 格式" hint="决定对话请求体与模型列表端点的形态">
          <select
            className={inputCls}
            value={form.apiFormat}
            onChange={(e) => patch({ apiFormat: e.target.value })}
          >
            {API_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Base URL" hint="OpenAI 格式自动补 /v1；Anthropic 填根地址即可">
          <input
            className={inputCls}
            placeholder="https://api.example.com"
            value={form.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="API Key" hint="仅保存在本机浏览器">
            <input
              className={inputCls}
              type="password"
              placeholder="sk-..."
              value={form.apiKey}
              onChange={(e) => patch({ apiKey: e.target.value })}
            />
          </Field>
        </div>
      </div>

      {/* 模型管理 */}
      <div className="space-y-2 rounded-md border p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs font-medium">
            模型列表（{form.models.length} 个；各功能模块只能从这些模型中挑选）
          </p>
          <button
            type="button"
            onClick={pullModels}
            disabled={!form.baseUrl.trim() || remote?.state === 'loading'}
            className="bg-background hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-50"
          >
            {remote?.state === 'loading' ? (
              <Spinner className="size-3" />
            ) : (
              <CloudDownload className="size-3" />
            )}
            从端点获取模型
          </button>
        </div>

        {/* 手工添加 */}
        <div className="flex items-center gap-1.5">
          <input
            className={`${inputCls} h-8 flex-1 py-1 text-xs`}
            placeholder="手工添加模型名（Enter 确认）"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addManual();
              }
            }}
          />
          <button
            type="button"
            onClick={addManual}
            disabled={!newModel.trim()}
            aria-label="添加模型"
            className="bg-background hover:bg-accent grid size-8 shrink-0 place-items-center rounded-md border transition-colors disabled:opacity-40"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        {/* 已保存的模型 chips */}
        {form.models.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {form.models.map((m) => (
              <span
                key={m}
                className="bg-background inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px]"
              >
                {m}
                <button
                  type="button"
                  onClick={() => patch({ models: form.models.filter((x) => x !== m) })}
                  aria-label={`删除模型 ${m}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 远端模型筛选面板 */}
        {remote?.state === 'done' && (
          <div className="space-y-1.5 rounded-md border border-primary/40 bg-primary/5 p-2">
            <div className="flex items-center gap-1.5">
              <Search className="text-muted-foreground size-3.5 shrink-0" />
              <input
                ref={filterRef}
                className={`${inputCls} h-7 py-0.5 text-xs`}
                placeholder={`筛选 ${remote.models.length} 个模型…`}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                onClick={() => {
                  // 全选/全不选当前筛选结果
                  const next = new Set(remote.selected);
                  const allOn = filtered.length > 0 && filtered.every((m) => next.has(m));
                  for (const m of filtered) {
                    if (allOn) next.delete(m);
                    else next.add(m);
                  }
                  setRemote({ ...remote, selected: next });
                }}
                className="bg-background hover:bg-accent shrink-0 rounded-md border px-2 py-1 text-[11px] transition-colors"
              >
                反选筛选结果
              </button>
              <button
                type="button"
                onClick={() => setRemote(null)}
                aria-label="关闭模型列表"
                className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="max-h-44 overflow-y-auto">
              <ul className="space-y-0.5">
                {filtered.map((m) => {
                  const on = remote.selected.has(m);
                  return (
                    <li key={m}>
                      <label className="hover:bg-accent/60 flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            const next = new Set(remote.selected);
                            if (on) next.delete(m);
                            else next.add(m);
                            setRemote({ ...remote, selected: next });
                          }}
                        />
                        <span className="truncate font-mono text-[11px]">{m}</span>
                        {form.models.includes(m) && !on && (
                          <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">已在列表</span>
                        )}
                      </label>
                    </li>
                  );
                })}
                {filtered.length === 0 && (
                  <li className="text-muted-foreground px-1.5 py-2 text-[11px]">无匹配模型</li>
                )}
              </ul>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-[11px]">
                已勾选 {remote.selected.size} / {remote.models.length}
              </span>
              <button
                type="button"
                onClick={applyRemoteSelection}
                className="bg-primary text-primary-foreground rounded-md px-2.5 py-1 text-[11px] font-medium"
              >
                应用到模型列表
              </button>
            </div>
          </div>
        )}
        {remote?.state === 'fail' && (
          <p className="text-[11px] leading-relaxed text-red-400">✗ 获取失败：{remote.error}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => canSave && onSave(form)}
          disabled={!canSave}
          className="bg-primary text-primary-foreground rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40"
        >
          {form.id ? '保存修改' : '添加服务商'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-background hover:bg-accent rounded-md border px-2.5 py-1 text-xs text-foreground transition-colors"
        >
          取消
        </button>
        {!canSave && <span className="text-muted-foreground text-[11px]">请填写 Base URL</span>}
      </div>
    </div>
  );
}
