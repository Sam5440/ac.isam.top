'use client';

/**
 * 设置页「AI 助手 → AI 对话」组（v1.8）：悬浮窗开关、显示模式、上下文注入
 * 开关、清空全部对话记录。对话用哪个服务商 / 模型在同分区「各功能使用的模型」挑选。
 */

import { Trash2 } from 'lucide-react';

import { useSettings } from '@/components/settings';
import { clearAllChats } from '@/lib/chat-store';
import { chatReady, resolveChatCfg } from '@/lib/chat';
import { Group, Row, SegButtons, SmallButton, SwitchRow } from './controls';

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
    <Group
      title="AI 对话"
      desc={
        ready
          ? `接口就绪：${cfg.baseUrl} · 模型 ${cfg.model}${cfg.proxy ? ' · 经本站转发' : ''}`
          : '尚未配置可用的服务商 —— 先在上方添加服务商（Base URL + API Key）。'
      }
    >
      <SwitchRow
        label="题目页 AI 悬浮按钮"
        hint="在题目页右下角显示 AI 对话入口。"
        checked={chat.floatingButton !== false}
        onChange={(v) => patchChat({ floatingButton: v })}
      />
      <Row label="面板显示方式" hint="浮窗：可拖拽、可缩放的窗口；侧边栏：右侧滑入抽屉。手机上一律全屏。">
        <SegButtons
          ariaLabel="面板显示模式"
          value={chat.displayMode === 'sidebar' ? 'sidebar' : 'float'}
          onChange={(v) => patchChat({ displayMode: v })}
          options={[
            { id: 'float', label: '浮窗' },
            { id: 'sidebar', label: '侧边栏' },
          ]}
        />
      </Row>
      <SwitchRow
        label="自动附带当前题面"
        hint="把题目标题、题面（自动截断）与时间 / 内存限制放入上下文，AI 能直接针对本题作答。"
        checked={chat.includeStatement !== false}
        onChange={(v) => patchChat({ includeStatement: v })}
      />
      <SwitchRow
        label="自动附带题目样例"
        hint="附带样例输入输出（默认前三组）。关闭后 AI 只看题面，回答更聚焦思路。"
        checked={chat.includeSamples !== false}
        onChange={(v) => patchChat({ includeSamples: v })}
      />
      <SwitchRow
        label="自动附带编辑器代码"
        hint="编译器面板打开时，把当前代码草稿一并放入上下文，可直接让 AI 解释 / 修改。"
        checked={chat.includeCode !== false}
        onChange={(v) => patchChat({ includeCode: v })}
      />
      <SwitchRow
        label="自动附带最近一次运行结果"
        hint="跑过样例后，附上编译错误或各样例判定 / 耗时，方便 AI 帮你 Debug。"
        checked={chat.includeRunErrors !== false}
        onChange={(v) => patchChat({ includeRunErrors: v })}
      />
      <Row label="对话记录" hint="保存在本机浏览器：每会话最多 60 条，每题最多 20 个会话。">
        <SmallButton onClick={clearAll}>
          <Trash2 className="size-3.5" />
          清空全部
        </SmallButton>
      </Row>
    </Group>
  );
}
