/** Codeforces 常见标签 → 简体中文（未收录的原样返回）。 */
const TAG_ZH = {
  '2-sat': '2-SAT',
  'binary search': '二分',
  'bitmasks': '位运算',
  'brute force': '暴力',
  'chinese remainder theorem': '中国剩余定理',
  'combinatorics': '组合数学',
  'constructive algorithms': '构造',
  'data structures': '数据结构',
  'dfs and similar': 'DFS 及类似',
  'divide and conquer': '分治',
  'dp': '动态规划',
  'dsu': '并查集',
  'expression parsing': '表达式解析',
  'fft': 'FFT',
  'flows': '网络流',
  'games': '博弈论',
  'geometry': '计算几何',
  'graph matchings': '图匹配',
  'graphs': '图论',
  'greedy': '贪心',
  'hashing': '哈希',
  'implementation': '模拟',
  'interactive': '交互题',
  'math': '数学',
  'matrices': '矩阵',
  'meet-in-the-middle': '折半搜索',
  'mst': '最小生成树',
  'number theory': '数论',
  'probabilities': '概率论',
  'schedules': '调度',
  'shortest paths': '最短路',
  'sortings': '排序',
  'string suffix structures': '后缀结构',
  'strings': '字符串',
  'ternary search': '三分',
  'trees': '树',
  'two pointers': '双指针',
  'xor': '异或',
  '*special problem': '特殊题',
  'special problem': '特殊题',
};

export function tagZh(tag) {
  return TAG_ZH[String(tag).toLowerCase()] ?? tag;
}

export function tagListZh(tags) {
  return (tags ?? []).map(tagZh);
}
