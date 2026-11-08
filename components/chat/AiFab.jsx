'use client';

/**
 * 题目页 AI 悬浮按钮（右下角）+ 对话面板。可在设置 →「AI 对话」中关闭悬浮窗。
 * OfflineIndicator（右下角、pointer-events-none、仅离线时渲染）出现时短暂叠于
 * 其上，不影响点击。
 */

import { useState } from 'react';
import { Bot } from 'lucide-react';

import { useSettings } from '@/components/settings';
import ChatPanel from './ChatPanel';

export default function AiFab({ problem }) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);

  if (settings.chat?.floatingButton === false) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="AI 对话"
        title="AI 对话（基于本题与当前代码）"
        className="bg-primary text-primary-foreground fixed right-4 bottom-5 z-40 flex size-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <Bot className="size-5" />
      </button>
      <ChatPanel problem={problem} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
