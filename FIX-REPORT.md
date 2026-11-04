# AC 题库 · 修复报告

- **修复日期**:2026-11-05
- **配套文档**:全量测试过程与验收证据见 [TEST-REPORT.md](TEST-REPORT.md)
- **修复原则**:管线修根因(杜绝新增) + 数据修存量 + 渲染层兜底(即使再有脏数据也不破坏显示),三层防御

---

## 一、修复总览

| # | 问题 | 影响面 | 所在层 | 状态 |
|---|---|---|---|---|
| 1 | 中文译文整段显示为 JSON 源码 | **483 题**(471 可解码 + 9 截断 + 3 字面 `\n`) | 翻译管线 + 数据 | ✅ 已修复 |
| 2 | 块级/行内公式显示 LaTeX 源码(`\[`/`\(` 残留) | 19 题 + 2 题闭合符混用 | 渲染层 + 抓取管线 + 数据 | ✅ 已修复 |
| 3 | 不可见控制字符(NBSP/ZWSP/ESC/退格)破坏显示与编译 | 78 题 / NBSP 存量 19 475 处 | 渲染层 + 抓取管线 | ✅ 已修复 |
| 4 | KaTeX 抛错(矩阵公式缺列规格) | CF 1431i,全站唯一 4 处 | 数据 | ✅ 已修复 |
| 5 | 修复顺序缺陷(初版方案会误伤代码块内 `\(`) | 自测发现 | 渲染层 | ✅ 已修正 |

**代码变更 4 文件(+81/−13),数据变更 753 文件,`data/index.json` 已重建。**

---

## 二、根因链分析:#1 译文二次编码(影响最大)

### 2.1 故障链

```
LLM 输出 JSON
  ├─ 字符串值里含「原始控制字符」(真实换行/ESC)      → JSON.parse 失败
  ├─ 字符串值里含「未转义引号」(如 bodyZh 内的 "…")  → JSON.parse 失败
  └─ 输出被 max_tokens 截断,JSON 未闭合              → JSON.parse 失败
        ↓
extractJson() 返回 null
        ↓
translateStatement() 兜底路径误判:把【整段原始 JSON 文本】
当作翻译结果写入 statementZhMd / titleZh        ← 二次编码入库
        ↓
页面对照/中文模式渲染出 {"titleZh":"…","bodyZh":"…"} 原文
```

存量规模:471 题完整 JSON(可无损解码)、9 题截断 JSON(无法补全正文)、
3 题字面 `\n` 序列、465 题中文标题被错误值覆盖。

### 2.2 为什么 JSON.parse 会失败

LLM 即使被要求输出严格 JSON,仍会偶发两类违规:在字符串值里直接输出**原始换行符**
(JSON 规范要求转义为 `\n`),以及**忘记转义正文里的引号**。原文含 LaTeX
(`\d`、`\\` 等非标准转义序列)进一步提高了失败率。另外 9 题输出在 max_tokens
处截断,`bodyZh` 永远缺右括号,任何解析器都救不回完整正文。

---

## 三、代码修复明细

### 3.1 `scripts/lib/llm.mjs` — `parseLenientJson`(修根因,+38/−5)

**修复前**:`extractJson` 直接 `JSON.parse`,失败即返回 `null` → 兜底路径污染数据。

**修复后**:

```js
function parseLenientJson(t) {
  try { return JSON.parse(t); } catch {}
  // 字符串感知扫描:跟踪 in-string 状态,把字符串值内的原始
  // 控制字符(换行/回车/tab)换成合法转义后重试解析
  let out = ''; let inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr && c === '\\') { out += c + (t[i + 1] ?? ''); i++; continue; }
    if (c === '"') inStr = !inStr;
    if (inStr && c.charCodeAt(0) < 0x20) {
      out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : '';
      continue;
    }
    out += c;
  }
  try { return JSON.parse(out); } catch { return null; }
}
```

配套两道保险:

- **未转义引号场景**:信封正则 `"titleZh":"((?:[^"\\]|\\.)*)","bodyZh":"([\s\S]*)"` 直接按
  「最后一个右引号前全是正文」提取,再走 `unescapeLenient` 宽松反转义——标准转义序列还原,
  LaTeX 非标准序列(`\d` 等)与裸引号**原样保留**,不破坏数学公式。
- **截断场景(9 题)**:正文无法补全,`statementZhMd` 置 `null` → 站点回落本机实时 MT 渠道,
  CI 翻译任务下次自动重翻;可完整提取的 7 个中文标题保留。**宁可显示 MT 译文,不显示半截 JSON。**

### 3.2 `lib/render.js` — `sanitizeText`(渲染兜底,核心 11 行)

渲染前全局清洗,这些字符在正文中只可能是抓取/翻译残留:

| 字符 | 来源 | 危害 |
|---|---|---|
| `\u0000-\u0008\u000B-\u001F\u007F`(保留 `\t\n`) | HTML 实体解析残留、LLM 偶发 ESC | 乱码;ESC 被行内 `$…$` 规则误配对送进 KaTeX 渲染出**错误框** |
| 零宽字符 ZWSP/ZWNJ/ZWJ/BOM | MT 残留 | 公式内触发 KaTeX 异常;复制样例代码带进不可见字符导致 CE |
| 分数斜线 `⁄`(U+2044) | MT 把 `/` 替换的产物 | KaTeX 无字形 |
| NBSP(U+00A0) | `&nbsp;` 实体残留(存量 1.9 万处) | KaTeX 字形告警;复制样例后编译失败 |

```js
export function sanitizeText(md) {
  return String(md)
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u2044/g, '/')
    .replace(/\u00A0/g, ' ');
}
```

