import test from 'node:test';
import assert from 'node:assert/strict';

import { outlineCpp, outlineMarkdown, outlineOf, outlinePython, sortOutline, stripComments } from '../lib/ide-outline.mjs';

const CPP = `#include <bits/stdc++.h>
using namespace std;

#define MAXN 100
typedef long long ll;
using pii = pair<int,int>;

struct Node { int x; };
class Solver {
public:
    int solve(int a) { return a; }
};

int n, m;
const int MOD = 1000000007;

int add(int a, int b) {
    return a + b;
}

namespace inner {
  void f() {}
}

int main() {
    return 0;
}
`;

test('outline: C++ 抓取宏 / 类型 / 结构体 / 函数 / 命名空间 / 全局变量', () => {
  const list = outlineCpp(CPP);
  const byName = Object.fromEntries(list.map((s) => [s.name, s]));
  assert.equal(byName.MAXN.kind, 'macro');
  assert.equal(byName.ll.kind, 'typedef');
  assert.equal(byName.pii.kind, 'typedef');
  assert.equal(byName.Node.kind, 'struct');
  assert.equal(byName.Solver.kind, 'class');
  assert.equal(byName.inner.kind, 'namespace');
  assert.equal(byName.add.kind, 'function');
  assert.equal(byName.main.kind, 'function');
  assert.equal(byName.n.kind, 'variable');
  assert.equal(byName.MOD.kind, 'constant');
  // 控制流关键字不能被当成函数
  assert.equal(byName.if, undefined);
  assert.equal(byName.return, undefined);
});

test('outline: 行号是 1 起且按行排序', () => {
  const list = sortOutline(outlineCpp(CPP));
  assert.equal(list[0].line, 4);
  for (let i = 1; i < list.length; i += 1) assert.ok(list[i].line >= list[i - 1].line);
  assert.equal(list.find((s) => s.name === 'add').line, 17);
});

test('outline: 注释与字符串里的假符号不会被抓', () => {
  const src = `// int fake() {}\n/* void alsoFake() {} */\nconst char* s = "int nope() {}";\nint real() { return 0; }\n`;
  const names = outlineCpp(src).map((s) => s.name);
  assert.ok(names.includes('real'));
  assert.equal(names.includes('fake'), false);
  assert.equal(names.includes('alsoFake'), false);
  assert.equal(names.includes('nope'), false);
});

test('outline: Python 类 / 方法 / 函数 / 全局变量与缩进深度', () => {
  const src = `import sys

x = 1

def top(a):
    y = 2
    return a

class Solver:
    def solve(self):
        pass

    async def fetch(self):
        pass
`;
  const list = outlinePython(src);
  const get = (name) => list.find((s) => s.name === name);
  assert.equal(get('x').kind, 'variable');
  assert.equal(get('top').kind, 'function');
  assert.equal(get('Solver').kind, 'class');
  assert.equal(get('solve').kind, 'method');
  assert.equal(get('solve').depth, 1);
  assert.equal(get('fetch').kind, 'method');
  assert.equal(get('y'), undefined);
});

test('outline: Markdown 标题层级，跳过代码块', () => {
  const md = `# 题解\n\n## 思路\n\n\`\`\`\n# 这不是标题\n\`\`\`\n\n### 细节\n`;
  const list = outlineMarkdown(md);
  assert.deepEqual(list.map((s) => [s.name, s.depth]), [['题解', 0], ['思路', 1], ['细节', 2]]);
});

test('outline: stripComments 保留行号且去掉注释内容', () => {
  const out = stripComments('int a; // 注释\n/* 块\n注释 */ int b;');
  assert.equal(out.split('\n').length, 3);
  assert.equal(out.includes('注释'), false);
  assert.ok(out.includes('int a;'));
});

test('outline: 未知语言返回空数组', () => {
  assert.deepEqual(outlineOf('json', '{"a":1}'), []);
  assert.deepEqual(outlineOf(undefined, ''), []);
});
