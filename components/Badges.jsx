import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { platformOf } from '@/lib/platforms';
import { ratingColor } from '@/lib/render';

/**
 * 列表对齐：题目 / 比赛列表把徽章当作「列」使用时传 fixed，徽章取固定宽度并
 * 居中，使 AtCoder / Codeforces / 牛客、带 ⌀ 前缀的难度与「未评级」等不同长度
 * 的内容在各行之间纵向对齐（宽度按最长内容「Codeforces」「⌀ 3999」「未评级」取）。
 */
export const BADGE_COL = {
  platform: 'w-[6.5rem] justify-center',
  difficulty: 'w-[4.25rem] justify-center',
  translated: 'w-[3.75rem] justify-center',
};

/** `hideBelow="sm"`：窄屏隐藏（列表行在手机上把宽度留给标题）。 */
const HIDE = { sm: 'hidden sm:inline-flex', md: 'hidden md:inline-flex' };

export function PlatformBadge({ platform, fixed = false, hideBelow }) {
  const p = platformOf(platform);
  if (!p) return null;
  return (
    <Badge variant="secondary" className={`gap-1.5 ${fixed ? `shrink-0 ${BADGE_COL.platform}` : ''} ${HIDE[hideBelow] || ''}`}>
      <span className={`size-1.5 rounded-full ${p.dot}`} />
      {p.label}
    </Badge>
  );
}

export function DifficultyBadge({ difficulty, platform, fixed = false }) {
  const col = fixed ? `shrink-0 ${BADGE_COL.difficulty}` : '';
  if (difficulty == null) {
    return (
      <Badge variant="outline" className={`text-muted-foreground ${col}`}>
        未评级
      </Badge>
    );
  }
  const v = Math.max(0, Math.round(difficulty));
  const color = ratingColor(v);
  const label = platform === 'atcoder' ? `⌀ ${v}` : String(v);
  return (
    <Badge
      variant="outline"
      className={`border-transparent font-mono font-semibold text-white tabular-nums ${col}`}
      style={{ background: color }}
    >
      {label}
    </Badge>
  );
}

export function TranslatedBadge({ translated, fixed = false, hideBelow }) {
  const col = `${fixed ? `shrink-0 ${BADGE_COL.translated}` : ''} ${HIDE[hideBelow] || ''}`;
  return translated ? (
    <Badge variant="outline" className={`border-emerald-500/40 bg-emerald-500/10 text-emerald-500 ${col}`}>
      已翻译
    </Badge>
  ) : (
    <Badge variant="outline" className={`text-muted-foreground ${col}`}>
      仅原文
    </Badge>
  );
}

export function ProblemLink({ problem, children, className }) {
  return (
    <Link
      href={`/problems/${problem.platform}/${encodeURIComponent(problem.id)}`}
      className={className}
    >
      {children}
    </Link>
  );
}
