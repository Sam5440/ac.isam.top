/**
 * FIM（Fill-in-the-Middle）提示模板预设。
 *
 * FIM 是代码补全模型的核心训练范式：模型同时看到光标前（prefix）与光标后
 * （suffix）的代码，生成中间片段。各模型家族的控制 token 不同，按下表拼装；
 * stop 序列用于在模型输出「结束符」时截断。
 *
 * 模板字段两种形态：
 *  - 三段式 { prefix, suffix, middle }：`prefix + P + suffix + S + middle`
 *    （Qwen/StarCoder2/CodeGemma/Yi 等）
 *  - deepseek：`<|fim▁begin|>P<|fim▁hole|>S<|fim▁end|>`
 *  - codellama：`<PRE> P <SUF>S <MID>`（注意空格是模板的一部分）
 *  - none：不拼模板，纯 prefix（普通自回归），suffix 丢弃
 *  - custom：用户自定义，{prefix}/{suffix} 占位符
 */

export const FIM_TEMPLATES = [
  {
    id: 'qwen25',
    label: 'Qwen2.5-Coder / Qwen3-Coder',
    hint: '<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>',
    build: (p, s) => `<|fim_prefix|>${p}<|fim_suffix|>${s}<|fim_middle|>`,
    stops: ['<|fim_end|>', '<|endoftext|>', '<|im_end|>'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek-Coder (V1/V2)',
    hint: '<|fim▁begin|>…<|fim▁hole|>…<|fim▁end|>',
    build: (p, s) => `<|fim▁begin|>${p}<|fim▁hole|>${s}<|fim▁end|>`,
    stops: ['<|fim▁end|>', '<|EOT|>', '<｜end▁of▁sentence｜>'],
  },
  {
    id: 'starcoder2',
    label: 'StarCoder2 / StarCoder',
    hint: '<fim_prefix>…<fim_suffix>…<fim_middle>',
    build: (p, s) => `<fim_prefix>${p}<fim_suffix>${s}<fim_middle>`,
    stops: ['<fim_end>', '<|end_of_text|>'],
  },
  {
    id: 'codellama',
    label: 'CodeLlama',
    hint: '<PRE> … <SUF>… <MID>',
    build: (p, s) => `<PRE> ${p} <SUF>${s} <MID>`,
    stops: ['</CODE>', '<EOD>'],
  },
  {
    id: 'codegemma',
    label: 'CodeGemma',
    hint: '<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>',
    build: (p, s) => `<|fim_prefix|>${p}<|fim_suffix|>${s}<|fim_middle|>`,
    stops: ['<|fim_end|>', '<|file_separator|>', '<end_of_turn>'],
  },
  {
    id: 'yi-coder',
    label: 'Yi-Coder',
    hint: '<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>',
    build: (p, s) => `<|fim_prefix|>${p}<|fim_suffix|>${s}<|fim_middle|>`,
    stops: ['<|fim_end|>', '<|endoftext|>'],
  },
  {
    id: 'none',
    label: '无模板（纯前缀续写）',
    hint: '只发送光标前代码',
    build: (p) => p,
    stops: [],
  },
  {
    id: 'custom',
    label: '自定义模板…',
    hint: '用 {prefix} / {suffix} 作占位符',
    build: null, // 由 customTemplate 提供
    stops: [],
  },
];

export function fimTemplateById(id) {
  return FIM_TEMPLATES.find((t) => t.id === id) ?? FIM_TEMPLATES[0];
}

/** 按 AI 设置拼 FIM prompt；返回 { prompt, stops }。 */
export function buildFim(ai, prefix, suffix) {
  const tpl = fimTemplateById(ai.fimTemplate);
  let prompt;
  if (tpl.id === 'custom') {
    const raw = ai.customTemplate || '{prefix}';
    // replaceAll（AI-13）：模板里同一占位符可能出现多次,旧 replace 只替换
    // 首个,第二个 {prefix} 会原样发给模型
    prompt = raw.replaceAll('{prefix}', prefix).replaceAll('{suffix}', suffix ?? '');
  } else {
    prompt = tpl.build(prefix, suffix ?? '');
  }
  const stops = Array.isArray(ai.stopOverrides)
    ? ai.stopOverrides.filter(Boolean)
    : String(ai.stopOverrides || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
  return { prompt, stops: stops.length ? stops : tpl.stops };
}
