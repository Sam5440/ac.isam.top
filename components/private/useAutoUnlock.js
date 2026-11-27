'use client';

/**
 * 打开私有化比赛/题目页时自动解锁：
 *  1. 地址里带密码（`#p=…` 或 `?p=…`）→ 直接解密，成功后把密码从地址栏抹掉；
 *  2. 否则查本机「记住 30 天」的记录 → 直接解密；
 *  3. 都没有才显示解锁卡。
 *
 * 同一场只自动尝试一次：失败后交给用户手输，避免错误密码反复跑 PBKDF2。
 */

import { useEffect, useRef } from 'react';

import { readShareTokenFromUrl, stripShareToken } from '@/lib/private-unlock.mjs';
import { clearSavedUnlock, savedUnlock, saveUnlock } from '@/lib/private-unlock-store';
import { unlockVault, usePrivateVault } from '@/lib/private-store';

export default function useAutoUnlock(contestId, version = null) {
  const state = usePrivateVault(contestId);
  const attempted = useRef(null);

  useEffect(() => {
    if (!contestId) return;
    if (state.status === 'unlocked') {
      // 已在内存里解锁（同会话切页）时打开带密码链接：仍要把密码从地址栏抹掉。
      const next = stripShareToken(window.location.href);
      if (next !== window.location.href) window.history.replaceState(window.history.state, '', next);
      return;
    }
    if (state.status === 'loading') return;
    if (attempted.current === contestId) return;

    const fromUrl = readShareTokenFromUrl(window.location.href);
    const saved = fromUrl ? null : savedUnlock(contestId);
    const password = fromUrl?.password || saved?.password;
    if (!password) return;

    attempted.current = contestId;
    unlockVault(contestId, password, version)
      .then(() => {
        // 带密码链接进来等同于用户明确要求解锁，顺手记住 30 天。
        saveUnlock(contestId, password);
      })
      .catch(() => {
        // 本机记住的密码失效（例如上传者换过密码）：清掉，避免下次继续失败。
        if (saved) clearSavedUnlock(contestId);
      })
      .finally(() => {
        // 带密码链接：无论成败都立刻从地址栏移除，避免截图/复制页面地址时泄漏。
        if (!fromUrl) return;
        const next = stripShareToken(window.location.href);
        if (next !== window.location.href) {
          window.history.replaceState(window.history.state, '', next);
        }
      });
  }, [contestId, version, state.status]);

  return state;
}
