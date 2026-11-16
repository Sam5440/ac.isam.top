'use client';

import CopyBox from '@/components/CopyBox';
import { useProblemLang } from '@/components/settings';
import { renderRich } from '@/lib/render';
import { meaningfulNote } from '@/lib/sample-notes';

/**
 * 题面样例区块：输入/输出成对展示，note（若有）作为说明附在组后。
 *
 * 样例说明的语言跟随题面语言模式（与 StatementBody 同一套 useProblemLang）：
 *   en   → 只渲染英文 note；
 *   zh   → 优先 noteZh（CI/补译脚本写入），缺失时回退英文并提示暂无译文；
 *   both → 英文 note + 中文 noteZh（与题面「对照」样式一致）。
 * 历史缺口：note 曾被当成纯英文附加信息，无论切什么语言都只显示英文。
 */
export default function SamplesSection({ samples, platform }) {
  const lang = useProblemLang(platform);
  const mode = lang?.mode === 'en' || lang?.mode === 'zh' ? lang.mode : 'both';

  if (!samples?.length) return null;
  return (
    <section className="space-y-4">
      <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">样例</h3>
      {samples.map((s, i) => {
        const en = meaningfulNote(s.note);
        const zh = typeof s.noteZh === 'string' ? s.noteZh.trim() : '';
        // zh 模式下没有译文时回退英文（不丢信息），并标注「暂无中文译文」。
        const showEn = Boolean(en) && (mode !== 'zh' || !zh);
        const showZh = Boolean(zh) && mode !== 'en';
        const missingZh = Boolean(en) && !zh && mode === 'zh';
        return (
          <div key={i} className="space-y-2">
            {s.input != null && <CopyBox label={`Input #${i + 1}`} text={s.input} />}
            {s.output != null && <CopyBox label={`Output #${i + 1}`} text={s.output} tone="green" />}
            {showEn ? (
              <div
                className="text-muted-foreground md-body text-sm"
                data-note-lang="en"
                dangerouslySetInnerHTML={{ __html: renderRich(en) }}
              />
            ) : null}
            {showZh ? (
              <div
                className={
                  mode === 'both'
                    ? 'stmt-zh border-primary/40 text-muted-foreground mt-1 border-l-2 pl-3 text-[13px] md-body'
                    : 'text-muted-foreground md-body text-sm'
                }
                data-note-lang="zh"
                dangerouslySetInnerHTML={{ __html: renderRich(zh) }}
              />
            ) : null}
            {missingZh ? (
              <div className="text-muted-foreground/70 text-[11px]">（样例说明暂无中文译文）</div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
