'use client';

/**
 * 设置页「AI 服务商」分区：全站唯一配置 AI 接口地址 / API Key 的地方。
 * 服务商注册表（新增/编辑/复制/删除、点击名称进入编辑器管理模型列表，
 * 支持从 OpenAI / Anthropic 兼容端点 GET /models 拉取并筛选勾选）。
 * 分区内部两个子标签页：「功能模块挑选」（翻译 / AI 对话 / AI 代码补全三个
 * ModuleAssignPicker：服务商/模型/思考深度/本站转发）与「AI 代码补全」
 * （内嵌补全行为配置）。底部附全部设置导出/导入。
 */

import { useRef, useState } from 'react';
import { Check, Copy, FileJson, Pencil, Plus, Server, Trash2, Upload } from 'lucide-react';

import { useSettings } from '@/components/settings';
import { Spinner } from '@/components/ui/LoadingOverlay';
import { toast } from '@/lib/toast';
import { makeProviderId, normalizeProviders, providerReady } from '@/lib/ai-providers';
import { exportAllSettings, importAllSettings, SETTING_KEYS, validateImportPayload } from '@/lib/settings-io';
import AiCompletionSettingsSection from '@/components/compiler/AiCompletionSettingsSection';
import ModuleAssignPicker from './ModuleAssignPicker';
import ProviderEditor from './ProviderEditor';
import { SectionCard, SubBlock } from './controls';

const MODULES = [
  { id: 'translation', label: '翻译' },
  { id: 'chat', label: 'AI 对话' },
  { id: 'completion', label: 'AI 代码补全' },
];

const SUB_TABS = [
  { id: 'assign', label: '功能模块挑选' },
  { id: 'completion', label: 'AI 代码补全' },
];

