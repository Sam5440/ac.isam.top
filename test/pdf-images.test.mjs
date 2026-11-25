import test from 'node:test';
import assert from 'node:assert/strict';

import { buildImagePdf, pdfString } from '../lib/pdf-images.mjs';

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

function fakeJpeg() {
  // 不需要是真 JPEG：写入器只负责原样装入 DCTDecode 流。
  return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
}

const pages = [
  { data: fakeJpeg(), width: 1588, height: 2246 },
  { data: fakeJpeg(), width: 1588, height: 2246 },
  { data: fakeJpeg(), width: 1588, height: 2246 },
];

test('buildImagePdf: 生成合法结构、页数与 xref 偏移', () => {
  const bytes = buildImagePdf(pages, {
    title: '测试题集',
    producer: 'AC Library',
    footer: (index, count) =>
      index === 0
        ? []
        : [{ text: `Page ${index} of ${count - 1}`, align: 'center', size: 8.5 }],
  });
  const text = latin1(bytes);

  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /%%EOF\n$/);
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 3);
  assert.match(text, /\/Type \/Pages \/Kids \[4 0 R 7 0 R 10 0 R\] \/Count 3/);
  assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(text, /\(Page 1 of 2\) Tj/);
  assert.match(text, /\(Page 2 of 2\) Tj/);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /\/Title <FEFF/); // 中文元数据走 UTF-16BE

  const startxref = Number(text.match(/startxref\n(\d+)/)?.[1]);
  assert.ok(Number.isInteger(startxref) && startxref > 0);
  assert.match(text.slice(startxref, startxref + 4), /^xref/);

  const objectCount = Number(text.match(/xref\n0 (\d+)/)?.[1]) - 1;
  assert.ok(objectCount >= 13);
  for (let n = 1; n <= objectCount; n += 1) {
    const marker = `${n} 0 obj`;
    const at = text.indexOf(marker);
    assert.ok(at >= 0, `缺少对象 ${n}`);
    const xrefLine = text.match(new RegExp(`(\\d{10}) 00000 n \\n`, 'g'))?.[n - 1] ?? '';
    const offset = Number(xrefLine.slice(0, 10));
    assert.equal(text.slice(offset, offset + marker.length), marker);
  }
});

test('buildImagePdf: 书签按页对象去重并可跳转', () => {
  const bytes = buildImagePdf(pages, {
    bookmarks: [
      { title: 'Problem A. Reverse, Recurse', pageIndex: 0 },
      { title: 'Problem B. Three Vertices', pageIndex: 1 },
      { title: 'Problem C. 中文标题', pageIndex: 2 },
    ],
  });
  const text = latin1(bytes);
  assert.match(text, /\/Type \/Outlines/);
  assert.equal((text.match(/\/Title /g) || []).length, 3);
  assert.match(text, /\/Title <FEFF/);
  const dests = [...text.matchAll(/\/Dest \[(\d+) 0 R \/Fit\]/g)].map((m) => m[1]);
  assert.equal(dests.length, 3);
  assert.equal(new Set(dests).size, 3);
});

test('buildImagePdf: 图片等比缩放，不拉伸到变形', () => {
  const wide = buildImagePdf([{ data: fakeJpeg(), width: 2000, height: 1000 }], {
    pageWidth: 600,
    pageHeight: 800,
  });
  const text = latin1(wide);
  // 600pt 宽、300pt 高，顶端对齐 => y=500
  assert.match(text, /600 0 0 300 0 500 cm/);
});

test('buildImagePdf: 空页列表直接拒绝', () => {
  assert.throws(() => buildImagePdf([]), /至少需要一页/);
});

test('pdfString: ASCII 用字面量，中文用 UTF-16BE', () => {
  assert.equal(pdfString('Problem A'), '(Problem A)');
  assert.equal(pdfString('a(b)\\c'), '(a\\(b\\)\\\\c)');
  assert.equal(pdfString('题'), '<FEFF9898>');
});
