'use client';

/** 自动解锁（带密码链接 / 本机记住的密码）进行中的占位卡。 */

import { LoaderCircle, Lock } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

export default function VaultUnlocking({ label }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-6" role="status">
        <div className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-lg">
          <Lock className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">正在本地解密{label ? `「${label}」` : ''}…</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            密码不会离开这台设备，密钥在本页内派生（PBKDF2 31 万轮）。
          </p>
        </div>
        <LoaderCircle className="text-muted-foreground size-4 shrink-0 animate-spin" />
      </CardContent>
    </Card>
  );
}
