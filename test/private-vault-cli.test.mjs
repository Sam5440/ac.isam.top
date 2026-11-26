import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 在临时目录里跑 CLI（脚本以 cwd 为仓库根，避免污染真实 data/）。 */
function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-cli-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'scripts/private-vault.mjs'), path.join(dir, 'scripts/private-vault.mjs'));
  fs.cpSync(path.join(REPO, 'scripts/lib'), path.join(dir, 'scripts/lib'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'lib/private-vault.mjs'), path.join(dir, 'lib/private-vault.mjs'));
  // CLI 会 import parse5 / sharp（可选），软链仓库依赖即可
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

function run(dir, args, env = {}) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts/private-vault.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

const PASSWORD = 'cli-lsktdxtq-927';

const payload = {
  format: 'ac-private-contest',
  version: 1,
  id: 'cli-demo',
  label: 'CLI 自检场',
  title: 'CLI Demo',
  titleZh: null,
  source: null,
  startTime: null,
  durationSeconds: null,
  note: null,
  problems: [
    {
      id: 'cli-demo-a',
      index: 'A',
      title: 'A Plus B',
      titleZh: null,
      url: null,
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      difficulty: null,
      tags: [],
      statementMd: 'Print $a+b$.',
      statementZhMd: null,
      samples: [{ input: '1 2', output: '3' }],
    },
  ],
};

test('CLI pack 生成密文与索引，list/verify 能读回，remove 连索引一起删', () => {
  const dir = makeSandbox();
  try {
    const json = path.join(dir, 'contest.json');
    fs.writeFileSync(json, JSON.stringify(payload));

    const packed = run(dir, ['pack', '--from-json', json, '--password', PASSWORD]);
    assert.equal(packed.status, 0, packed.stderr);
    assert.match(packed.stdout, /cli-demo/);

    const envelope = JSON.parse(fs.readFileSync(path.join(dir, 'data/private/vault/cli-demo.json'), 'utf8'));
    assert.equal(envelope.format, 'ac-private-vault');
    assert.equal(envelope.kdf.iterations, 310000);
    assert.equal(JSON.stringify(envelope).includes('A Plus B'), false);

    const index = JSON.parse(fs.readFileSync(path.join(dir, 'data/private/vault.json'), 'utf8'));
    assert.deepEqual(index.contests.map((c) => c.id), ['cli-demo']);

    const listed = run(dir, ['list']);
    assert.equal(listed.status, 0);
    assert.match(listed.stdout, /cli-demo/);

    const ok = run(dir, ['verify'], { VAULT_PASSWORD: PASSWORD });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /解密通过，1 道题/);

    const bad = run(dir, ['verify'], { VAULT_PASSWORD: 'wrong-pw' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /解密失败/);

    const removed = run(dir, ['remove', '--id', 'cli-demo']);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(fs.existsSync(path.join(dir, 'data/private/vault/cli-demo.json')), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data/private/vault.json'), 'utf8')).contests, []);

    const missing = run(dir, ['remove', '--id', 'cli-demo']);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /索引里没有/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI pack 拒绝不合法载荷与过短密码，且不留下半成品', () => {
  const dir = makeSandbox();
  try {
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ ...payload, problems: [] }));

    const rejected = run(dir, ['pack', '--from-json', bad, '--password', PASSWORD]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /problems 必须是非空数组/);
    assert.equal(fs.existsSync(path.join(dir, 'data/private/vault/cli-demo.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'data/private/vault.json')), false);

    const good = path.join(dir, 'ok.json');
    fs.writeFileSync(good, JSON.stringify(payload));
    const shortPw = run(dir, ['pack', '--from-json', good, '--password', 'abc']);
    assert.equal(shortPw.status, 1);
    assert.match(shortPw.stderr, /密码至少 6 位/);
    assert.equal(fs.existsSync(path.join(dir, 'data/private/vault/cli-demo.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
