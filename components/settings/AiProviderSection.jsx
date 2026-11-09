'use client';

/**
 * 设置页「AI 服务商」分区：全站唯一配置 AI 接口地址 / API Key 的地方。
 * 服务商注册表（多方案，可切换默认）+ 各功能模块（翻译 / AI 对话）的挑选
 * 下拉与模型覆盖。AI 代码补全在其自身分区挑选服务商（FIM 等字段独立）。
 */

import { useState } from 'react';
import { Check, Pencil, Plus, Server, Trash2, X } from 'lucide-react';

import { useSettings } from '@/components/settings';
import { AI_MODELS, normalizeBaseUrl, providerReady } from '@/lib/ai-providers';
import { makeProviderId } from '@/lib/ai-providers';
import { Field, inputCls, SectionCard, SubBlock, ToggleRow } from './controls';

const MODULES = [
  { id: 'translation', label: '翻译（AI 用户自定义翻译）' },
  { id: 'chat', label: 'AI 对话' },
];

export default function AiProviderSection() {
  const { settings, setSettings } = useSettings();
  const providers = settings.aiProviders || { list: [], activeId: null };
  const assign = settings.aiAssign || {};
  const [editing, setEditing] = useState(null); // { id?, name, baseUrl, apiKey } | null
  const [test, setTest] = useState(null); // { ok, msg }

  const patchProviders = (p) =>
    setSettings((prev) => ({ ...prev, aiProviders: { ...(prev.aiProviders || { list: [], activeId: null }), ...p } }));
  const patchAssign = (moduleId, p) =>
    setSettings((prev) => ({
      ...prev,
      aiAssign: {
        ...(prev.aiAssign || {}),
        [moduleId]: { ...(prev.aiAssign?.[moduleId] || { providerId: 'auto', model: '' }), ...p },
      },
    }));
  // 广播服务商变化：同页其他分区（如 AI 补全）即时刷新挑选下拉
  const notifyProvidersChanged = () => window.dispatchEvent(new Event('ac-providers-changed'));

  const startNew = () => setEditing({ id: null, name: '', baseUrl: '', apiKey: '' });
  const startEdit = (p) => setEditing({ id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey });

  const saveEditing = () => {
    const baseUrl = (editing.baseUrl || '').trim();
    if (!baseUrl) {
      window.alert('请填写 Base URL。');
      return;
    }
    if (editing.id) {
      patchProviders({
        list: providers.list.map((p) =>
          p.id === editing.id
            ? { ...p, name: (editing.name || '').trim(), baseUrl, apiKey: editing.apiKey || '' }
            : p,
        ),
      });
    } else {
      const id = makeProviderId();
      patchProviders({
        list: [
          ...providers.list,
          {
            id,
            name: (editing.name || '').trim() || '未命名服务商',
            baseUrl,
            apiKey: editing.apiKey || '',
          },
        ],
        ...(providers.activeId ? {} : { activeId: id }),
      });
    }
    setEditing(null);
    setTest(null);
    notifyProvidersChanged();
  };

  const removeProvider = (p) => {
    const usedBy = MODULES.filter(
      (m) => (assign[m.id]?.providerId || 'auto') !== 'auto' && assign[m.id].providerId === p.id,
    ).map((m) => m.label);
    const rest = providers.list.filter((q) => q.id !== p.id);
    const msg = usedBy.length
      ? `服务商「${p.name}」正被以下模块使用：${usedBy.join('、')}。删除后这些模块将回落到默认服务商，确定删除？`
      : `删除服务商「${p.name}」？`;
    if (!window.confirm(msg)) return;
    patchProviders({
      list: rest,
      ...(providers.activeId === p.id ? { activeId: rest[0]?.id || null } : {}),
    });
    // 挑选了该服务商的模块回落为 auto
    for (const m of MODULES) {
      if (assign[m.id]?.providerId === p.id) patchAssign(m.id, { providerId: 'auto' });
    }
    notifyProvidersChanged();
  };

  const testProvider = async () => {
    const baseUrl = (editing?.baseUrl || '').trim();
    if (!baseUrl) return;
    setTest({ state: 'loading' });
    try {
      const res = await fetch('/api/ai/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `${normalizeBaseUrl(baseUrl)}/chat/completions`,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${editing.apiKey || ''}` },
          body: { model: 'gpt-4o-mini', max_tokens: 4, messages: [{ role: 'user', content: 'ping' }] },
        }),
      });
      const data = await res.json().catch(() => ({}));
      // 401/404 等业务错误也证明「连得上」：地址可达且接口返回了结构化错误
      const errMsg = typeof data?.error === 'string' ? data.error : data?.error?.message;
      if (!res.ok && !errMsg) throw new Error(`HTTP ${res.status}`);
      setTest({
        state: 'ok',
        msg: res.ok
          ? '✓ 连接成功（接口可达且返回正常）'
          : `△ 接口可达（返回：${errMsg}）—— 地址没问题，请确认 Key 与模型名`,
      });
    } catch (e) {
      setTest({ state: 'fail', msg: `✗ ${e?.message || '连接失败'}` });
    }
  };

  const labelOf = (p) => `${p.name}${providerReady(p) ? '' : '（未配置 Key）'}`;

  return (
    <SectionCard
      id="ai-providers"
      icon={Server}
      title="AI 服务商"
      desc="全站唯一配置 AI 接口的地方：翻译、AI 对话、AI 代码补全都在这里挑选服务商，模块内只选模型。"
    >
      {/* 服务商列表 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs font-medium">
            服务商（点击设为默认；铅笔编辑连接信息）
          </p>
          <button
            type="button"
            onClick={startNew}
            disabled={!!editing}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Plus className="size-3.5" />
            添加服务商
          </button>
        </div>
        {providers.list.length === 0 && !editing && (
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            尚无服务商 —— 添加一个（名称 + OpenAI 兼容 Base URL + API Key），
            翻译 / AI 对话 / AI 代码补全即可挑选使用。
          </p>
        )}
        <ul className="space-y-1">
          {providers.list.map((p) => {
            const active = p.id === providers.activeId;
            return (
              <li
                key={p.id}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                  active ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground'
                }`}
              >
                <button
                  type="button"
                  onClick={() => patchProviders({ activeId: p.id })}
                  className={`flex min-w-0 flex-1 items-center gap-2 text-left`}
                  title={active ? '当前默认服务商' : '点击设为默认'}
                >
                  <span className="shrink-0">{active ? <Check className="size-3.5" /> : <span className="inline-block size-3.5" />}</span>
                  <span className="shrink-0 font-medium text-foreground">{p.name}</span>
                  <span className="truncate font-mono text-[11px]">{p.baseUrl}</span>
                  <span
                    className={`shrink-0 rounded px-1 text-[10px] ${
                      providerReady(p) ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                    }`}
                  >
                    {providerReady(p) ? '就绪' : '缺 Key'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(p)}
                  aria-label={`编辑 ${p.name}`}
                  title="编辑"
                  className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-colors"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeProvider(p)}
                  aria-label={`删除 ${p.name}`}
                  title="删除"
                  className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-colors"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>

        {/* 编辑表单 */}
        {editing && (
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">{editing.id ? '编辑服务商' : '新增服务商'}</p>
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setTest(null);
                }}
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
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </Field>
              <Field label="Base URL" hint="OpenAI 兼容接口地址（自动补 /v1）">
                <input
                  className={inputCls}
                  placeholder="https://api.example.com/v1"
                  value={editing.baseUrl}
                  onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="API Key" hint="仅保存在本机浏览器">
                  <input
                    className={inputCls}
                    type="password"
                    placeholder="sk-..."
                    value={editing.apiKey}
                    onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                  />
                </Field>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={saveEditing}
                className="bg-primary text-primary-foreground rounded-md px-2.5 py-1 text-xs font-medium"
              >
                {editing.id ? '保存修改' : '添加'}
              </button>
              <button
                type="button"
                onClick={testProvider}
                disabled={!editing.baseUrl.trim() || test?.state === 'loading'}
                className="bg-background hover:bg-accent rounded-md border px-2.5 py-1 text-xs text-foreground transition-colors disabled:opacity-50"
              >
                {test?.state === 'loading' ? '测试中…' : '测试连接'}
              </button>
              {test && test.state !== 'loading' && (
                <span className={`text-[11px] ${test.state === 'ok' ? 'text-emerald-500' : 'text-red-400'}`}>
                  {test.msg}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 模块挑选 */}
      <SubBlock
        title="功能模块挑选"
        hint="每个模块只能从上方服务商中挑选一个并可覆盖模型；「跟随默认」= 使用上面勾选的默认服务商。"
      >
        <div className="space-y-3">
          {MODULES.map((m) => {
            const cur = assign[m.id] || { providerId: 'auto', model: '' };
            return (
              <div key={m.id} className="grid gap-2 sm:grid-cols-2">
                <Field label={m.label}>
                  <select
                    className={inputCls}
                    value={cur.providerId || 'auto'}
                    onChange={(e) => patchAssign(m.id, { providerId: e.target.value })}
                  >
                    <option value="auto">跟随默认{providers.activeId ? `（${labelOf(providers.list.find((p) => p.id === providers.activeId) || { name: '?' })}）` : ''}</option>
                    {providers.list.map((p) => (
                      <option key={p.id} value={p.id}>
                        {labelOf(p)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="模型覆盖" hint="留空 = 使用下方常用模型列表首个 / 服务商默认">
                  <input
                    className={inputCls}
                    list="ac-global-models"
                    placeholder="留空用默认"
                    value={cur.model || ''}
                    onChange={(e) => patchAssign(m.id, { model: e.target.value.trim() })}
                  />
                </Field>
              </div>
            );
          })}
          <datalist id="ac-global-models">
            {AI_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </SubBlock>

      <ToggleRow
        label="旧版「翻译 AI」独立配置已收敛"
        hint="历史版本的翻译 / 对话接口配置已在首次打开本页时自动迁移为全局服务商，无需重复填写。"
        checked
        onChange={() => {}}
        disabled
      />
    </SectionCard>
  );
}
