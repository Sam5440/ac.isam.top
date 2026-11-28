import test from "node:test";
import assert from "node:assert/strict";

import { legacyFolderTarget, planFolderMerge, uniqueName } from "../lib/ide-folder-merge.mjs";

test("legacy: 用比赛名锚定，剥掉末尾题目 id", () => {
  const contest = { id: "arc234", titleZh: "第 234 场 AtCoder Regular Contest++" };
  assert.equal(
    legacyFolderTarget("arc234-第-234-场-AtCoder-Regular-Contest++-arc234_a", contest),
    "arc234-第-234-场-AtCoder-Regular-Contest++",
  );
  assert.equal(
    legacyFolderTarget("arc234-第-234-场-AtCoder-Regular-Contest++-arc234_b", contest),
    "arc234-第-234-场-AtCoder-Regular-Contest++",
  );
});

test("legacy: 新格式目录与无关目录不动", () => {
  const contest = { id: "arc234", titleZh: "第 234 场 AtCoder Regular Contest++" };
  assert.equal(legacyFolderTarget("arc234-第-234-场-AtCoder-Regular-Contest++", contest), null);
  assert.equal(legacyFolderTarget("a", contest), null);
  assert.equal(legacyFolderTarget("我的笔记", contest), null);
  assert.equal(legacyFolderTarget("arc999-别的比赛-x", contest), null);
});

test("legacy: 没有比赛名时按题号/id 尾部识别", () => {
  assert.equal(legacyFolderTarget("2289-2289B", { id: "2289" }), "2289");
  assert.equal(legacyFolderTarget("2289-第-1137-场-Codeforces-Round（Div.-2）-2289B", { id: "2289" }), "2289-第-1137-场-Codeforces-Round（Div.-2）");
  assert.equal(legacyFolderTarget("141882-牛客小白月赛139-nc141882pb", { id: "141882" }), "141882-牛客小白月赛139");
});

test("uniqueName: 冲突时加序号并保留扩展名", () => {
  assert.equal(uniqueName("A.cpp", []), "A.cpp");
  assert.equal(uniqueName("A.cpp", ["A.cpp"]), "A-2.cpp");
  assert.equal(uniqueName("A.cpp", ["A.cpp", "A-2.cpp"]), "A-3.cpp");
  assert.equal(uniqueName("workspace.json", ["workspace.json"]), "workspace-2.json");
});

test("merge: 多个旧目录合并进同一个目标目录", () => {
  const records = [
    { path: "arc234-第-234-场-arc234_a", type: "dir" },
    { path: "arc234-第-234-场-arc234_a/A.cpp", content: "a" },
    { path: "arc234-第-234-场-arc234_a/workspace.json", content: "{}" },
    { path: "arc234-第-234-场-arc234_b", type: "dir" },
    { path: "arc234-第-234-场-arc234_b/B.cpp", content: "b" },
  ];
  const plan = planFolderMerge(records, [
    { folder: "arc234-第-234-场-arc234_a", target: "arc234-第-234-场" },
    { folder: "arc234-第-234-场-arc234_b", target: "arc234-第-234-场" },
  ]);
  assert.deepEqual(
    plan.moves.map((m) => m.to).sort(),
    ["arc234-第-234-场/A.cpp", "arc234-第-234-场/B.cpp", "arc234-第-234-场/workspace.json"],
  );
  assert.deepEqual(plan.drops.sort(), ["arc234-第-234-场-arc234_a", "arc234-第-234-场-arc234_b"]);
  assert.ok(plan.folders.includes("arc234-第-234-场"));
});

test("merge: 目标里已有同名文件时改名，不覆盖", () => {
  const records = [
    { path: "c1-比赛-c1_a", type: "dir" },
    { path: "c1-比赛-c1_a/A.cpp", content: "old" },
    { path: "c1-比赛/A.cpp", content: "new" },
  ];
  const plan = planFolderMerge(records, [{ folder: "c1-比赛-c1_a", target: "c1-比赛" }]);
  assert.deepEqual(plan.moves, [{ from: "c1-比赛-c1_a/A.cpp", to: "c1-比赛/A-2.cpp" }]);
});

test("merge: 合并多个旧目录里的同名 workspace.json 也不互相覆盖", () => {
  const records = [
    { path: "c-赛-c_a", type: "dir" },
    { path: "c-赛-c_a/workspace.json", content: "a" },
    { path: "c-赛-c_b", type: "dir" },
    { path: "c-赛-c_b/workspace.json", content: "b" },
  ];
  const plan = planFolderMerge(records, [
    { folder: "c-赛-c_a", target: "c-赛" },
    { folder: "c-赛-c_b", target: "c-赛" },
  ]);
  const targets = plan.moves.map((m) => m.to);
  assert.equal(new Set(targets).size, targets.length);
  assert.ok(targets.includes("c-赛/workspace.json"));
  assert.ok(targets.some((t) => /workspace-2\.json$/.test(t)));
});

test("merge: 嵌套子目录随父目录一起搬", () => {
  const records = [
    { path: "c-赛-c_a", type: "dir" },
    { path: "c-赛-c_a/sub/helper.cpp", content: "h" },
  ];
  const plan = planFolderMerge(records, [{ folder: "c-赛-c_a", target: "c-赛" }]);
  assert.deepEqual(plan.moves, [{ from: "c-赛-c_a/sub/helper.cpp", to: "c-赛/sub/helper.cpp" }]);
  assert.ok(plan.folders.includes("c-赛/sub"));
});

test("merge: 目标就是自身或在其内部时跳过", () => {
  assert.deepEqual(planFolderMerge([{ path: "a/x.cpp" }], [{ folder: "a", target: "a" }]).moves, []);
  assert.deepEqual(planFolderMerge([{ path: "a/x.cpp" }], [{ folder: "a", target: "a/b" }]).moves, []);
});

test("merge: 没有目标时是空计划（幂等）", () => {
  const plan = planFolderMerge([{ path: "a/x.cpp" }], []);
  assert.deepEqual(plan, { moves: [], drops: [], folders: [], renames: [] });
});
