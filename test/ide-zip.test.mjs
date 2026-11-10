import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, buildZip } from '../lib/ide-zip.js';

/** lib/ide-zip.js：CRC32 已知值 + buildZip 结构回读校验（store-only ZIP）。 */

test('crc32: 已知输入命中标准值', () => {
  assert.equal(crc32('123456789'), 0xcbf43926);
  assert.equal(crc32(''), 0x00000000);
  assert.equal(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

function readUdv(bytes) {
  return {
    u16: (off) => bytes[off] | (bytes[off + 1] << 8),
    u32: (off) => (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0,
    str: (off, len) => Buffer.from(bytes.slice(off, off + len)).toString('utf8'),
    bytes: (off, len) => bytes.slice(off, off + len),
  };
}

test('buildZip: central directory 回读，签名/CRC/尺寸/UTF-8 flag 一致', async () => {
  const blob = buildZip([
    { name: 'main.cpp', data: new TextEncoder().encode('#include <bits/stdc++.h>\nint main(){}\n') },
    { name: '答案.py', data: 'print("你好")\n' },
  ]);
  assert.equal(blob.type, 'application/zip');
  const buf = new Uint8Array(await blob.arrayBuffer());
  const d = readUdv(buf);

  // local header 签名 + UTF-8 flag + store method
  assert.equal(d.u32(0), 0x04034b50);
  assert.equal(d.u16(6) & 0x0800, 0x0800);
  assert.equal(d.u16(8), 0);

  // 找 EOCD
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (d.u32(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd > 0, 'EOCD 存在');
  assert.equal(d.u16(eocd + 10), 2); // 条目数

  // central directory 起始位置逐条解析
  let pos = d.u32(eocd + 16);
  const names = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(d.u32(pos), 0x02014b50, `central entry ${i} 签名`);
    const flags = d.u16(pos + 8);
    const method = d.u16(pos + 10);
    const sum = d.u32(pos + 16);
    const size = d.u32(pos + 24);
    const nameLen = d.u16(pos + 28);
    const localOff = d.u32(pos + 42);
    const name = d.str(pos + 46, nameLen);
    names.push(name);

    // CRC 与文件数据一致
    const localNameLen = d.u16(localOff + 26);
    const localExtraLen = d.u16(localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const fileBytes = d.bytes(dataStart, size);
    assert.equal(crc32(fileBytes), sum, `${name} CRC 回读一致`);
    assert.equal(method, 0, 'store-only');
    assert.equal(flags & 0x0800, 0x0800, 'UTF-8 flag bit 11');
    pos += 46 + nameLen;
  }
  assert.deepEqual(names, ['main.cpp', '答案.py']);
});

test('buildZip: 空清单产出合法空 ZIP', async () => {
  const blob = buildZip([]);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const d = readUdv(buf);
  assert.equal(d.u32(0), 0x06054b50);
  assert.equal(d.u16(8), 0);
});
