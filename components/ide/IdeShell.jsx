"use client";

/**
 * /ide 外壳：把服务端读到的 CI 记录注入 VS Code 式工作台（IdePage 为唯一状态
 * 中枢，负责布局 / 面板 / 状态栏；本组件只组装 CI 日志面板）。
 */

import IdePage from "@/components/ide/IdePage";
import CiLogPanel from "@/components/ide/CiLogPanel";

export default function IdeShell({ ciRuns, ciActionsUrl }) {
  const runs = Array.isArray(ciRuns) ? ciRuns : [];
  return (
    <IdePage
      ciRuns={runs}
      ciActionsUrl={ciActionsUrl}
      ciSlot={<CiLogPanel runs={runs} actionsUrl={ciActionsUrl} />}
    />
  );
}
