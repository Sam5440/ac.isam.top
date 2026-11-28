'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useSettings } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { imgDedup } from '@/lib/img-dedup';
import { renderRich } from '@/lib/render';
import { translationAppearance } from '@/lib/translation-style.mjs';
import { cn } from '@/lib/utils';

export default function TranslationBlock({
  markdown, sourceChip = '', seenSrcs, className, paired = false, original = false, ...props
}) {
  const { settings } = useSettings();
  const appearance = useMemo(() => translationAppearance(settings.zhStyle), [settings.zhStyle]);
  const { html, hasProse } = useMemo(() => {
    const rendered = renderRich(markdown, { translation: !original });
    const deduped = seenSrcs ? imgDedup(rendered, seenSrcs) : rendered;
    const withChip = /<\/p>\s*$/.test(deduped)
      ? deduped.replace(/<\/p>(\s*)$/, (_, trailing) => `${sourceChip}</p>${trailing}`)
      : deduped + sourceChip;
    return { html: withChip, hasProse: rendered.includes('<span data-zh-prose="">') };
  }, [markdown, original, seenSrcs, sourceChip]);
  const masking = !original && hasProse && settings.zhStyle.presets?.includes('mask');
  const [revealed, setRevealed] = useState(false);
  useEffect(() => setRevealed(false), [markdown, masking]);

  if (original) return <div className={className} {...props} dangerouslySetInnerHTML={{ __html: html }} />;

  return (
    <div
      className={cn('zh-styled', paired && 'zh-paired', masking && 'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1.5', className)}
      lang="zh-Hans"
      data-zh-revealed={masking && revealed ? '' : undefined}
      {...props}
      {...appearance}
    >
      <div className="zh-copy min-w-0" dangerouslySetInnerHTML={{ __html: html }} />
      {masking && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-10 shrink-0 cursor-pointer sm:size-8"
          aria-label={revealed ? '隐藏译文' : '显示译文'}
          aria-pressed={revealed}
          title={revealed ? '隐藏译文' : '显示译文'}
          onClick={() => setRevealed((previous) => !previous)}
        >
          {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      )}
    </div>
  );
}
