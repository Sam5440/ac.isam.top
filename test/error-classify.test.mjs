import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyClientError } from '../lib/error-classify.mjs';

// 规格见 lib/error-classify.mjs 头部注释：换版残留 vs 服务端渲染错误 vs 未知。

test('classifyClientError: 旧构建残留 → stale', () => {
  const cases = [
    'ChunkLoadError: Loading chunk 7822 failed.',
    'Loading chunk 1255 failed.\n(error: https://ac.yslsy.top/_next/static/chunks/1255-abc.js)',
    'Failed to fetch dynamically imported module: https://ac.yslsy.top/_next/static/chunks/app/x.js',
    'error loading dynamically imported module: https://ac.yslsy.top/_next/static/chunks/app/x.js',
    'Importing a module script failed.', // Safari
    'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
    'TypeError: Cannot read properties of undefined (reading \'call\')',
    "SyntaxError: Unexpected token '<', \"<!DOCTYPE htm\" is not valid JSON",
  ];
  for (const msg of cases) assert.equal(classifyClientError(msg), 'stale', msg);
});

test('classifyClientError: 服务端渲染错误 → server', () => {
  assert.equal(
    classifyClientError(
      'An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.',
    ),
    'server',
  );
  assert.equal(classifyClientError('Failed to find Server Component for module {"id":"7411"}'), 'server');
});

test('classifyClientError: 其它运行时异常 → unknown', () => {
  const cases = [
    "TypeError: Cannot read properties of null (reading 'foo')",
    'Error: Minified React error #418; visit https://react.dev/errors/418',
    'Hydration failed because the server rendered text did not match the client.',
    'boom',
  ];
  for (const msg of cases) assert.equal(classifyClientError(msg), 'unknown', msg);
});

test('classifyClientError: 空值/非字符串容错', () => {
  assert.equal(classifyClientError(undefined), 'unknown');
  assert.equal(classifyClientError(null), 'unknown');
  assert.equal(classifyClientError(''), 'unknown');
  assert.equal(classifyClientError({ message: 'Loading chunk 1 failed.' }), 'unknown');
});
