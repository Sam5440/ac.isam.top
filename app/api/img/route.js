import { NextResponse } from 'next/server';

import {
  IMAGE_PROXY_MAX_REDIRECTS,
  MAX_IMAGE_BYTES,
  isAllowedImageContentType,
  normalizeImageProxyUrl,
} from '@/lib/image-proxy.mjs';
import { readResponseLimited, requestPinned, resolveTargetAddresses } from '@/lib/secure-proxy.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const UPSTREAM_TIMEOUT_MS = 12_000;

function fail(message, status) {
  return new NextResponse(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function requestImage(target) {
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  // 生产环境始终拒绝私网地址；本地开发常见公司 DNS 把域名解析到 198.18/15
  // 的透明代理段，若继续拦截会让图片代理在 dev 环境完全不可用。
  const blockPrivate = process.env.NODE_ENV === 'production';
  const addresses = await resolveTargetAddresses(target, { blockPrivate, signal });
  const response = await requestPinned(target, addresses, {
    method: 'GET',
    headers: {
      accept: 'image/*',
      'user-agent': 'Mozilla/5.0 (compatible; ACLibraryImageProxy/1.0)',
    },
    signal,
  });
  return { response, signal };
}

export async function GET(request) {
  const requested = new URL(request.url).searchParams.get('url');
  let target = normalizeImageProxyUrl(requested);
  if (!target) return fail('invalid image url', 400);

  try {
    for (let hop = 0; hop <= IMAGE_PROXY_MAX_REDIRECTS; hop += 1) {
      const { response } = await requestImage(target);
      const status = Number(response.statusCode) || 0;

      if (REDIRECTS.has(status)) {
        const location = response.headers.location;
        response.resume();
        if (!location) return fail('upstream redirect without location', 502);
        const next = normalizeImageProxyUrl(new URL(location, target).toString());
        if (!next) return fail('redirect target is not allowed', 403);
        target = next;
        continue;
      }

      if (status !== 200) {
        response.resume();
        return fail(`upstream status ${status || 'unknown'}`, 502);
      }

      const type = response.headers['content-type'];
      if (!isAllowedImageContentType(type)) {
        response.resume();
        return fail('upstream is not an image', 415);
      }

      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
        response.destroy();
        return fail('image too large', 413);
      }

      const body = await readResponseLimited(response, MAX_IMAGE_BYTES);
      if (!body) return fail('image too large', 413);

      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': type.split(';')[0].trim().toLowerCase(),
          'Content-Length': String(body.byteLength),
          'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Content-Disposition': 'inline',
        },
      });
    }
    return fail('too many redirects', 502);
  } catch {
    return fail('image fetch failed', 502);
  }
}
