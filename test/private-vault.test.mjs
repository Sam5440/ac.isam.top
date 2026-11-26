import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as parse5 from 'parse5';

import {
  KDF_ITERATIONS,
  VaultDecryptError,
  decryptVaultEnvelope,
  encryptVaultPayload,
  indexEntryOf,
  isVaultEnvelope,
  normalizeVaultIndex,
  normalizeVaultPayload,
  validateVaultPayload,
} from '../lib/private-vault.mjs';
import {
  escapeText,
  findAll,
  mergeMathClusters,
  problemSetToPayload,
  leftoverHtml,
} from '../scripts/lib/problem-set-html.mjs';

const PASSWORD = 'test-password-123';

/** 一份最小的合法载荷（2 题足够覆盖结构）。 */
function samplePayload(overrides = {}) {
  return {
    format: 'ac-private-contest',
    version: 1,
    id: 'demo-contest',
    label: '示例比赛 · 正式赛',
    title: 'Demo Contest 2026',
    titleZh: '示例比赛 2026',
    source: 'https://example.com/contest/1',
    startTime: '2026-11-22T09:00:00+08:00',
    durationSeconds: 18000,
    note: null,
    problems: [
      {
        id: 'demo-contest-a',
        index: 'A',
        title: 'Add Two Numbers',
        titleZh: '两数之和',
        url: 'https://example.com/contest/1/a',
        timeLimitMs: 2000,
        memoryLimitMb: 1024,
        difficulty: null,
        tags: ['math'],
        statementMd: 'Given $a$ and $b$, print $a+b$.\n\n#### Input\n\nTwo integers.',
        statementZhMd: '给定 $a$ 与 $b$，输出 $a+b$。',
        samples: [{ input: '1 2', output: '3', note: 'The only sample.', noteZh: '唯一样例。' }],
      },
      {
        id: 'demo-contest-b',
        index: 'B',
        title: 'Only English',
        titleZh: null,
        url: null,
        timeLimitMs: 4000,
        memoryLimitMb: 1024,
        difficulty: null,
        tags: [],
        statementMd: 'Print `OK`.',
        statementZhMd: null,
        samples: [{ input: '', output: 'OK' }],
      },
    ],
    ...overrides,
  };
}

test('加密 → 解密往返：载荷字段与样例完整保留', async () => {
  const payload = normalizeVaultPayload(samplePayload());
  assert.deepEqual(validateVaultPayload(payload), { ok: true });

  // 测试里把 KDF 轮数调小（生产默认 310000 轮，见 KDF_ITERATIONS）
  const envelope = await encryptVaultPayload(payload, PASSWORD, { iterations: 1000 });
  assert.equal(isVaultEnvelope(envelope), true);
  assert.equal(envelope.kdf.name, 'PBKDF2');
  assert.equal(envelope.kdf.hash, 'SHA-256');
  assert.equal(envelope.cipher.name, 'AES-GCM');
  assert.equal(envelope.label, payload.label);
  assert.ok(envelope.bytes > 0);

  const back = await decryptVaultEnvelope(envelope, PASSWORD);
  assert.deepEqual(back, payload);
  assert.equal(back.problems[0].samples[0].noteZh, '唯一样例。');
});

test('默认 KDF 参数是 31 万轮，且密文不含明文题面', async () => {
  assert.equal(KDF_ITERATIONS, 310_000);
  const payload = normalizeVaultPayload(samplePayload());
  const envelope = await encryptVaultPayload(payload, PASSWORD, { iterations: 1000 });
  const raw = JSON.stringify(envelope);
  assert.equal(raw.includes('Add Two Numbers'), false);
  assert.equal(raw.includes('两数之和'), false);
  assert.equal(raw.includes('Given'), false);
  const entry = indexEntryOf(envelope);
  assert.deepEqual(Object.keys(entry).sort(), ['bytes', 'createdAt', 'file', 'id', 'label']);
  assert.equal(JSON.stringify(entry).includes('Add Two Numbers'), false);
});

