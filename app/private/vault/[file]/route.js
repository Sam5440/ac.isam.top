/**
 * 私有化密文下载端点：/private/vault/<id>.json
 *
 * 刻意**不**放在 /api 下：SW 对 /api/* 一律直连（见 lib/pwa/sw-source.js），
 * 而密文是静态内容、适合走 CDN；放在页面路径下又能被 SW 的页面缓存策略覆盖，
 * 离线时仍可解锁已下载过的比赛。
 *
 * 响应体是 AES-GCM 信封，服务端从不持有密钥。
 */

import { findVaultEntry, getVaultEnvelope, listVaultContests } from '@/lib/private-data.mjs';

export const dynamic = 'force-static';

export function generateStaticParams() {
  // 构建期把已知密文预渲染成静态文件（体积小、可缓存）
  return listVaultContests().map((c) => ({ file: c.file }));
}

export async function GET(request, { params }) {
  const { file } = await params;
  const id = String(file ?? '').replace(/\.json$/i, '');
  const entry = findVaultEntry(id);
  if (!entry || entry.file !== file) {
    return Response.json({ error: '密文不存在' }, { status: 404 });
  }
  const envelope = getVaultEnvelope(id);
  if (!envelope) return Response.json({ error: '密文不存在' }, { status: 404 });
  return Response.json(envelope, {
    headers: {
      // 密文可以长缓存：内容不可变，改题目必然换密码/换 id
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'X-Robots-Tag': 'noindex',
    },
  });
}
