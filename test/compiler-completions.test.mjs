/**
 * 编译器补全的类型感知过滤：容器成员白名单 + 接收者类型推断。
 *
 * 回归背景：CPP_MEMBERS 是所有 STL 类型的成员并集，`. ` 一按就整表弹出，
 * 于是 `queue<int> q; q.` 也会看到 push_back（queue 根本没这个成员）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CPP_MEMBERS,
  CPP_CONTAINER_MEMBERS,
  cppMemberReceiver,
  cppDeclaredContainer,
  cppReceiverMembers,
} from '../lib/compiler/completions.js';

const known = new Set(CPP_MEMBERS.map((m) => m.label));
const labelsAt = (source, lineText, column) =>
  cppReceiverMembers(source, lineText, column, CPP_MEMBERS).map((m) => m.label);

test('成员白名单：每个 label 都真实存在于 CPP_MEMBERS（防表漂移）', () => {
  for (const [container, labels] of Object.entries(CPP_CONTAINER_MEMBERS)) {
    for (const label of labels) {
      assert.ok(known.has(label), `${container} 白名单里的 ${label} 不在 CPP_MEMBERS`);
    }
  }
});

test('容器适配器只暴露自己的接口：queue 不出 push_back / top', () => {
  const labels = cppReceiverMembers('queue<int> q;\nq.', 'q.', 3, CPP_MEMBERS).map((m) => m.label);
  assert.ok(labels.includes('push'));
  assert.ok(labels.includes('front'));
  assert.ok(labels.includes('back'));
  assert.ok(!labels.includes('push_back'));
  assert.ok(!labels.includes('push_front'));
  assert.ok(!labels.includes('top'));
  assert.ok(!labels.includes('begin'));
});

test('priority_queue / stack 只有 push-pop-top，没有 front/back', () => {
  const pq = cppReceiverMembers(
    'priority_queue<int, vector<int>, greater<int>> pq;\npq.',
    'pq.',
    4,
    CPP_MEMBERS,
  ).map((m) => m.label);
  assert.ok(pq.includes('top'));
  assert.ok(!pq.includes('front'));
  assert.ok(!pq.includes('back'));
  assert.ok(!pq.includes('push_back'));

  const st = cppReceiverMembers('stack<int> st;\nst.', 'st.', 4, CPP_MEMBERS).map((m) => m.label);
  assert.ok(st.includes('top'));
  assert.ok(!st.includes('front'));
});

test('vector 有 push_back 但没有 push / top', () => {
  const labels = cppReceiverMembers('vector<int> v;\nv.', 'v.', 3, CPP_MEMBERS).map((m) => m.label);
  assert.ok(labels.includes('push_back'));
  assert.ok(labels.includes('emplace_back'));
  assert.ok(labels.includes('capacity'));
  assert.ok(!labels.includes('push'));
  assert.ok(!labels.includes('top'));
  assert.ok(!labels.includes('substr'));
});

test('string / map / set 各自的成员表', () => {
  const s = cppReceiverMembers('string s;\ns.', 's.', 3, CPP_MEMBERS).map((m) => m.label);
  assert.ok(s.includes('substr'));
  assert.ok(s.includes('c_str'));
  assert.ok(!s.includes('push'));

  const mp = cppReceiverMembers('map<string, vector<int>> mp;\nmp.', 'mp.', 4, CPP_MEMBERS).map((m) => m.label);
  assert.ok(mp.includes('lower_bound'));
  assert.ok(mp.includes('contains'));
  assert.ok(!mp.includes('push_back'));

  const se = cppReceiverMembers('set<int> se;\nse.', 'se.', 4, CPP_MEMBERS).map((m) => m.label);
  assert.ok(se.includes('insert'));
  assert.ok(!se.includes('push_back'));
});

test('标准流对象按名字认类型：cout. 只出 put/flush/precision', () => {
  assert.deepEqual(labelsAt('int main(){\ncout.', 'cout.', 6), ['put', 'flush', 'precision']);
  assert.deepEqual(labelsAt('int main(){\ncin.', 'cin.', 5), ['ignore', 'get', 'getline', 'peek']);
});

test('推不出类型时保留整表（不猜）', () => {
  const full = CPP_MEMBERS.length;
  assert.equal(cppReceiverMembers('int x;\nx.', 'x.', 3, CPP_MEMBERS).length, full);
  assert.equal(cppReceiverMembers('node->', 'node->', 7, CPP_MEMBERS).length, full);
  assert.equal(cppReceiverMembers('a.b.', 'a.b.', 5, CPP_MEMBERS).length, full);
  assert.equal(cppReceiverMembers('', '.', 2, CPP_MEMBERS).length, full);
});

test('cppMemberReceiver：取光标前紧邻的接收者标识符', () => {
  assert.equal(cppMemberReceiver('q.', 3), 'q');
  assert.equal(cppMemberReceiver('    v.pu', 9), 'v');
  assert.equal(cppMemberReceiver('p->', 4), 'p');
  assert.equal(cppMemberReceiver('a.b.', 5), 'b');
  assert.equal(cppMemberReceiver('std::sort(', 11), null);
  assert.equal(cppMemberReceiver('1.5', 4), null);
});

test('cppDeclaredContainer：模板参数 / std:: 前缀 / 嵌套尖括号都能认', () => {
  assert.equal(cppDeclaredContainer('queue<int> q;\nq.push();', 'q'), 'queue');
  assert.equal(cppDeclaredContainer('std::vector<std::pair<int, int>> v;', 'v'), 'vector');
  assert.equal(cppDeclaredContainer('priority_queue<int, vector<int>, greater<int>> pq;', 'pq'), 'priority_queue');
  assert.equal(cppDeclaredContainer('unordered_map<string, int> cnt;', 'cnt'), 'unordered_map');
  assert.equal(cppDeclaredContainer('void solve(vector<int>& a, int n) {}', 'a'), 'vector');
  assert.equal(cppDeclaredContainer('array<int, 10> f;', 'f'), 'array');
});

test('cppDeclaredContainer：非容器声明与非声明语句', () => {
  // 非容器类型 → 不猜（调用方回整表）
  assert.equal(cppDeclaredContainer('int q;', 'q'), null);
  assert.equal(cppDeclaredContainer('auto q = make();', 'q'), null);
  // 语句关键字不算声明，不会把前面的正确声明冲掉（return 行极其常见）
  assert.equal(cppDeclaredContainer('queue<int> q;\nint f() { return q; }', 'q'), 'queue');
  // 局部变量遮蔽：最后一次真实声明说了算
  assert.equal(cppDeclaredContainer('vector<int> v;\n{ int v; v = 0; }', 'v'), null);
});