test('错误密码抛 VaultDecryptError，不泄漏任何内容', async () => {
  const payload = normalizeVaultPayload(samplePayload());
  const envelope = await encryptVaultPayload(payload, PASSWORD, { iterations: 1000 });
  await assert.rejects(() => decryptVaultEnvelope(envelope, 'wrong-password'), (err) => {
    assert.ok(err instanceof VaultDecryptError);
    assert.match(err.message, /密码错误/);
    return true;
  });
});

test('密文被篡改（改一字节）后同样认证失败', async () => {
  const payload = normalizeVaultPayload(samplePayload());
  const envelope = await encryptVaultPayload(payload, PASSWORD, { iterations: 1000 });
  const bytes = Buffer.from(envelope.ciphertext, 'base64');
  bytes[0] ^= 0xff;
  const tampered = { ...envelope, ciphertext: bytes.toString('base64') };
  await assert.rejects(() => decryptVaultEnvelope(tampered, PASSWORD), VaultDecryptError);
});

test('结构不合法的信封直接拒绝', async () => {
  await assert.rejects(() => decryptVaultEnvelope({ format: 'nope' }, PASSWORD), VaultDecryptError);
  await assert.rejects(
    () => decryptVaultEnvelope({ format: 'ac-private-vault', kdf: { name: 'PBKDF2' }, cipher: { name: 'AES-GCM' }, ciphertext: 'AAAA' }, PASSWORD),
    VaultDecryptError,
  );
});

test('载荷校验：拒绝坏 format / 重复题 id / 空题面 / statementPdf / 越界参数', () => {
  assert.equal(validateVaultPayload(null).ok, false);
  assert.equal(validateVaultPayload(samplePayload({ format: 'x' })).ok, false);
  assert.equal(validateVaultPayload(samplePayload({ id: 'Bad Id' })).ok, false);
  assert.equal(validateVaultPayload(samplePayload({ problems: [] })).ok, false);
  assert.equal(validateVaultPayload(samplePayload({ label: '' })).ok, false);

  const dup = samplePayload();
  dup.problems[1].id = dup.problems[0].id;
  assert.match(validateVaultPayload(dup).error, /重复/);

  const empty = samplePayload();
  empty.problems[0].statementMd = '   ';
  assert.equal(validateVaultPayload(empty).ok, false);

  const pdf = samplePayload();
  pdf.problems[0].statementPdf = 'https://example.com/a.pdf';
  assert.match(validateVaultPayload(pdf).error, /statementPdf/);

  const bigTime = samplePayload();
  bigTime.problems[0].timeLimitMs = 60 * 60 * 1000;
  assert.equal(validateVaultPayload(bigTime).ok, false);
});

test('normalizeVaultPayload 补默认值且幂等', () => {
  const once = normalizeVaultPayload({
    format: 'ac-private-contest',
    version: 1,
    id: 'X-1',
    label: '  A  ',
    title: 'T',
    problems: [{ id: 'X-1-A', title: 'P', statementMd: ' body \r\n' }],
  });
  assert.equal(once.id, 'x-1');
  assert.equal(once.label, 'A');
  assert.equal(once.problems[0].index, 'A');
  assert.equal(once.problems[0].statementMd, 'body');
  assert.deepEqual(once.problems[0].tags, []);
  assert.deepEqual(normalizeVaultPayload(once), once);
});

test('索引归一化：丢弃非法条目并按 id 去重', () => {
  const index = normalizeVaultIndex({
    contests: [
      { id: 'a', label: 'A', file: 'a.json', bytes: 10 },
      { id: 'a', label: 'A dup', file: 'a.json', bytes: 10 },
      { id: 'b', label: 'B', file: 'b.json' },
      { id: '../evil', label: 'x', file: 'x.json' },
      { id: 'c', label: 'C', file: '../../etc/passwd' },
      null,
    ],
  });
  assert.deepEqual(index.contests.map((c) => c.id), ['a', 'b']);
  assert.equal(normalizeVaultIndex(null).contests.length, 0);
});

