import { requestJson, USER_AGENT } from '../util';
import { labelOf } from '../languages';
import type { Engine } from './types';
import { MissingCredentialError } from './types';

const DEFAULT_PROMPT = [
  '你是一个专业的翻译引擎。将用户提供的文本翻译成 {{to}}（源语言：{{from}}）。',
  '硬性要求：',
  '1. 只输出译文本身，不要解释、不要引号、不要 Markdown 代码块、不要“译文：”前缀。',
  '2. 完整保留原文的换行与缩进结构，逐行对应。',
  '3. 保留占位符与转义序列原样：{0} %s %d ${x} {{name}} \\n \\t 等。',
  '4. 代码标识符、类名、URL、文件路径不翻译。',
  '5. 如果原文已经是目标语言，原样返回原文。'
].join('\n');

function clean(raw: string): string {
  let out = raw.trim();
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(out);
  if (fence) {
    out = fence[1].trim();
  }
  if (out.length > 1 && /^("|“|「).*("|”|」)$/s.test(out)) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

export const openaiEngine: Engine = {
  id: 'openai',
  name: 'OpenAI 兼容接口',
  requiresKey: true,
  async translate(text: string, from: string, to: string, ctx): Promise<string> {
    const base = ctx.getConfig('openai.endpoint', 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = ctx.getConfig('openai.model', 'gpt-4o-mini');
    const key = await ctx.getSecret('openai.apiKey', 'openai.apiKey');
    if (!key) {
      throw new MissingCredentialError('未配置 API Key，请执行命令「Translation: 设置引擎 API Key」（本地 Ollama 可随便填一个值）');
    }
    const template = ctx.getConfig('openai.systemPrompt', '').trim();
    const system = (template.length > 0 ? template : DEFAULT_PROMPT)
      .replace(/\{\{to\}\}/g, `${labelOf(to)} (${to})`)
      .replace(/\{\{from\}\}/g, from === 'auto' ? '自动检测' : `${labelOf(from)} (${from})`);

    const body = JSON.stringify({
      model,
      temperature: 0,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text }
      ]
    });

    const data = await requestJson<{
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    }>(`${base}/chat/completions`, {
      method: 'POST',
      timeout: ctx.timeout,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'User-Agent': USER_AGENT
      },
      body
    });

    if (data.error?.message) {
      throw new Error(`接口返回错误：${data.error.message}`);
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new Error('接口返回空内容');
    }
    return clean(content);
  }
};
