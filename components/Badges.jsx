import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { platformOf } from '@/lib/platforms';
import { ratingColor } from '@/lib/render';

export function PlatformBadge({ platform }) {
  const p = platformOf(platform);
  if (!p) return null;
  return (
    <Badge variant="secondary" className="gap-1.5">
      <span className={`size-1.5 rounded-full ${p.dot}`} />
      {p.label}
    </Badge>
  );
}

export function DifficultyBadge({ difficulty, platform }) {
  if (difficulty == null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
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
      className="border-transparent font-mono font-semibold text-white"
      style={{ background: color }}
    >
      {label}
    </Badge>
  );
}

export function TranslatedBadge({ translated }) {
  return translated ? (
    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
      已翻译
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
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
