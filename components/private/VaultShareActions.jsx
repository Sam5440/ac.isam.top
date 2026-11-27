'use client';

/**
 * 解锁后的两个动作：
 *  - 复制带密码链接（`#p=` 里是 base64url 编码的密码，打开即自动解密）；
 *  - 重新上锁（同时清掉本机 30 天记录）。
 *
 * 密码只从内存态取（lib/private-store.js 的 unlockedVaultPassword），
 * 页面刷新后没有密码就不会渲染复制按钮。
 */

import { useState } from 'react';
import { Check, Link2, Lock, LockOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { buildShareHref, stripShareToken, unlockDaysLeft } from '@/lib/private-unlock.mjs';
import { clearSavedUnlock, useSavedUnlocks } from '@/lib/private-unlock-store';
import { lockVault, unlockedVaultPassword, usePrivateVault } from '@/lib/private-store';

export default function VaultShareActions({ contestId, className = '' }) {
  usePrivateVault(contestId);
  const saved = useSavedUnlocks();
  const [copied, setCopied] = useState(false);
  const password = unlockedVaultPassword(contestId);
  const record = saved[contestId] ?? null;
  const daysLeft = unlockDaysLeft(record);

  const copy = async () => {
    if (!password) return;
    const href = buildShareHref(contestId, password, window.location.origin);
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('复制这个带密码链接（打开即自动解锁）：', href);
    }
  };

  const relock = () => {
    clearSavedUnlock(contestId);
    lockVault(contestId);
    // 地址里如果还残留密码参数，一并抹掉。
    const next = stripShareToken(window.location.href);
    if (next !== window.location.href) window.history.replaceState(window.history.state, '', next);
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {record ? (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
          <LockOpen className="size-3" />
          本机免密 {daysLeft} 天
        </span>
      ) : null}
      {password ? (
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
          {copied ? '已复制' : '复制带密码链接'}
        </Button>
      ) : null}
      <Button type="button" variant="outline" size="sm" onClick={relock}>
        <Lock className="size-3.5" />
        重新上锁
      </Button>
    </div>
  );
}
