'use client';

/**
 * 设置页「AI 对话」分区：悬浮窗开关、模块挑选（ModuleAssignPicker：
 * 服务商/模型/思考深度/本站转发，接口在「AI 服务商」分区统一配置）、
 * 上下文注入开关、清空全部对话记录。
 */

import { Bot, Trash2 } from 'lucide-react';

import { useSettings } from '@/components/settings';
import { clearAllChats } from '@/lib/chat-store';
import { chatReady, resolveChatCfg } from '@/lib/chat';
import ModuleAssignPicker from './ModuleAssignPicker';
import { SectionCard, ToggleRow } from './controls';

export default function ChatSection() {
  const { settings, setSettings } = useSettings();
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

      <ModuleAssignPicker moduleId="chat" label="AI 对话" />
      <p className={`text-[11px] ${ready ? 'text-emerald-500' : 'text-amber-500'}`}>
        {ready
          ? `对话接口就绪：${cfg.baseUrl} · 模型 ${cfg.model}${cfg.proxy ? ' · 经本站转发' : ''}`
          : '尚未配置：请到「AI 服务商」分区添加服务商（Base URL + API Key）。'}
      </p>

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
