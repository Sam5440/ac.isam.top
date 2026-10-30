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
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const OUT = path.resolve(process.cwd(), 'public', 'compiler');
const SLUG = process.env.RUNTIME_REPO || 'Sam5440/ys_problem_web';
const BRANCH = process.env.RUNTIME_BRANCH || 'data/runtime';
const FILES = ['clang22', 'clang22-noeh', 'lld22', 'lld22-noeh', 'sysroot22.tar', 'memfs', 'manifest.json'];

async function main() {
  if (!process.env.FORCE_RUNTIME && fs.existsSync(path.join(OUT, 'manifest.json'))) {
    console.log('fetch-runtime: public/compiler/manifest.json 已存在，跳过');
    return;
  }
  const url = `https://codeload.github.com/${SLUG}/tar.gz/refs/heads/${BRANCH}`;
  console.log(`fetch-runtime: 下载 ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`codeload HTTP ${res.status}`);
  const workdir = await mkdtemp(path.join(tmpdir(), 'ac-runtime-'));
  const tgz = path.join(workdir, 'runtime.tar.gz');
  await pipeline(res.body, createWriteStream(tgz));
  await new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', tgz, '-C', workdir], (err, _so, se) =>
      err ? reject(new Error(`tar extract failed: ${String(se).slice(-200)}`)) : resolve(),
    );
  });
  const root = path.join(workdir, (await readdir(workdir)).find((d) => d.endsWith(BRANCH.replace(/\//g, '-'))));
  const src = path.join(root, 'public', 'compiler');
  if (!fs.existsSync(src)) throw new Error(`runtime 分支中未找到 public/compiler（root=${root}）`);
  await rm(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of FILES) {
    const from = path.join(src, f);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(OUT, f));
  }
  await rm(workdir, { recursive: true, force: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
  console.log(`fetch-runtime: 完成 — ${Object.keys(manifest).join(', ') || 'manifest'}`);
}

main().catch((e) => {
  console.error('fetch-runtime failed:', e.message);
  process.exitCode = 1;
});