### 3.3 `lib/render.js` — `normalizeMathMarks`(定界符归一)

AtCoder 旧页面按字面量输出 `\(…\)` / `\[…\]` TeX 定界符(存量 19 题),站内渲染器不认识,
原样显示 LaTeX 源码。统一归一为 `$…$` / `$$…$$`:

```js
export function normalizeMathMarks(md) {
  return String(md)
    .replace(/(?<!\\)\\\[([\s\S]+?)\\\]/g, (_, t) => `$$${t}$$`)
    .replace(/(?<!\\)\\\(([\s\S]+?)\\\)/g, (_, t) => `$${t}$`);
}
```

前向 lookbehind `(?<!\\)` 排除 LaTeX 自身的 `\\[1em]` 行距与 `\\(` 换行,不误伤;
lookbehind 是零宽断言,相邻的 `\[…\]\[…\]` 均能正确转换(专项用例覆盖)。

### 3.4 `lib/render.js` — `renderRich` 执行顺序(自测中发现的缺陷修正)

初版方案把定界符归一放在代码块隔离之前,会把**代码块内的 `\(`** 一并转换,破坏算法代码。
修正后的顺序:

```
sanitizeText(全局清洗) → 代码块/行内代码 stash → normalizeMathMarks(仅正文)
→ CF 兼容标记提取($$$$$$ / $$$,先长后短) → marked 解析 → 占位符还原
```

公式提取时公式体内 tab 归一为空格(TeX 语义等价,消除 KaTeX 字形告警)。

### 3.5 抓取管线接入(防新增)

- `scripts/lib/atcoder.mjs`(+5/−1):入库前 `normalizeMathMarks(sanitizeText(sections.join('\n\n').trim()))`,与站内渲染同口径;
- `scripts/lib/cf.mjs`(+3/−1):`normalizeCfMath` 首步接入 `sanitizeText`,再执行既有 `$$$$$$`/`$$$` 归一。

此后新抓取/新翻译的题面在入库与渲染两个环节都会被清洗,存量缺陷不会重演。

---

## 四、数据修复明细(753 文件)

执行 `repair-data.mjs`(宽松解析 + 信封提取 + 逐族修复,输出格式与 `store.mjs` 的
2 空格缩进 + 尾换行完全一致):

| 族 | 题数 | 处理 |
|---|---|---|
| 二次编码·完整 JSON | 471 | 解码提取 `bodyZh` → `statementZhMd`,嵌入 `titleZh` 为真中文时回填(465 题);解码后过 `sanitizeText` |
| 二次编码·截断 JSON | 9 | `statementZhMd` 置空待 CI 重翻;7 个可提取中文标题保留 |
| 字面 `\n` 序列 | 3 | 还原为真实换行(156b / 1988e / 290c) |
| 定界符混用 `\(…$` | 2 | 按行修复闭合符(arc141_b / 1726f 中文域) |
| `\begin{array}` 缺列规格 | 1 | 补 `{ccc}`(CF 1431i,英文+中文域,全站唯一 4 处) |
| `data/index.json` | 1 | `npm run index` 重建:problems=16 026 · contests=2 921 · translated=16 015(= 16 024 − 9 截断,符合预期) |

> 说明:控制字符/NBSP 的清洗主要在**渲染时兜底**(sanitizeText),未全量重写数据文件;
> 上表 471 题因解码重写顺带入库清洗版译文。

---

## 五、防回归机制

1. **渲染层兜底**:`sanitizeText` + `normalizeMathMarks` 常驻 `renderRich`,未来任何脏数据不再破坏显示;
2. **解析层根治**:`parseLenientJson` 接入 `extractJson`,控制字符/未转义引号的 LLM 输出可正常解析,兜底污染路径不再触发;
3. **抓取层同口径**:AtCoder/CF 管线入库前清洗,新数据源头干净;
4. **CI 自愈**:9 题置空译文由 CI 翻译任务自动重翻,无需人工跟进。

---

## 六、验证(摘要)

| 验证项 | 结果 |
|---|---|
| 16 026 题全量扫描 | 解析失败 0 · 定界符残留 0 · 控制字符残留 0 |
| 数学 token 逐个 KaTeX 渲染 | 899 853 个,异常 0 |
| 渲染边界用例 | 18/18(含代码块隔离、`\\[1em]` 不误伤、CF 兼容、未闭合 `$` 不崩溃) |
| `npm run index` / `next build` | translated=16 015 · 18 819 页全量预渲染成功 |
| 浏览器实测 | 13 项功能测试全过,修复题(abc156_f / abc139_d / CF 1431i)公式 0 错误 |

浏览器 13 项测试点明细与截图证据见 [TEST-REPORT.md](TEST-REPORT.md) 第四节
(`gui-test-screenshots/`,15 张)。

---

## 七、遗留事项(未修,已评估为低价值)

1. **187 题奇数 `$`**:MT 丢闭合 `$` 导致页面显示裸 `$` 字符,公式主体不受影响;自动修复歧义风险高,建议随下次全量重翻消化;
2. **远古题目抓取质量**(abc001 等最早批次):样例代码块围栏丢失、少量裸 TeX 无包裹,属历史数据形态,修复需重抓远古页面结构;
3. **9 题译文待 CI 重翻**:重翻完成前显示本机实时 MT 译文。

---

## 八、提交记录

| 提交 | 内容 |
|---|---|
| 1 | `fix` — 渲染层清洗/定界符归一 + LLM 宽松 JSON 解析(lib/render.js、scripts/lib/atcoder.mjs、cf.mjs、llm.mjs) |
| 2 | `data` — 753 文件数据修复 + index 重建 |
| 3 | `docs` — 测试报告 + 修复报告 + 测试截图 |