test('题册 HTML → 载荷：题面/样例/时限/内存解析', () => {
  const html = `<!doctype html><html><body>
    <article class="problem" data-letter="A" data-title-en="Sum" data-title-zh="求和"
             data-time-en="2.0 秒" data-memory="1024 MB">
      <div class="pbody">
        <div class="pane pane-en">
          <h3>Problem Statement</h3>
          <p>Compute <i>a</i> + <i>b</i>.</p>
          <h3>Input</h3>
          <p>Two integers <i>a</i>, <i>b</i>.</p>
          <div class="sample"><pre>1 2</pre><pre>3</pre></div>
        </div>
        <div class="pane pane-zh">
          <h3>题目描述</h3>
          <p>计算 <i>a</i> + <i>b</i>。</p>
          <h3>输入格式</h3>
          <p>两个整数 <i>a</i>, <i>b</i>。</p>
          <div class="sample"><pre>1 2</pre><pre>3</pre></div>
        </div>
      </div>
    </article>
  </body></html>`;
  const doc = parse5.parse(html);
  const articles = findAll(doc, (n) => n.tagName === 'article');
  assert.equal(articles.length, 1);
  const payload = problemSetToPayload(articles, {
    id: 'html-demo',
    label: 'HTML Demo',
    title: 'HTML Demo',
  });
  assert.equal(payload.format, 'ac-private-contest');
  assert.equal(payload.problems.length, 1);
  const p = payload.problems[0];
  assert.equal(p.index, 'A');
  assert.equal(p.id, 'html-demo-a');
  assert.match(p.statementMd, /Compute \$a\$ \+ \$b\$\./);
  assert.match(p.statementZhMd, /计算 \$a\$ \+ \$b\$。/);
  assert.equal(p.timeLimitMs, 2000);
  assert.equal(p.memoryLimitMb, 1024);
  assert.deepEqual(p.samples, [{ input: '1 2', output: '3' }]);
  assert.equal(validateVaultPayload(payload).ok, true);
});

test('公式簇合并：数组下标/赋值并成一段，正文里的独立公式不误并', () => {
  assert.equal(mergeMathClusters('$s$[1$..$3] = aba'), '$s[1..3]$ = aba');
  assert.equal(mergeMathClusters('$a$[$x$] =$y$'), '$a[x] =y$');
  assert.equal(mergeMathClusters('$n$ = 3 $m$'), '$n$ = 3 $m$');
  assert.equal(mergeMathClusters('$a_i$ $b_j$'), '$a_i$ $b_j$');
  assert.equal(mergeMathClusters('a$,$b'), 'a,b');
});

test('escapeText 实体化尖括号与方括号，并转义 markdown 记号', () => {
  assert.equal(escapeText('<i>a</i>'), '&lt;i&gt;a&lt;/i&gt;');
  assert.equal(escapeText('a[1]'), 'a&#91;1&#93;');
  assert.equal(escapeText('*x*_y_'), '\\*x\\*\\_y\\_');
});

test('leftoverHtml 检出残留标签', () => {
  assert.equal(Boolean(leftoverHtml('plain $a$ text')), false);
  assert.ok(leftoverHtml('<div>x</div>'));
});

test('仓库里的真实密文结构与索引一致（不解密）', async (t) => {
  const indexPath = path.join(process.cwd(), 'data/private/vault.json');
  if (!fs.existsSync(indexPath)) {
    t.skip('没有 data/private/vault.json');
    return;
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(index.format, 'ac-private-index');
  for (const entry of index.contests) {
    const file = path.join(process.cwd(), 'data/private/vault', entry.file);
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(isVaultEnvelope(envelope), true);
    assert.equal(envelope.id, entry.id);
    assert.equal('problems' in envelope, false);
  }
});
