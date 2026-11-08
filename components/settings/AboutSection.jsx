'use client';

/**
 * 设置页「关于」分区：更新日志、项目仓库、清除本机翻译缓存。
 */

import GithubMark from '@/components/GithubMark';
import { clearZhCache } from '@/lib/zh-store';
import { APP_VERSION, CHANGELOG } from '@/lib/changelog';
import { SectionCard } from './controls';

export default function AboutSection() {
  return (
    <SectionCard id="about" icon={GithubMark} title="关于" desc="更新日志、项目仓库与本机缓存管理。">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs font-medium">更新日志（共 {CHANGELOG.length} 个版本）</p>
          <span className="shrink-0 rounded-md border border-primary/60 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-foreground">
            当前 v{APP_VERSION}
          </span>
        </div>
        <div className="space-y-1.5">
          {CHANGELOG.map((v, i) => (
            <details key={v.version} className="rounded-md border px-2.5 py-2" open={i === 0}>
              <summary className="cursor-pointer text-xs">
                <span className="font-medium">v{v.version}</span>{' '}
                <span className="text-muted-foreground ml-1">{v.date}</span>{' '}
                <span>{v.title}</span>
              </summary>
              <ul className="mt-1.5 space-y-1">
                {v.changes.map((c, j) => (
                  <li key={j} className="text-muted-foreground text-[11px] leading-relaxed">
                    {c}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs font-medium">项目仓库</p>
        <div className="space-y-1">
          <a
            href="https://github.com/Sam5440/ac.isam.top"
            target="_blank"
            rel="noreferrer"
            className="hover:bg-accent flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs text-foreground transition-colors"
          >
            <GithubMark className="size-3.5 shrink-0" />
            <span className="font-medium">本站仓库</span>
            <span className="text-muted-foreground">Sam5440/ac.isam.top</span>
          </a>
          <a
            href="https://github.com/Sam5440/ys_problem_web"
            target="_blank"
            rel="noreferrer"
            className="hover:bg-accent flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs text-foreground transition-colors"
          >
            <GithubMark className="size-3.5 shrink-0" />
            <span className="font-medium">参考项目</span>
            <span className="text-muted-foreground">Sam5440/ys_problem_web</span>
          </a>
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={async () => {
            await clearZhCache();
            window.location.reload();
          }}
          className="text-muted-foreground hover:text-foreground rounded-md border px-2.5 py-1.5 text-xs transition-colors"
        >
          清除本机翻译缓存
        </button>
      </div>
    </SectionCard>
  );
}
