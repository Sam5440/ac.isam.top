/**
 * 最小图片 PDF 写入器（无 DOM 依赖，浏览器 / Node 均可运行）。
 *
 * 每一页是一张 JPEG（DCTDecode），排版由调用方先画进 canvas。相比引入
 * jsPDF/html2canvas，这里只解决「把已经排好的页面装进 PDF」这一件事：
 *
 *   - A4 页面尺寸按 pt 指定，图片按等比缩放后顶端对齐；
 *   - 可在页面上叠加大号 ASCII 页脚文字（页码用 Helvetica，矢量清晰）；
 *   - 可写入 PDF 书签，让阅读器侧栏直接跳到每道题的第一页。
 *
 * 文字图层目前只接受 ASCII（页码 / 站点域名）。正文是图片，因此中文不需要
 * 内嵌字体；书签标题用 UTF-16BE 十六进制字符串，阅读器可正常显示中文。
 */

const DEFAULT_WIDTH = 595.28;
const DEFAULT_HEIGHT = 841.89;

function asciiBytes(value) {
  const text = String(value ?? '');
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function concatBytes(chunks, total) {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

function escapeLiteral(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function utf16Hex(text) {
  let hex = 'FEFF';
  for (const ch of Array.from(String(text))) {
    let code = ch.codePointAt(0);
    if (code > 0xffff) {
      code -= 0x10000;
      hex += (0xd800 + (code >> 10)).toString(16).padStart(4, '0');
      hex += (0xdc00 + (code & 0x3ff)).toString(16).padStart(4, '0');
    } else {
      hex += code.toString(16).padStart(4, '0');
    }
  }
  return hex.toUpperCase();
}

/** PDF 字符串：可打印 ASCII 用字面量，其余（中文书签）用 UTF-16BE 十六进制。 */
export function pdfString(value) {
  const text = String(value ?? '');
  if (/^[\x20-\x7e]*$/.test(text)) return `(${escapeLiteral(text)})`;
  return `<${utf16Hex(text)}>`;
}

function asciiOnly(value) {
  return String(value ?? '').replace(/[^\x20-\x7e]/g, '?');
}

function approximateWidth(text, size) {
  // Helvetica 的平均字宽约 0.5em；页码 / 域名这类短文本足够精确。
  return asciiOnly(text).length * size * 0.5;
}

function textLineCommands(line, pageWidth) {
  const text = asciiOnly(line?.text ?? '').trim();
  if (!text) return '';
  const size = Number.isFinite(Number(line?.size)) ? Number(line.size) : 8;
  const color = Array.isArray(line?.color) ? line.color : [0.42, 0.45, 0.5];
  const width = approximateWidth(text, size);
  let x = Number.isFinite(Number(line?.x)) ? Number(line.x) : 42;
  if (line?.align === 'center') x = Math.max(12, (pageWidth - width) / 2);
  else if (line?.align === 'right') x = pageWidth - 42 - width;
  const y = Number.isFinite(Number(line?.y)) ? Number(line.y) : 20;
  return [
    'BT',
    `/F1 ${formatNumber(size)} Tf`,
    `${formatNumber(color[0] ?? 0.42)} ${formatNumber(color[1] ?? 0.45)} ${formatNumber(color[2] ?? 0.5)} rg`,
    `1 0 0 1 ${formatNumber(x)} ${formatNumber(y)} Tm`,
    `(${escapeLiteral(text)}) Tj`,
    'ET',
  ].join('\n');
}

function pageContentStream({ image, draw, texts, pageWidth, pageHeight, imageName }) {
  const commands = [
    'q',
    `${formatNumber(draw.w)} 0 0 ${formatNumber(draw.h)} ${formatNumber(draw.x)} ${formatNumber(draw.y)} cm`,
    `/${imageName} Do`,
    'Q',
  ];
  for (const line of texts) {
    const block = textLineCommands(line, pageWidth);
    if (block) commands.push(block);
  }
  return asciiBytes(commands.join('\n'));
}

function makeImageObject({ data, pixelWidth, pixelHeight }) {
  return {
    dict:
      `<< /Type /XObject /Subtype /Image /Width ${Math.max(1, Math.round(pixelWidth))} ` +
      `/Height ${Math.max(1, Math.round(pixelHeight))} /ColorSpace /DeviceRGB ` +
      '/BitsPerComponent 8 /Filter /DCTDecode /Interpolate true >>',
    stream: data,
  };
}

/**
 * @param {Array<{data: Uint8Array, width: number, height: number}>} pages
 *   JPEG 字节与像素尺寸（width/height 用来计算页面内缩放比例）。
 * @param {object} [options]
 * @param {number} [options.pageWidth]  PDF 页面宽（pt）
 * @param {number} [options.pageHeight] PDF 页面高（pt）
 * @param {(index: number, count: number) => Array<object>} [options.footer]
 *   每页返回一组文字命令：{ text, x?, y?, size?, color?, align? }。
 * @param {Array<{title: string, pageIndex: number}>} [options.bookmarks]
 *   pageIndex 从 0 开始，指向 pages 数组。
 * @param {string} [options.title] PDF 元数据标题。
 * @returns {Uint8Array}
 */
export function buildImagePdf(pages, options = {}) {
  const list = Array.isArray(pages) ? pages.filter((p) => p && p.data) : [];
  if (!list.length) throw new Error('PDF 至少需要一页');

  const pageWidth = Number(options.pageWidth) || DEFAULT_WIDTH;
  const pageHeight = Number(options.pageHeight) || DEFAULT_HEIGHT;
  const footer = typeof options.footer === 'function' ? options.footer : () => [];

  const objects = [];
  const alloc = () => {
    objects.push(null);
    return objects.length;
  };
  const setObject = (id, object) => {
    objects[id - 1] = object;
  };

  const catalogId = alloc();
  const pagesId = alloc();
  const fontId = alloc();
  const pageIds = [];
  const contentIds = [];
  const imageIds = [];
  for (let i = 0; i < list.length; i += 1) {
    pageIds.push(alloc());
    contentIds.push(alloc());
    imageIds.push(alloc());
  }

  const bookmarkItems = (Array.isArray(options.bookmarks) ? options.bookmarks : [])
    .filter((item) => item && Number.isInteger(item.pageIndex) && item.pageIndex >= 0 && item.pageIndex < list.length)
    .map((item) => ({ title: String(item.title ?? '').trim(), pageIndex: item.pageIndex }));
  let outlineRootId = 0;
  const bookmarkIds = [];
  if (bookmarkItems.length) {
    outlineRootId = alloc();
    for (let i = 0; i < bookmarkItems.length; i += 1) bookmarkIds.push(alloc());
  }
  let infoId = 0;
  if (options.title || options.producer) infoId = alloc();

  const kids = [];
  for (let i = 0; i < list.length; i += 1) {
    const page = list[i];
    const pixelWidth = Math.max(1, Number(page.width) || 1);
    const pixelHeight = Math.max(1, Number(page.height) || 1);
    let drawW = pageWidth;
    let drawH = (pageWidth * pixelHeight) / pixelWidth;
    if (drawH > pageHeight) {
      drawH = pageHeight;
      drawW = (pageHeight * pixelWidth) / pixelHeight;
    }
    // 页面 canvas 与 A4 比例只差几个像素时直接铺满，避免出现 0.02pt 的白边。
    const targetRatio = pageWidth / pageHeight;
    const imageRatio = pixelWidth / pixelHeight;
    if (Math.abs(imageRatio - targetRatio) / targetRatio < 0.002) {
      drawW = pageWidth;
      drawH = pageHeight;
    }
    const draw = {
      w: drawW,
      h: drawH,
      x: (pageWidth - drawW) / 2,
      y: pageHeight - drawH,
    };
    const imageName = `Im${i + 1}`;
    const texts = footer(i, list.length) || [];
    const content = pageContentStream({ image: page, draw, texts, pageWidth, pageHeight, imageName });

    setObject(imageIds[i], makeImageObject({ data: page.data, pixelWidth, pixelHeight }));
    setObject(contentIds[i], { dict: '<< >>', stream: content });
    setObject(
      pageIds[i],
      {
        dict:
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${formatNumber(pageWidth)} ${formatNumber(pageHeight)}] ` +
          `/Resources << /XObject << /${imageName} ${imageIds[i]} 0 R >> /Font << /F1 ${fontId} 0 R >> >> ` +
          `/Contents ${contentIds[i]} 0 R >>`,
      },
    );
    kids.push(`${pageIds[i]} 0 R`);
  }

  setObject(catalogId, {
    dict:
      `<< /Type /Catalog /Pages ${pagesId} 0 R` +
      (outlineRootId ? ` /Outlines ${outlineRootId} 0 R` : '') +
      ' >>',
  });
  setObject(pagesId, { dict: `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${list.length} >>` });
  setObject(fontId, { dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' });

  if (outlineRootId) {
    setObject(outlineRootId, {
      dict:
        `<< /Type /Outlines /First ${bookmarkIds[0]} 0 R /Last ${bookmarkIds[bookmarkIds.length - 1]} 0 R ` +
        `/Count ${bookmarkItems.length} >>`,
    });
    bookmarkItems.forEach((item, i) => {
      const prev = i > 0 ? ` /Prev ${bookmarkIds[i - 1]} 0 R` : '';
      const next = i + 1 < bookmarkItems.length ? ` /Next ${bookmarkIds[i + 1]} 0 R` : '';
      setObject(bookmarkIds[i], {
        dict:
          `<< /Title ${pdfString(item.title)} /Parent ${outlineRootId} 0 R${prev}${next} ` +
          `/Dest [${pageIds[item.pageIndex]} 0 R /Fit] >>`,
      });
    });
  }

  if (infoId) {
    const parts = [];
    if (options.title) parts.push(`/Title ${pdfString(options.title)}`);
    if (options.producer) parts.push(`/Producer ${pdfString(options.producer)}`);
    setObject(infoId, { dict: `<< ${parts.join(' ')} >>` });
  }

  if (objects.some((object) => !object)) throw new Error('PDF 对象编号不完整');

  const chunks = [];
  let length = 0;
  const push = (value) => {
    const bytes = typeof value === 'string' ? asciiBytes(value) : value;
    chunks.push(bytes);
    length += bytes.byteLength;
  };

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const offsets = [];
  objects.forEach((object, index) => {
    offsets[index] = length;
    push(`${index + 1} 0 obj\n`);
    if (object.stream) {
      const dict = String(object.dict).replace(/>>\s*$/, ` /Length ${object.stream.byteLength} >>`);
      push(`${dict}\nstream\n`);
      push(object.stream);
      push('\nendstream\nendobj\n');
    } else {
      push(`${object.dict}\nendobj\n`);
    }
  });

  const xrefStart = length;
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (const offset of offsets) xref.push(`${String(offset).padStart(10, '0')} 00000 n `);
  push(`${xref.join('\n')}\n`);
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R` +
      (infoId ? ` /Info ${infoId} 0 R` : '') +
      ` >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  );

  return concatBytes(chunks, length);
}

export default buildImagePdf;
