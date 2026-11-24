/**
 * Markdown 导出 / 分享（纯浏览器，服务端不要 import）。
 *
 * - 打印 / 另存为 PDF：把渲染结果写进隐藏 iframe，调用浏览器打印（文字可选中，
 *   与「另存为 PDF」完全一致）。
 * - 图片：把 HTML 塞进 SVG foreignObject，再画到 canvas → PNG。
 * - PDF（用于分享）：把同一张画布按 A4 比例切片，逐页编码成 JPEG 后手写一个
 *   最小 PDF（无需引入 jsPDF / html2canvas 等额外依赖）。
 * - Web Share：navigator.canShare({ files }) 可用时直接分享生成的 PDF / PNG / MD，
 *   否则回退成下载并提示。
 *
 * 公式在导出管线里用 KaTeX 的 MathML 输出，不依赖站内 CSS 也能正确排版。
 */

import katex from 'katex';
import { renderRich } from './render.js';

/** 导出的独立 HTML 样式（与站内 .md-body 观感一致，但完全不依赖 Tailwind）。 */
export const EXPORT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #1f2328; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
    font-size: 15px; line-height: 1.75; -webkit-font-smoothing: antialiased;
  }
  .export-page { width: 100%; padding: 32px 36px; }
  h1, h2, h3, h4, h5, h6 { margin: 1.4em 0 0.5em; line-height: 1.3; font-weight: 650; }
  h1 { font-size: 1.7em; margin-top: 0; }
  h2 { font-size: 1.35em; border-bottom: 1px solid #e5e7eb; padding-bottom: .25em; }
  h3 { font-size: 1.15em; }
  p { margin: 0.7em 0; }
  a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; word-break: break-all; }
  img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid #e5e7eb; }
  ul, ol { margin: .7em 0; padding-left: 1.6em; }
  li { margin: .2em 0; }
  blockquote { margin: .8em 0; padding: .1em 1em; border-left: 3px solid #d0d7de; color: #57606a; }
  hr { border: 0; border-top: 1px solid #d0d7de; margin: 1.4em 0; }
  code {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: .88em; background: #f6f8fa; border: 1px solid #e5e7eb;
    border-radius: 5px; padding: .1em .35em;
  }
  pre {
    margin: .9em 0; padding: 14px 16px; overflow: auto; border-radius: 8px;
    border: 1px solid #e5e7eb; background: #f6f8fa; line-height: 1.55;
  }
  pre code { background: none; border: 0; padding: 0; font-size: .86em; }
  table { width: 100%; border-collapse: collapse; margin: .9em 0; font-size: .92em; }
  th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; }
  th { background: #f6f8fa; font-weight: 600; }
  .md-math { white-space: nowrap; }
  math { font-size: 1.05em; }
  @page { size: A4; margin: 12mm; }
  @media print {
    body { font-size: 12.5pt; }
    .export-page { padding: 0; }
    pre, blockquote, table, img { break-inside: avoid; }
    h1, h2, h3 { break-after: avoid; }
  }
`;

function stripDelimiters(raw, display) {
  const s = String(raw ?? '').trim();
  if (display && s.startsWith('$$') && s.endsWith('$$')) return s.slice(2, -2);
  if (!display && s.startsWith('$') && s.endsWith('$') && s.length > 1) return s.slice(1, -1);
  return s;
}

/** Markdown → 可独立展示的 HTML（公式用 MathML，无需 KaTeX CSS）。 */
export function renderMarkdownHtml(md) {
  const html = renderRich(String(md ?? ''));
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  for (const token of [...doc.querySelectorAll('code.zs-math')]) {
    const raw = token.textContent || '';
    const display = token.dataset.display === '1';
    let rendered;
    try {
      rendered = katex.renderToString(stripDelimiters(raw, display), {
        displayMode: display,
        throwOnError: false,
        strict: false,
        output: 'mathml',
      });
    } catch {
      rendered = raw;
    }
    const holder = doc.createElement('span');
    holder.innerHTML = rendered;
    token.replaceWith(holder);
  }
  return doc.body.innerHTML;
}

/** 完整的独立 HTML 文档（打印 / 下载用）。 */
export function buildStandaloneHtml(md, { title = 'Markdown' } = {}) {
  const body = renderMarkdownHtml(md);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeXml(title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<article class="export-page md-body">
${body}
</article>
</body>
</html>`;
}

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 隐藏 iframe 打印 → 浏览器「另存为 PDF」（文字可选中）。 */
export function printMarkdown(md, { title = 'Markdown' } = {}) {
  if (typeof document === 'undefined') return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  iframe.srcdoc = buildStandaloneHtml(md, { title });
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {}
    setTimeout(() => iframe.remove(), 60_000);
  };
  document.body.appendChild(iframe);
}

