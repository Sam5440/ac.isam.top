'use client';

/**
 * 题面展示器：PDF 题面默认显示原件（内嵌浏览器 PDF 阅读器），
 * 用户可手动切到「文字题面」看提取文本/翻译对照；非 PDF 题直接走 StatementBody。
 */

import { ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';

import StatementBody from '@/components/StatementBody';

const tabClass = (active) =>
  `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
  }`;

export default function ProblemStatementViewer({
  platform,
  code,
  segments,
  title,
  titleZh,
  zhModel,
  hasPdf,
  hasText,
  pdfUrl,
}) {
  const [mode, setMode] = useState(hasPdf ? 'pdf' : 'text');

  if (!hasPdf) {
    return (
      <StatementBody
        code={code}
        platform={platform}
        segments={segments}
        title={title}
        titleZh={titleZh}
        zhModel={zhModel}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="border-border bg-muted/40 inline-flex rounded-lg border p-1">
          <button type="button" className={tabClass(mode === 'pdf')} onClick={() => setMode('pdf')}>
            <FileText className="size-3.5" />
            PDF 原件
          </button>
          <button
            type="button"
            className={tabClass(mode === 'text')}
            onClick={() => setMode('text')}
            disabled={!hasText}
            title={hasText ? undefined : '该 PDF 未能提取出文字'}
          >
            文字题面
            {hasText ? '' : '（不可用）'}
          </button>
        </div>
        <a
          href={pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          新窗口打开 PDF
          <ExternalLink className="size-3" />
        </a>
      </div>

      {mode === 'pdf' ? (
        <iframe
          src={pdfUrl}
          title="PDF 题面"
          className="border-border bg-background h-[78vh] w-full rounded-lg border"
        />
      ) : (
        <StatementBody
          code={code}
          platform={platform}
          segments={segments}
          title={title}
          titleZh={titleZh}
          zhModel={zhModel}
        />
      )}
    </div>
  );
}
