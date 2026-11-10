import { createProxyHandler } from '@/lib/ai-proxy.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export const POST = createProxyHandler();