export function downloadBlob(blob, filename) {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function markdownToBlob(md) {
  return new Blob([String(md ?? '')], { type: 'text/markdown;charset=utf-8' });
}

/** Web Share（支持文件时分享，否则下载）。返回 'shared' | 'downloaded'。 */
export async function shareBlob(blob, filename, { title = 'Markdown', text = '' } = {}) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  try {
    if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

const IMAGE_TIMEOUT = 8000;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 尽量把远程图片内联成 data URL（SVG 里的跨域图片不会被画出来）。 */
async function inlineImages(root) {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return;
      try {
        const res = await fetch(src, { credentials: 'omit', signal: AbortSignal.timeout(IMAGE_TIMEOUT) });
        if (!res.ok) return;
        const blob = await res.blob();
        if (!/^image\//i.test(blob.type)) return;
        img.setAttribute('src', await blobToDataUrl(blob));
      } catch {}
    }),
  );
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Markdown → 一张完整高度的 canvas（PNG / PDF 共用）。
 * 宽度默认 820px（A4 96dpi 的可用宽度），scale 控制清晰度。
 */
export async function markdownToCanvas(md, { title = 'Markdown', width = 820, scale = 2 } = {}) {
  if (typeof document === 'undefined') throw new Error('导出图片只能在浏览器中进行');
  const html = renderMarkdownHtml(md);
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-100000px;top:0;z-index:-1;background:#fff;pointer-events:none;';
  host.innerHTML = `<div class="export-page md-body" style="width:${width}px">${html}</div>`;
  document.body.appendChild(host);
  try {
    await inlineImages(host);
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    await nextFrame();
    const page = host.firstElementChild;
    page.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const height = Math.max(1, Math.ceil(page.getBoundingClientRect().height));
    const xhtml = new XMLSerializer().serializeToString(page);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">` +
      `<style xmlns="http://www.w3.org/1999/xhtml">${EXPORT_CSS}</style>` +
      xhtml +
      `</foreignObject></svg>`;
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('渲染图片失败（内容过大或包含无法内联的图片）'));
      img.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    let realScale = Math.min(scale, height > 14000 ? 1 : 2);
    realScale = Math.min(realScale, 32000 / Math.max(height, 1));
    canvas.width = Math.round(width * realScale);
    canvas.height = Math.round(height * realScale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    host.remove();
  }
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.94) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('生成图片失败'))), type, quality);
  });
}

export async function markdownToPngBlob(md, opts = {}) {
  const canvas = await markdownToCanvas(md, opts);
  return canvasToBlob(canvas, 'image/png');
}

/* ---------------- 最小 PDF 生成器（每页一张 JPEG） ---------------- */

const A4_W = 595.28;
const A4_H = 841.89;

function asciiBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function binaryBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * canvas → PDF（A4，按画布宽度等比切片）。
 * 手写 PDF：Catalog / Pages / 每页 Page + Content + Image(DCTDecode)。
 */
export async function canvasToPdfBlob(canvas, { quality = 0.92 } = {}) {
  const sliceHeight = Math.max(1, Math.round((canvas.width * A4_H) / A4_W));
  const pageCount = Math.max(1, Math.ceil(canvas.height / sliceHeight));
  const parts = [];
  let length = 0;
  const push = (value) => {
    const bytes = typeof value === 'string' ? asciiBytes(value) : value;
    parts.push(bytes);
    length += bytes.byteLength;
    return bytes.byteLength;
  };

  const offsets = new Array(3 + pageCount * 3 + 1).fill(0);
  const chunks = [];
  for (let i = 0; i < pageCount; i += 1) {
    const y = i * sliceHeight;
    const h = Math.min(sliceHeight, canvas.height - y);
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    const dataUrl = c.toDataURL('image/jpeg', quality);
    chunks.push({ width: canvas.width, height: h, data: atob(dataUrl.split(',')[1] || '') });
  }

  const totalObjects = 3 + pageCount * 3;
  const pageObj = (i) => 3 + i * 3;
  const contentObj = (i) => 4 + i * 3;
  const imageObj = (i) => 5 + i * 3;

  const write = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
  write(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: pageCount }, (_, i) => `${pageObj(i)} 0 R`).join(' ');
  write(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);

  for (let i = 0; i < pageCount; i += 1) {
    const chunk = chunks[i];
    const drawH = (A4_W * chunk.height) / chunk.width;
    const content = `q ${A4_W.toFixed(2)} 0 0 ${drawH.toFixed(2)} 0 ${(A4_H - drawH).toFixed(2)} cm /Im${i + 1} Do Q`;
    write(
      pageObj(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] ` +
        `/Resources << /XObject << /Im${i + 1} ${imageObj(i)} 0 R >> >> /Contents ${contentObj(i)} 0 R >>`,
    );
    write(contentObj(i), `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offsets[imageObj(i)] = length;
    push(`${imageObj(i)} 0 obj\n`);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${chunk.width} /Height ${chunk.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${chunk.data.length} >>\nstream\n`,
    );
    push(binaryBytes(chunk.data));
    push('\nendstream\nendobj\n');
  }

  const xrefStart = length;
  const xrefLines = [`xref`, `0 ${totalObjects + 1}`, `0000000000 65535 f `];
  for (let n = 1; n <= totalObjects; n += 1) {
    xrefLines.push(`${String(offsets[n]).padStart(10, '0')} 00000 n `);
  }
  push(`${xrefLines.join('\n')}\n`);
  push(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  );

  const flat = new Uint8Array(length);
  let at = 0;
  for (const bytes of parts) {
    flat.set(bytes, at);
    at += bytes.byteLength;
  }
  return new Blob([flat], { type: 'application/pdf' });
}

export async function markdownToPdfBlob(md, opts = {}) {
  const canvas = await markdownToCanvas(md, opts);
  return canvasToPdfBlob(canvas);
}

export default {
  renderMarkdownHtml,
  buildStandaloneHtml,
  printMarkdown,
  downloadBlob,
  markdownToBlob,
  shareBlob,
  markdownToCanvas,
  canvasToBlob,
  markdownToPngBlob,
  canvasToPdfBlob,
  markdownToPdfBlob,
};