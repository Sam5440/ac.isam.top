'use client';

/**
 * 私有化平台首页：/contests/private
 *
 * 三块内容：
 *  1. 已入库的加密场次（点击 → 输入密码 → 浏览器内解密）；
 *  2. 「添加提示词」——交给任意 AI Agent 就能按同一格式产出载荷；
 *  3. 「加密代码用法」——本地跑 scripts/private-vault.mjs 生成密文再 PR。
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  FileLock2,
  KeyRound,
  Lock,
  ShieldCheck,
  Terminal,
  Unlock,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PRIVATE_PROMPT, PRIVATE_USAGE } from '@/lib/private-guide.mjs';
import { formatBytes } from '@/lib/private-vault.mjs';
import { usePrivateVaultList } from '@/lib/private-store';
import { formatDateTime } from '@/lib/utils';

function CopyButton({ text, label = '复制' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0">
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? '已复制' : label}
    </Button>
  );
}

function Collapsible({ title, description, icon: Icon, text, children }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="cursor-pointer select-none" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-start gap-3">
          <div className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {title}
              <ChevronDown className={`text-muted-foreground size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <CopyButton text={text} />
          </div>
        </div>
      </CardHeader>
      {open ? (
        <CardContent className="space-y-3">
          <pre className="bg-muted/50 max-h-[28rem] overflow-auto rounded-lg border p-3 text-[11.5px] leading-5 whitespace-pre-wrap">
            {text}
          </pre>
          {children}
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function PrivateHub({ contests = [] }) {
  const unlocked = usePrivateVaultList();
  const unlockedSet = useMemo(() => new Set(unlocked), [unlocked.join('|')]);
  const total = contests.reduce((sum, c) => sum + (c.bytes ?? 0), 0);

  return (
    <div className="space-y-6 py-10">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">私有化</h1>
          <Badge variant="secondary" className="gap-1">
            <Lock className="size-3" />
            端到端加密
          </Badge>
        </div>
        <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-6">
          这里的题目只以密文存放在 GitHub 仓库里。你输入密码后，密钥在本地派生、题面在本地解密，
          服务器与构建流程从不接触明文；密码不会被保存，刷新页面即重新上锁。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="text-muted-foreground text-xs">已入库场次</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{contests.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-muted-foreground text-xs">密文总体积</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{formatBytes(total)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-muted-foreground text-xs">本会话已解锁</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{unlocked.length}</div>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <FileLock2 className="size-4" />
          加密场次
        </h2>
        {contests.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground p-8 text-center text-sm">
              还没有私有化比赛。按下面的提示词整理题面，用加密脚本入库后即可出现在这里。
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {contests.map((c) => (
                <Link
                  key={c.id}
                  href={`/contests/private/${encodeURIComponent(c.id)}`}
                  className="hover:bg-accent/40 flex flex-wrap items-center gap-3 px-4 py-3 transition-colors"
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-md ${
                      unlockedSet.has(c.id) ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {unlockedSet.has(c.id) ? <Unlock className="size-4" /> : <Lock className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.label}</span>
                    <span className="text-muted-foreground block truncate font-mono text-[11px]">{c.id}</span>
                  </span>
                  <Badge variant="outline" className="text-muted-foreground shrink-0 font-mono tabular-nums">
                    {formatBytes(c.bytes)}
                  </Badge>
                  <span className="text-muted-foreground hidden shrink-0 text-xs tabular-nums sm:block">
                    {formatDateTime(c.createdAt)}
                  </span>
                  <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
                    {unlockedSet.has(c.id) ? '已解锁' : '输入密码'}
                    <ArrowRight className="size-3.5" />
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="size-4" />
          添加新比赛
        </h2>
        <p className="text-muted-foreground text-sm leading-6">
          把下面这段提示词交给任意 AI Agent（或自己照着做），它会产出符合本站格式的明文载荷；
          再用第二段命令在本地加密。仓库里只会多出密文与一条索引记录。
        </p>
        <Collapsible
          title="① 添加提示词"
          description="整段复制给 AI，附带题目来源（链接 / 题册 HTML / PDF 提取文本）。"
          icon={FileLock2}
          text={PRIVATE_PROMPT}
        >
          <p className="text-muted-foreground text-[11px] leading-5">
            提示词里已经写死了字段、样例与公式约定；Agent 产出后先用
            <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono">scripts/private-vault.mjs pack</code>
            校验并加密，载荷不合法会直接报错，不会写出半成品。
          </p>
        </Collapsible>
        <Collapsible
          title="② 加密代码用法"
          description="Node 22 本地执行：PBKDF2-HMAC-SHA256（31 万轮）+ AES-256-GCM。"
          icon={Terminal}
          text={PRIVATE_USAGE}
        >
          <div className="text-muted-foreground space-y-2 text-[11.5px] leading-6">
            <p>
              <strong className="text-foreground">密码怎么选：</strong>
              密码不会入库，忘记就无法恢复（AES-GCM 没有后门）。建议 12 位以上、只通过私下渠道告诉需要的人。
            </p>
            <p>
              <strong className="text-foreground">改了题目怎么办：</strong>
              用同一个 id 重新 pack 即可覆盖密文；密码也可以换（密文里带自己的盐与 IV）。
            </p>
            <p>
              <strong className="text-foreground">PR 里能看到什么：</strong>
              只有 <code className="bg-muted rounded px-1 py-0.5 font-mono">data/private/vault/&lt;id&gt;.json</code>{' '}
              与索引里的场次名 / 体积 / 时间，题名、题面、样例、图片全部是密文。
            </p>
          </div>
        </Collapsible>
        <div className="text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed p-3 text-[11.5px] leading-5">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>
            安全边界：本站没有服务端数据库，也没有任何「找回密码」接口。加密只能防止仓库与 CDN 泄漏内容，
            不能防止拿到密码的人转发题面。
          </span>
        </div>
      </section>
    </div>
  );
}
