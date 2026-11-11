import fs from 'node:fs';
import path from 'node:path';

import IdeShell from '@/components/ide/IdeShell';

export const metadata = { title: 'IDE 编程台' };

const CI_LOG_FILE = path.join(process.cwd(), 'data', 'ci-log.json');
const GITHUB_ACTIONS_URL = 'https://github.com/Sam5440/ac.isam.top/actions';

/** 读取 ci-log.json（读不到 → null，由客户端页展示空态）。 */
function loadRuns() {
  try {
    const log = JSON.parse(fs.readFileSync(CI_LOG_FILE, 'utf8'));
    return Array.isArray(log?.runs) ? log.runs : [];
  } catch {
    return null;
  }
}

/**
 * /ide 在线编程工作台（v1.7 重构）：
 * - 参考 VS Code / TRAE 布局——除顶栏外全局铺满：左活动栏 + 测试面板，
 *   中多标签编辑器，右文件管理器 + AI 对话，底部终端。
 * - 额外加载最近 20 次 CI 运行记录（data/ci-log.json），展示在底部终端的
 *   「CI 日志」标签页里——IDE 内直接回答「本轮抓了什么 / 还欠什么」。
 * 页面壳本身不渲染（铺满布局），主体在 IdeShell（client）。
 */
export default function Page() {
  const runs = loadRuns();
  return <IdeShell ciRuns={runs} ciActionsUrl={GITHUB_ACTIONS_URL} />;
}
