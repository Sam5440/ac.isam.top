#!/usr/bin/env node
/**
 * 构建期拉取浏览器端 C++ 编译运行时到 public/compiler/（gitignored）。
 *
 * 二进制来自 Sam5440/ys_problem_web 的 data/runtime 分支（同一维护者构建的
 * cppstudio-io/wasm-clang-runtime v0.1.0：clang22/lld22 + wasi-sdk 33 sysroot
 * + memfs，见其 scripts/build-cpp-runtime.mjs）。经 codeload 匿名下载 tarball
 * 后解包 —— 与该仓库 prepare-build.mjs 的数据自举同款机制（Vercel 构建容器
 * 无法可靠 git fetch 其它 ref，codeload 对公开仓库是匿名 HTTP）。
 *
 * 已存在 manifest.json 时跳过（本地重复构建零开销）；FORCE_RUNTIME=1 强制重拉。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const OUT = path.resolve(process.cwd(), 'public', 'compiler');
const SLUG = process.env.RUNTIME_REPO || 'Sam5440/ys_problem_web';
const COMMIT = process.env.RUNTIME_COMMIT || '8ef570b6173f40071c4f5852a6424ac70bbe773c';
const FILES = ['clang22', 'clang22-noeh', 'lld22', 'lld22-noeh', 'sysroot22.tar', 'memfs', 'manifest.json'];
const EXPECTED_BLOBS = {
  clang22: 'd9bb2060b787b138daef13f8f5a7b7a125b81e3a',
  'clang22-noeh': 'e1caa246331d1a13537758a15a1e9288e8ff875e',
  lld22: 'a50cf92b03f8ccfb8d2bad60c3bd2789507d0ef1',
  'lld22-noeh': 'ba4126d5ca16578b2b172ce2c4c44c080db33d6e',
  'sysroot22.tar': '059da01fd7b3d7b108e8f8bd0e70eb0649b3eb9e',
  memfs: '892d731e9aa0eb63d98b3e5d584f0e41265dfc63',
  'manifest.json': '036789be60d2b48385a0c1f149c2531e2b227361',
};

function blobSha(file) {
  const bytes = fs.readFileSync(file);
  return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function localRuntimeValid() {
  if (!fs.existsSync(path.join(OUT, 'manifest.json'))) return false;
  return FILES.every((file) => fs.existsSync(path.join(OUT, file)) && blobSha(path.join(OUT, file)) === EXPECTED_BLOBS[file]);
}

async function main() {
  if (!process.env.FORCE_RUNTIME && localRuntimeValid()) {
    console.log('fetch-runtime: public/compiler/manifest.json 已存在，跳过');
    return;
  }
  const url = `https://codeload.github.com/${SLUG}/tar.gz/${COMMIT}`;
  console.log(`fetch-runtime: 下载 ${url}`);
  // 超时护栏（审查 管线-5:无超时的挂起会占满 Vercel 构建时长）
    const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
    const contentLength = Number(res.headers.get('content-length')) || 0;
    if (contentLength > 256 * 1024 * 1024) throw new Error('runtime archive is unexpectedly large');
  if (!res.ok) throw new Error(`codeload HTTP ${res.status}`);
  const workdir = await mkdtemp(path.join(tmpdir(), 'ac-runtime-'));
  try {
    const tgz = path.join(workdir, 'runtime.tar.gz');
    await pipeline(res.body, createWriteStream(tgz));
    await new Promise((resolve, reject) => {
      execFile('tar', ['--no-same-owner', '-xzf', tgz, '-C', workdir], (err, _so, se) =>
        err ? reject(new Error(`tar extract failed: ${String(se).slice(-200)}`)) : resolve(),
      );
    });
    const rootName = (await readdir(workdir)).find((d) => d !== 'runtime.tar.gz');
    const src = path.join(workdir, rootName || '', 'public', 'compiler');
    if (!fs.existsSync(src)) throw new Error(`runtime commit 中未找到 public/compiler（root=${rootName || 'unknown'}）`);
    const missing = FILES.filter((f) => !fs.existsSync(path.join(src, f)));
    if (missing.length) throw new Error(`runtime 产物缺少文件：${missing.join(', ')}`);
    for (const f of FILES) {
      const file = path.join(src, f);
      const bytes = fs.readFileSync(file);
      const sha = blobSha(file);
      if (sha !== EXPECTED_BLOBS[f]) throw new Error(`runtime ${f} 摘要不匹配：${sha}`);
    }
    const staging = path.join(workdir, 'compiler');
    fs.mkdirSync(staging, { recursive: true });
    for (const f of FILES) fs.copyFileSync(path.join(src, f), path.join(staging, f));
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const old = `${OUT}.old-${process.pid}`;
    if (fs.existsSync(OUT)) fs.renameSync(OUT, old);
    fs.renameSync(staging, OUT);
    await rm(old, { recursive: true, force: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
    console.log(`fetch-runtime: 完成 — commit=${COMMIT} ${Object.keys(manifest).join(', ') || 'manifest'}`);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('fetch-runtime failed:', e.message);
  process.exitCode = 1;
});
