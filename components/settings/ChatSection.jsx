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
import { SectionCard, SegButtons, ToggleRow } from './controls';

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
      <ToggleRow
        label="对话自动附带题目样例"
        hint="上下文中的样例输入输出（默认前三组）。关闭后 AI 只看到题面，回答更聚焦思路。"
        checked={chat.includeSamples !== false}
        onChange={(v) => patchChat({ includeSamples: v })}
      />
      <ToggleRow
        label="附带最近一次编译器运行结果"
        hint="在题目页跑过样例后，发送消息时自动附上编译错误或各样例判定/耗时，AI 能直接帮你 Debug。"
        checked={chat.includeRunErrors !== false}
        onChange={(v) => patchChat({ includeRunErrors: v })}
      />

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs font-medium">面板显示模式</p>
        <SegButtons
          ariaLabel="面板显示模式"
          value={chat.displayMode === 'sidebar' ? 'sidebar' : 'float'}
          onChange={(v) => patchChat({ displayMode: v })}
          options={[
            { id: 'float', label: '浮窗' },
            { id: 'sidebar', label: '侧边栏' },
          ]}
        />
        <p className="text-muted-foreground/70 text-[11px] leading-relaxed">
          浮窗：视口居中的可拖拽窗口（头部拖动、右下角缩放）；侧边栏：右侧滑入抽屉。移动端一律全屏。
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          对话记录按多会话保存在本机浏览器（每会话上限 60 条，每题最多 20 个会话）。
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
