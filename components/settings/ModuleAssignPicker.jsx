'use client';

/**
 * 功能模块挑选组件（共享）：翻译 / AI 对话 / AI 代码补全三个模块各渲染一份。
 * 服务商下拉（跟随默认 + 服务商列表）+ 模型下拉（限所选服务商 models，
 * datalist 允许自由手填）+ 思考深度 + 是否经本站转发开关；
 * resolveProxy 判定强制转发 / 本地服务时显示对应徽章。
 * 挑选结果持久化在主设置 aiAssign[moduleId]（settings.jsx 的 setSettings）。
 */

import { useMemo } from 'react';

import { useSettings } from '@/components/settings';
import {
  AI_MODELS,
  isLocalHost,
  normalizeAssign,
  normalizeProviders,
  providerEndpointBase,
  providerReady,
  resolveProxy,
} from '@/lib/ai-providers';
import { Field, inputCls, ToggleSwitch } from './controls';

const THINKING_OPTIONS = [
  { id: 'off', label: '关闭' },
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
];

export default function ModuleAssignPicker({ moduleId, label }) {
  const { settings, setSettings } = useSettings();
  const providers = normalizeProviders(settings.aiProviders);
  const assign = normalizeAssign(settings.aiAssign?.[moduleId]);

  const patchAssign = (p) =>
    setSettings((prev) => ({
      ...prev,
      aiAssign: {
        ...(prev.aiAssign || {}),
        [moduleId]: {
          ...(prev.aiAssign?.[moduleId] || { providerId: 'auto', model: '' }),
          ...p,
        },
      },
    }));

  const activeProvider = providers.list.find((p) => p.id === providers.activeId) || null;
  const providerLabel = (p) => `${p.name}${providerReady(p) ? '' : '（未配置 Key）'}`;

  // 所选服务商（auto → 默认服务商）与其模型列表
  const selectedId = !assign.providerId || assign.providerId === 'auto' ? providers.activeId : assign.providerId;
  const selected = providers.list.find((q) => q.id === selectedId) || null;
  const models = selected?.models || [];

  // 转发决策与徽章（基于所选服务商的 baseUrl）
  const { proxy, forced, local } = useMemo(
    () => resolveProxy(settings, moduleId),
    [settings, moduleId],
  );
  const baseLocal = selected ? isLocalHost(selected.baseUrl) : false;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-foreground text-[13px] font-medium">{label}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="服务商" hint="接口地址与 API Key 在上方服务商列表统一配置">
          <select
            className={inputCls}
            value={assign.providerId || 'auto'}
            onChange={(e) => patchAssign({ providerId: e.target.value, model: '' })}
          >
            <option value="auto">
              跟随默认{activeProvider ? `（${providerLabel(activeProvider)}）` : ''}
            </option>
            {providers.list.map((p) => (
              <option key={p.id} value={p.id}>
                {providerLabel(p)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="模型"
          hint={
            models.length
              ? `来自服务商模型列表（${models.length} 个）`
              : '该服务商还没有模型列表 —— 点上方服务商名称进去拉取或手工添加'
          }
        >
          <input
            className={inputCls}
            list={`ac-assign-models-${moduleId}`}
            placeholder="留空 = 用服务商第一个模型"
            value={assign.model || ''}
            onChange={(e) => patchAssign({ model: e.target.value.trim() })}
          />
          <datalist id={`ac-assign-models-${moduleId}`}>
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
            {AI_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="思考深度" hint="off 时不带思考字段；低/中/高映射到 reasoning_effort 或 thinking budget（服务不支持时被忽略）">
          <select
            className={inputCls}
            value={assign.thinking || 'off'}
            onChange={(e) => patchAssign({ thinking: e.target.value })}
          >
            {THINKING_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5">
          <div className="min-w-0 space-y-0.5">
            <p className="text-[13px] font-medium">经过本站转发</p>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              请求经 /api/ai/proxy 服务端中转（绕 CORS / 混合内容）；默认关闭、浏览器直连。
            </p>
          </div>
          <div className="pt-0.5">
            <ToggleSwitch
              checked={!!proxy}
              onChange={(v) => patchAssign({ proxy: v })}
              label={`${label}经过本站转发`}
            />
          </div>
        </div>
      </div>
      {(forced || baseLocal || local) && (
        <div className="flex flex-wrap gap-1.5">
          {forced && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500">
              自动转发：https→http 混合内容
            </span>
          )}
          {baseLocal && (
            <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-500">
              本地服务：转发不可达，保持直连
            </span>
          )}
        </div>
      )}
      {selected && providerEndpointBase(selected) && (
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          当前接口：{providerEndpointBase(selected)} · 模型 {assign.model || '（服务商第一个）'} · 转发{' '}
          {proxy ? '开' : '关'}
          {forced ? '（混合内容强制）' : ''}
        </p>
      )}
    </div>
  );
}
