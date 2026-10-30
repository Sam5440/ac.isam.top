'use client';

import { Languages } from 'lucide-react';
import { useState } from 'react';

/**
 * 中英双语题面切换。服务端已把两个语种分别渲染成 HTML 字符串传入
 * （renderRich），这里只负责 Tab 状态与切换，避免客户端重复解析 Markdown。
 */
export default function StatementTabs({ zhHtml, enHtml, translated, model, translatedAt }) {
  const hasZh = Boolean(zhHtml);
  const [tab, setTab] = useState(hasZh ? 'zh' : 'en');
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="bg-muted text-muted-foreground inline-flex rounded-lg p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setTab('zh')}
            disabled={!hasZh}
            className={`rounded-md px-3 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              tab === 'zh' ? 'bg-background text-foreground shadow-sm' : ''
            }`}
          >
            中文翻译
          </button>
          <button
            type="button"
            onClick={() => setTab('en')}
            className={`rounded-md px-3 py-1 transition-colors ${
              tab === 'en' ? 'bg-background text-foreground shadow-sm' : ''
            }`}
          >
            原文 (English)
          </button>
        </div>
        {hasZh && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Languages className="size-3.5" />
            {model ? `AI 翻译 · ${model}` : 'AI 翻译'}
            {translatedAt ? ` · ${translatedAt.slice(0, 10)}` : ''}
          </span>
        )}
        {!hasZh && (
          <span className="text-amber-500 inline-flex items-center gap-1 text-xs">
            ⚠ 本题翻译尚未生成，将随下次 CI 自动补充
          </span>
        )}
      </div>
      <div
        className="md-body"
        // 服务端 renderRich 输出的可信 HTML（数据来自站内 data/ 目录）
        dangerouslySetInnerHTML={{ __html: (tab === 'zh' ? zhHtml : enHtml) || '' }}
      />
    </div>
  );
}
