'use client';

/**
 * 设置页「通用」分区里的关于 / 数据块（v1.8）：版本与更新日志、项目仓库、清除本机翻译缓存。
 */

import GithubMark from '@/components/GithubMark';
import { clearZhCache } from '@/lib/zh-store';
import { APP_VERSION, CHANGELOG } from '@/lib/changelog';
import { Group, Pad, Row, SmallButton } from './controls';

/** 清除本机翻译缓存（实时翻译的结果），清除后刷新页面。 */
export function ClearZhCacheRow() {
  return (
    <Row label="本机翻译缓存" hint="各翻译渠道实时请求回来的译文保存在本机；清除后会重新请求，并刷新页面。">
      <SmallButton
        onClick={async () => {
          if (!window.confirm('清除本机翻译缓存并刷新页面？')) return;
          await clearZhCache();
          window.location.reload();
        }}
      >
        清除
      </SmallButton>
    </Row>
  );
}

export default function AboutSection() {
  return (
    <Group
      title="关于"
      right={
        <span className="rounded-md border border-primary/60 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-foreground">
          当前 v{APP_VERSION}
        </span>
      }
    >
      <Row label="项目仓库">
        <a
          href="https://github.com/Sam5440/ac.isam.top"
          target="_blank"
          rel="noreferrer"
          className="hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-foreground transition-colors"
        >
          <GithubMark className="size-3.5 shrink-0" />
          本站 Sam5440/ac.isam.top
        </a>
        <a
          href="https://github.com/Sam5440/ys_problem_web"
          target="_blank"
          rel="noreferrer"
          className="hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-foreground transition-colors"
        >
          <GithubMark className="size-3.5 shrink-0" />
          参考 ys_problem_web
        </a>
      </Row>
      <Pad>
        <p className="text-muted-foreground text-xs font-medium">更新日志（共 {CHANGELOG.length} 个版本）</p>
        <div className="space-y-1.5">
          {CHANGELOG.map((v, i) => (
            <details key={v.version} className="rounded-md border px-2.5 py-2" open={i === 0}>
              <summary className="cursor-pointer text-xs">
                <span className="font-medium">v{v.version}</span>{' '}
                <span className="text-muted-foreground ml-1">{v.date}</span> <span>{v.title}</span>
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
      </Pad>
    </Group>
  );
}
