'use client';

/**
 * 设置页「AI 对话」分区：悬浮窗开关、接口来源（默认复用翻译 AI / 独立配置）、
 * 上下文注入开关、清空全部对话记录。
 */

import { Bot, Trash2 } from 'lucide-react';

import { useSettings } from '@/components/settings';
import { AI_MODELS } from '@/components/ai-translate';
import { clearAllChats } from '@/lib/chat-store';
import { chatReady, resolveChatCfg } from '@/lib/chat';
import { Field, inputCls, SectionCard, ToggleRow } from './controls';

export default function ChatSection() {
  const { settings, setSettings, aiReady } = useSettings();
  const chat = settings.chat || {};

  const patchChat = (p) => setSettings((prev) => ({ ...prev, chat: { ...(prev.chat || {}), ...p } }));

  const cfg = resolveChatCfg(settings);
  const ready = chatReady(cfg);

  const clearAll = () => {
    const n = clearAllChats();
    window.alert(n ? `已清空 ${n} 个会话记录。` : '没有可清空的对话记录。');
  };

  return (
    <SectionCard
      id="chat"
      icon={Bot}
      title="AI 对话"
      desc="题目页右下角的 AI 悬浮窗：基于当前题面与编辑器代码直接对话。"
    >
      <ToggleRow
        label="题目页 AI 悬浮窗"
        hint="在题目页右下角显示 AI 对话入口按钮（悬浮窗内也可随时关闭上下文）。"
        checked={chat.floatingButton !== false}
        onChange={(v) => patchChat({ floatingButton: v })}
      />

      <ToggleRow
        label="复用「AI（用户自定义翻译）」的接口配置"
        hint="开启后对话直接使用翻译分区里已配置的 Base URL / Key / 模型，无需重复填写；关闭后可为对话单独配置一套接口。"
        checked={chat.useTranslationAi !== false}
        onChange={(v) => patchChat({ useTranslationAi: v })}
      />

      {chat.useTranslationAi !== false ? (
        <p className={`rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed ${ready ? 'text-emerald-500 border-emerald-500/30' : 'text-amber-500 border-amber-500/40'}`}>
          {ready
            ? `当前对话接口：${cfg.baseUrl} · 模型 ${cfg.model}`
            : '翻译 AI 尚未配置：请先在「翻译」分区填写 Base URL 与 API Key。'}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Base URL" hint="OpenAI 兼容接口地址">
            <input
              className={inputCls}
              placeholder="https://api.example.com"
              value={chat.baseUrl || ''}
              onChange={(e) => patchChat({ baseUrl: e.target.value.trim() })}
            />
          </Field>
          <Field label="API Key">
            <input
              className={inputCls}
              type="password"
              placeholder="sk-..."
              value={chat.apiKey || ''}
              onChange={(e) => patchChat({ apiKey: e.target.value.trim() })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="模型" hint="可从常用模型中选择或输入任意模型名">
              <input
                className={inputCls}
                list="ac-chat-models"
                placeholder="deepseek-v4-flash"
                value={chat.model || ''}
                onChange={(e) => patchChat({ model: e.target.value.trim() })}
              />
              <datalist id="ac-chat-models">
                {AI_MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
          </div>
          <p className={`text-[11px] sm:col-span-2 ${ready ? 'text-emerald-500' : 'text-amber-500'}`}>
            {ready ? `对话接口就绪：${cfg.baseUrl} · 模型 ${cfg.model}` : 'Base URL / API Key / 模型 填写完整后可用。'}
          </p>
        </div>
      )}

      <ToggleRow
        label="对话自动附带当前题面"
        hint="发送消息时把题目标题、题面（Markdown，自动截断）、样例与时间/内存限制放入系统上下文，AI 能直接针对本题作答。"
        checked={chat.includeStatement !== false}
        onChange={(v) => patchChat({ includeStatement: v })}
      />
      <ToggleRow
        label="对话自动附带当前编辑器代码"
        hint="编译器面板打开时，把当前草稿代码一并放入上下文，可直接让 AI 解释 / 修改代码。"
        checked={chat.includeCode !== false}
        onChange={(v) => patchChat({ includeCode: v })}
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          每题的对话记录保存在本机浏览器（每会话上限 60 条）。
        </p>
        <button
          type="button"
          onClick={clearAll}
          className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors"
        >
          <Trash2 className="size-3.5" />
          清空全部对话记录
        </button>
      </div>
    </SectionCard>
  );
}
