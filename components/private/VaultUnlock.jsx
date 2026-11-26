'use client';

/**
 * 私有化平台的解锁卡（输入密码 → 浏览器内解密）。
 *
 * 明文只存在于这个页面的内存里：密码不上传、不进 localStorage/IndexedDB，
 * 刷新即失效（见 lib/private-store.js）。
 */

import { useId, useState } from 'react';
import { Eye, EyeOff, KeyRound, LoaderCircle, Lock, ShieldCheck, Unlock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatBytes } from '@/lib/private-vault.mjs';
import { unlockVault, usePrivateVault } from '@/lib/private-store';

export default function VaultUnlock({ contestId, label, bytes, version = null, onUnlocked }) {
  const state = usePrivateVault(contestId);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputId = useId();

  const submit = async (event) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = await unlockVault(contestId, password, version);
      setPassword('');
      onUnlocked?.(payload);
    } catch (err) {
      setError(err.message || '解锁失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex items-start gap-3">
          <div className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-lg">
            <Lock className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base leading-snug">这场比赛的题面是加密的</CardTitle>
            <CardDescription className="mt-1.5">
              仓库里只存 AES-256-GCM 密文{bytes ? `（${formatBytes(bytes)}）` : ''}。密码只在你的浏览器里派生密钥并解密，
              不会发送到服务器，也不会被保存；刷新页面后需要重新输入。
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor={inputId} className="text-sm font-medium">
            解锁「{label || contestId}」的密码
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <KeyRound className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                id={inputId}
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="输入密码…"
                className="pl-9 pr-9"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${inputId}-err` : undefined}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? '隐藏密码' : '显示密码'}
                title={show ? '隐藏密码' : '显示密码'}
                className="text-muted-foreground hover:text-foreground absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md transition-colors"
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <Button type="submit" disabled={!password || busy} className="shrink-0">
              {busy || state.status === 'loading' ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Unlock className="size-4" />
              )}
              {busy || state.status === 'loading' ? '解密中…' : '解锁'}
            </Button>
          </div>
          {error ? (
            <p id={`${inputId}-err`} className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <p className="text-muted-foreground flex items-start gap-1.5 text-[11px] leading-5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            解密在本地完成：密码经 PBKDF2（31 万轮）派生 AES-256 密钥，密文校验失败即密码错误。
            仓库维护者也无法绕过密码恢复内容。
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
