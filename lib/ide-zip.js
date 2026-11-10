/**
 * 无依赖 ZIP writer（纯模块，node --test 可测）：仅 store（method 0）不压缩，
 * 供文件管理器「全部下载」把 IDE 工作区打包。结构：local file header +
 * 文件数据 ×N → central directory → EOCD；文件名统一按 UTF-8 编码并置
 * general purpose flag bit 11（0x0800）。数据为 Uint8Array（或字符串自动编码）。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32（IEEE 802.3，zlib 同款）：入参 Uint8Array 或字符串（UTF-8 编码）。 */
export function crc32(input) {
  const data =
    input instanceof Uint8Array ? input : new TextEncoder().encode(String(input ?? ''));
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const day =
    ((Math.max(0, date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, day };
}

/**
 * 打包。@param {Array<{name:string, data:Uint8Array|string}>} entries
 * @returns {Blob} application/zip（node 18+ 也有 Blob，可直接 arrayBuffer() 校验）
 */
export function buildZip(entries) {
  const enc = new TextEncoder();
  const { time, day } = dosDateTime(new Date());
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries ?? []) {
    const nameBytes = enc.encode(String(entry.name ?? 'unnamed'));
    const data =
      entry.data instanceof Uint8Array ? entry.data : enc.encode(String(entry.data ?? ''));
    const sum = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed to extract
    lv.setUint16(6, 0x0800, true); // flags: bit 11 = UTF-8 文件名
    lv.setUint16(8, 0, true); // method 0 = store
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra field length
    local.set(nameBytes, 30);

    chunks.push(local, data);
    central.push({ nameBytes, sum, size: data.length, offset });
    offset += local.length + data.length;
  }

  const centralStart = offset;
  for (const c of central) {
    const rec = new Uint8Array(46 + c.nameBytes.length);
    const cv = new DataView(rec.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true); // flags: UTF-8
    cv.setUint16(10, 0, true); // method 0
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, c.sum, true);
    cv.setUint32(20, c.size, true);
    cv.setUint32(24, c.size, true);
    cv.setUint16(28, c.nameBytes.length, true);
    cv.setUint16(42, 0, true); // 占位，下方写真实偏移（setUint16 先清零避免漏写高 16 位）
    cv.setUint32(42, c.offset, true);
    rec.set(c.nameBytes, 46);
    chunks.push(rec);
    offset += rec.length;
  }
  const centralSize = offset - centralStart;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, central.length, true); // 本盘条目数
  ev.setUint16(10, central.length, true); // 总条目数
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  chunks.push(eocd);

  return new Blob(chunks, { type: 'application/zip' });
}
