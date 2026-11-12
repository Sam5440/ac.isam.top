/**
 * 题面展示器：PDF 题面同屏展示「远端原站 PDF 内嵌」+「提取出的文字题面」。
 *
 * PDF 原件一律不入库（仓库只存提取文本），iframe 直接加载原站地址；
 * 原站受 Cloudflare 保护，未在当前浏览器通过质询时内嵌可能空白，
 * 因此同时给出「新窗口打开」入口，且下方文字题面始终可用。
 */

import { ExternalLink, FileText } from 'lucide-react';

import StatementBody from '@/components/StatementBody';

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
  return (
    <div className="space-y-6">
      {hasPdf ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <FileText className="size-4" />
              PDF 原件（远端内嵌）
            </h3>
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
          <iframe
            src={pdfUrl}
            title="PDF 题面"
            loading="lazy"
            referrerPolicy="no-referrer"
            className="border-border bg-background h-[78vh] w-full rounded-lg border"
          />
          <p className="text-muted-foreground text-[11px] leading-5">
            内嵌空白通常是原站 Cloudflare 质询拦截（它对本域外嵌有 SAMEORIGIN 限制）：
            先在浏览器打开一次
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary mx-1 underline-offset-4 hover:underline"
            >
              原题 PDF
            </a>
            通过质询后刷新本页即可；下方的提取文本不依赖原站，可直接阅读。
          </p>
        </section>
      ) : null}

      <section className="space-y-2">
        {hasPdf ? (
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <FileText className="size-4" />
            提取文本
          </h3>
        ) : null}
        {hasText ? (
          <StatementBody
            code={code}
            platform={platform}
            segments={segments}
            title={title}
            titleZh={titleZh}
            zhModel={zhModel}
          />
        ) : (
          <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            该 PDF 未能提取出文字，请查看上方内嵌 PDF 或点「原题」前往原站。
          </div>
        )}
      </section>
    </div>
  );
}
