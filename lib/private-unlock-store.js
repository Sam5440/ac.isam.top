'use client';

/**
 * 「30 天免密」的 localStorage 读写层（键 `ac-private-unlock-v1`）。
 *
 * 与 lib/private-store.js 的分工：那个模块只管**本次会话内存里的明文**，
 * 这个模块只管**用户显式选择记住的密码**。两者都不上传、不进 IndexedDB。
 * 用户随时可以「重新上锁」清掉单场记录，或在私有化首页一键清空本机全部记录。
 */

import { useEffect, useState } from 'react';

import {
  UNLOCK_STORAGE_KEY,
  createUnlockRecord,
  normalizeUnlockStore,
  unlockDaysLeft,
} from './private-unlock.mjs';

const listeners = new Set();

function emit() {
  for (const fn of listeners) fn();
}

function storage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function writeAll(store, records) {
  try {
    if (Object.keys(records).length) store.setItem(UNLOCK_STORAGE_KEY, JSON.stringify(records));
    else store.removeItem(UNLOCK_STORAGE_KEY);
  } catch {
    // 隐私模式 / 配额满：静默降级为「本次会话有效」
  }
}

/** 读出全部未过期记录，顺手清掉过期项。 */
export function readSavedUnlocks(now = Date.now()) {
  const store = storage();
  if (!store) return {};
  let raw = null;
  try {
    raw = store.getItem(UNLOCK_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  const alive = normalizeUnlockStore(raw, now);
  let storedCount = 0;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) storedCount = Object.keys(parsed).length;
  } catch {
    storedCount = 0;
  }
  if (Object.keys(alive).length !== storedCount) {
    writeAll(store, alive);
  }
  return alive;
}

/** 单场记录（已过期视为不存在）。 */
export function savedUnlock(id, now = Date.now()) {
  return readSavedUnlocks(now)[String(id ?? '')] ?? null;
}

/** 记住一场的密码（默认 30 天）。 */
export function saveUnlock(id, password, now = Date.now()) {
  const key = String(id ?? '');
  const record = createUnlockRecord(password, now);
  const store = storage();
  if (!key || !record || !store) return null;
  const next = { ...readSavedUnlocks(now), [key]: record };
  writeAll(store, next);
  emit();
  return record;
}

/** 清除单场记录（重新上锁时调用）。 */
export function clearSavedUnlock(id) {
  const key = String(id ?? '');
  const store = storage();
  if (!key || !store) return;
  const next = readSavedUnlocks();
  if (!(key in next)) return;
  delete next[key];
  writeAll(store, next);
  emit();
}

/** 清空本机记住的全部密码。返回清除条数。 */
export function clearAllSavedUnlocks() {
  const store = storage();
  if (!store) return 0;
  const count = Object.keys(readSavedUnlocks()).length;
  try {
    store.removeItem(UNLOCK_STORAGE_KEY);
  } catch {}
  emit();
  return count;
}

/**
 * 组件用：订阅本机已记住的场次表。
 *
 * 首帧必须是空表：服务端渲染读不到 localStorage，若渲染期直接读会在
 * hydration 时与服务端文本不一致（React #418）。挂载后再填真值。
 */
export function useSavedUnlocks() {
  const [records, setRecords] = useState({});
  useEffect(() => {
    const refresh = () => setRecords(readSavedUnlocks());
    refresh();
    listeners.add(refresh);
    const onStorage = (event) => {
      if (event.key === UNLOCK_STORAGE_KEY || event.key == null) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return records;
}

export { unlockDaysLeft };
