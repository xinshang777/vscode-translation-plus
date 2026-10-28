import { formEncode, requestJson, USER_AGENT } from '../util';
import type { Engine } from './types';
import { MissingCredentialError } from './types';

export const deeplEngine: Engine = {
  id: 'deepl',
  name: 'DeepL',
  requiresKey: true,
  async translate(text: string, from: string, to: string, ctx): Promise<string> {
    const key = await ctx.getSecret('deepl.apiKey', 'deepl.apiKey');
    if (!key) {
      throw new MissingCredentialError('未配置 DeepL API Key，请执行命令「Translation: 设置引擎 API Key」');
    }
    const endpoint = ctx.getConfig('deepl.endpoint', 'https://api-free.deepl.com/v2/translate');
    const params: Record<string, string> = { text, target_lang: to || 'ZH' };
    if (from && from !== 'auto') {
      params.source_lang = from;
    }
    const data = await requestJson<{ translations?: Array<{ text?: string }> }>(endpoint, {
      method: 'POST',
      timeout: ctx.timeout,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `DeepL-Auth-Key ${key}`,
        'User-Agent': USER_AGENT
      },
      body: formEncode(params)
    });
    const out = data.translations?.map((item) => item.text ?? '').join('') ?? '';
    if (!out.trim()) {
      throw new Error('DeepL 返回空译文');
    }
    return out;
  }
};