export default function AiProviderSection() {
  const { settings, setSettings } = useSettings();
  const providers = normalizeProviders(settings.aiProviders);
  const assign = settings.aiAssign || {};
  const [subTab, setSubTab] = useState('assign');
  const [editing, setEditing] = useState(null); // Provider 对象（含完整表单字段）| null
  const [test, setTest] = useState(null); // { state, msg }
  // 设置导入导出状态
  const [ioMsg, setIoMsg] = useState(null); // { ok, msg }
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState('merge');
  const fileRef = useRef(null);

  const patchProviders = (p) =>
    setSettings((prev) => ({
      ...prev,
      aiProviders: { ...(prev.aiProviders || { list: [], activeId: null }), ...p },
    }));
  const patchAssign = (moduleId, p) =>
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
  // 广播服务商变化：同页其他分区（如 AI 补全）即时刷新挑选下拉
  const notifyProvidersChanged = () => window.dispatchEvent(new Event('ac-providers-changed'));

  const saveProvider = (form) => {
    const clean = {
      id: form.id || makeProviderId(),
      name: (form.name || '').trim(),
      note: (form.note || '').trim(),
      apiFormat: form.apiFormat,
      baseUrl: (form.baseUrl || '').trim(),
      apiKey: form.apiKey || '',
      models: [...new Set((form.models || []).map((m) => String(m).trim()).filter(Boolean))],
    };
    if (form.id) {
      patchProviders({
        list: providers.list.map((p) => (p.id === form.id ? clean : p)),
      });
    } else {
      patchProviders({
        list: [...providers.list, clean],
        ...(providers.activeId ? {} : { activeId: clean.id }),
      });
    }
    // 模块当前挑选的模型不在该服务商列表里时清掉覆盖（回退到服务商列表挑选）
    setEditing(null);
    setTest(null);
    notifyProvidersChanged();
  };

  const copyProvider = (p) => {
    const id = makeProviderId();
    patchProviders({
      list: [
        ...providers.list,
        {
          ...p,
          id,
          name: `${p.name} 副本`,
        },
      ],
    });
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
    for (const m of MODULES) {
      if (assign[m.id]?.providerId === p.id) patchAssign(m.id, { providerId: 'auto', model: '' });
    }
    notifyProvidersChanged();
  };

  /* ---------------- 设置导入导出 ---------------- */

  const doExport = () => {
    const name = exportAllSettings();
    if (name) {
      setIoMsg({ ok: true, msg: `已导出 ${SETTING_KEYS.length} 类设置 → ${name}` });
      toast.success(`设置已导出：${name}`);
    }
  };

  const onImportFile = async (file) => {
    if (!file) return;
    setIoMsg(null);
    setImporting(true);
    toast.info('正在解析导入设置…');
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      setImporting(false);
      setIoMsg({ ok: false, msg: '文件不是有效的 JSON' });
      toast.error('导入失败：文件不是有效的 JSON');
      return;
    }
    const v = validateImportPayload(payload);
    if (!v.ok) {
      setImporting(false);
      setIoMsg({ ok: false, msg: v.error });
      toast.error(`导入失败：${v.error}`);
      return;
    }
    const confirmMsg =
      importMode === 'replace'
        ? `「替换模式」将先清空本机全部 ${SETTING_KEYS.length} 类设置再写入文件中的 ${v.itemCount} 类，且不可撤销。确定继续？`
        : `将把文件中的 ${v.itemCount} 类设置覆盖写入本机（未包含的类保持不变）。确定继续？`;
    if (!window.confirm(confirmMsg)) {
      setImporting(false);
      return;
    }
    try {
      const n = importAllSettings(payload, { mode: importMode });
      setImporting(false);
      setIoMsg({ ok: true, msg: `已写入 ${n} 类设置，即将刷新页面…` });
      toast.success(`导入成功：已写入 ${n} 类设置`);
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setImporting(false);
      setIoMsg({ ok: false, msg: String(e?.message || e) });
      toast.error(`导入失败：${String(e?.message || e)}`);
    }
  };

  /* ---------------- 渲染 ---------------- */

  const providerLabel = (p) => `${p.name}${providerReady(p) ? '' : '（未配置 Key）'}`;

  return (
    <SectionCard
      id="ai-providers"
      icon={Server}
      title="AI 服务商"
      desc="全站唯一配置 AI 接口的地方：翻译、AI 对话、AI 代码补全都在这里挑选服务商与模型（含思考深度与本站转发），模块内不再单独填接口。"
    >
      {/* 服务商列表 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs font-medium">
            服务商（点击名称编辑并管理模型；圆圈设为默认）
          </p>
          <button
            type="button"
            onClick={() => setEditing({ id: null, name: '', note: '', apiFormat: 'openai', baseUrl: '', apiKey: '', models: [] })}
            disabled={!!editing}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Plus className="size-3.5" />
            添加服务商
          </button>
        </div>
        {providers.list.length === 0 && !editing && (
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            尚无服务商 —— 添加一个（名称 + OpenAI/Anthropic 兼容 Base URL + API Key），
            拉取模型列表后，翻译 / AI 对话 / AI 代码补全即可挑选使用。
          </p>
        )}
        <ul className="space-y-1">
          {providers.list.map((p) => {
            const active = p.id === providers.activeId;
            return (
              <li
                key={p.id}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                  active ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground'
                }`}
              >
                <button
                  type="button"
                  onClick={() => patchProviders({ activeId: p.id })}
                  className="shrink-0"
                  title={active ? '当前默认服务商' : '点击设为默认'}
                  aria-label={`设 ${p.name} 为默认`}
                >
                  {active ? <Check className="text-primary size-4" /> : <span className="border-muted-foreground/50 inline-block size-3.5 rounded-full border" />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing({ ...p })}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title="点击编辑该服务商（名称/备注/接口/模型列表）"
                >
                  <span className="shrink-0 font-medium text-foreground">{p.name}</span>
                  {p.note && <span className="text-muted-foreground shrink-0 text-[11px]">{p.note}</span>}
                  <span className="truncate font-mono text-[11px]">{p.baseUrl}</span>
                  <span
                    className={`shrink-0 rounded px-1 text-[10px] ${
                      providerReady(p) ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                    }`}
                  >
                    {providerReady(p) ? '就绪' : '缺 Key'}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[10px]">{p.models.length} 模型</span>
                  <span className="shrink-0 rounded bg-muted px-1 text-[9px] uppercase">{p.apiFormat}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditing({ ...p })}
                  aria-label={`编辑 ${p.name}`}
                  title="编辑"
                  className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-colors"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => copyProvider(p)}
                  aria-label={`复制 ${p.name}`}
                  title="复制为新服务商"
                  className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-colors"
                >
                  <Copy className="size-3.5" />
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

        {/* 编辑器（基本信息 + 模型管理 + 端点拉取） */}
        {editing && (
          <ProviderEditor initial={editing} onCancel={() => setEditing(null)} onSave={saveProvider} />
        )}
        {test && test.state !== 'loading' && (
          <p className={`text-[11px] ${test.state === 'ok' ? 'text-emerald-500' : 'text-red-400'}`}>{test.msg}</p>
        )}
      </div>

      {/* 模块挑选 / AI 代码补全：两个子标签页 */}
      <div className="space-y-3">
        <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label="AI 服务商子页">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={subTab === t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                subTab === t.id
                  ? 'bg-primary font-medium text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {subTab === 'assign' ? (
          <SubBlock
            title="功能模块挑选"
            hint="每个模块只能从上方服务商中挑选一个；模型下拉来自所选服务商的模型列表；「跟随默认」= 使用上面勾选的默认服务商。思考深度与本站转发按模块独立设置。"
          >
            <div className="space-y-3">
              {MODULES.map((m) => (
                <ModuleAssignPicker key={m.id} moduleId={m.id} label={m.label} />
              ))}
            </div>
          </SubBlock>
        ) : (
          <AiCompletionSettingsSection />
        )}
      </div>

      {/* 全部设置导出 / 导入 */}
      <SubBlock
        title="导出 / 导入全部设置"
        hint={`覆盖本站全部 ${SETTING_KEYS.length} 类本机设置（外观/翻译/全局 AI 服务商与模块挑选/补全方案/编译器偏好/自定义主题等）。不含对话记录、代码草稿与翻译缓存等数据类内容。`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={doExport}
            className="bg-background hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-foreground transition-colors"
          >
            <FileJson className="size-3.5" />
            导出全部设置（.json）
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="bg-background hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-foreground transition-colors disabled:opacity-50"
          >
            {importing ? <Spinner className="size-3.5" /> : <Upload className="size-3.5" />}
            导入设置文件
          </button>
          <label className="text-muted-foreground flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={importMode === 'replace'}
              onChange={(e) => setImportMode(e.target.checked ? 'replace' : 'merge')}
            />
            替换模式（先清空本机同类设置再写入）
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              onImportFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        {ioMsg && (
          <p className={`text-[11px] leading-relaxed ${ioMsg.ok ? 'text-emerald-500' : 'text-red-400'}`}>
            {ioMsg.ok ? '✓ ' : '✗ '}
            {ioMsg.msg}
          </p>
        )}
      </SubBlock>
    </SectionCard>
  );
}
