/**
 * /ci 抓取日志页：服务端组件读 data/ci-log.json（scripts/fetch.mjs 每轮
 * 写入，最新在前，上限 30 条），交给客户端 CiDashboard 渲染——
 * 统计卡片（带 Sparkline）、每日运行柱状图、成功率环、单轮产出对比图、
 * 平台产出拆分、时间线式可展开运行卡片；GitHub Actions 最近运行经匿名
 * API 在客户端实时合并（空跑/取消的运行也有轻量卡片）。
 */

import fs from 'node:fs';
import path from 'node:path';

import { ArrowUpRight } from 'lucide-react';

import CiDashboard from '@/components/ci/CiDashboard';
import { Button } from '@/components/ui/button';
import { ScrollText } from 'lucide-react';

export const metadata = { title: '抓取日志' };

// 数据由 GitHub Actions 每小时抓取并提交，这里 5 分钟重新验证即可
export const revalidate = 300;

const CI_LOG_FILE = path.join(process.cwd(), 'data', 'ci-log.json');
const GITHUB_ACTIONS_URL = 'https://github.com/Sam5440/ac.isam.top/actions';

function loadRuns() {
  try {
    const log = JSON.parse(fs.readFileSync(CI_LOG_FILE, 'utf8'));
    return Array.isArray(log?.runs) ? log.runs : [];
  } catch {
    return [];
  }
}

export default function CiPage() {
  const runs = loadRuns();

  return (
    <div className="space-y-6 py-10">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <ScrollText className="size-7" />
          抓取日志
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          GitHub Actions 每小时运行一次抓取与翻译管线（错峰 23 分）。统计图表汇总最近
          {' '}60 天的运行；展开任一次运行可查看逐题抓取明细、平台产出、未完成任务、下次计划与错误信息。
        </p>
      </div>

      {runs.length === 0 ? (
        <div className="py-16 text-center">
          <ScrollText className="text-muted-foreground mx-auto size-10" />
          <p className="mt-4 font-medium">暂无运行记录</p>
          <p className="text-muted-foreground mt-2 text-sm">
            抓取管线首次运行后，运行记录会写入 data/ci-log.json 并展示在这里。
          </p>
          <Button asChild variant="outline" className="mt-6">
            <a href={GITHUB_ACTIONS_URL} target="_blank" rel="noreferrer">
              查看 GitHub Actions
              <ArrowUpRight className="size-4" />
            </a>
          </Button>
        </div>
      ) : (
        <CiDashboard runs={runs} actionsUrl={GITHUB_ACTIONS_URL} />
      )}
    </div>
  );
}
