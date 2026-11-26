'use client';

/**
 * 私有化平台的前端会话存储（只活在内存里）。
 *
 * 设计约束：**密码与明文都不落盘**。
 *  - 不用 localStorage / sessionStorage / IndexedDB 存密码或解密结果：
 *    一旦落盘，同机其它页面脚本、浏览器扩展、共享设备都能直接读到，
 *    「仅在用户前端解密」就成了空话。
 *  - 刷新即失效；用户重新输密码是刻意的代价。
 *  - 同一场解锁后，场内的题目切换（下一题 / 题号条）复用内存里的明文。
 *
 * 订阅模型与 lib/zh-store.js 一致：模块级 Map + 监听器，组件用
 * usePrivateVault() 取当前状态。
 */

import { useEffect, useReducer } from 'react';

import { VaultDecryptError, decryptVaultEnvelope, vaultFileHref } from './private-vault.mjs';

/** id → { status, payload?, envelope?, error? }；status: idle|loading|unlocked|error */
const vaults = new Map();
const listeners = new Set();
const inflight = new Map();

function emit() {
  for (const fn of listeners) fn();
}

function setState(id, next) {
  vaults.set(id, next);
  emit();
}

export function subscribePrivateVault(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getVaultState(id) {
  return vaults.get(String(id ?? '')) ?? { status: 'idle' };
}

/** 当前会话里所有已解锁的比赛 id（内存态）。 */
export function unlockedVaultIds() {
  return [...vaults.entries()].filter(([, v]) => v.status === 'unlocked').map(([id]) => id);
}

/** 锁定一场（切走 / 手动上锁）；不影响其它场次。 */
export function lockVault(id) {
  if (vaults.has(String(id))) setState(String(id), { status: 'idle' });
}

/**
 * 拉密文并用密码解密。成功返回载荷，失败抛错并把状态置为 error。
 * 同一场的并发请求合并（连点「解锁」不会跑两遍 KDF）。
 */
export async function unlockVault(id, password) {
  const key = String(id ?? '');
  if (!key) throw new VaultDecryptError('缺少比赛 id');
  if (inflight.has(key)) return inflight.get(key);
  const task = (async () => {
    setState(key, { status: 'loading' });
    try {
      const res = await fetch(vaultFileHref(key), { credentials: 'same-origin' });
      if (res.status === 404) throw new VaultDecryptError('仓库里没有这场私有化比赛的密文');
      if (!res.ok) throw new VaultDecryptError(`密文下载失败（HTTP ${res.status}）`);
      const envelope = await res.json();
      const payload = await decryptVaultEnvelope(envelope, password);
      setState(key, { status: 'unlocked', payload, envelope });
      return payload;
    } catch (err) {
      setState(key, {
        status: 'error',
        error: err instanceof VaultDecryptError ? err.message : `解锁失败：${err.message}`,
      });
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

/** 组件用：订阅指定比赛的内存状态。 */
export function usePrivateVault(id) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => subscribePrivateVault(force), []);
  return getVaultState(id);
}

/** 组件用：订阅「任意一场」的状态变化（列表页刷新「已解锁」标记）。 */
export function usePrivateVaultList() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => subscribePrivateVault(force), []);
  return unlockedVaultIds();
}
