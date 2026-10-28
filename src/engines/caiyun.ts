import { requestJson } from '../util';
import type { Engine } from './types';
import { MissingCredentialError } from './types';

/** 彩云小译的 trans_type 是方向对，不是单语言码。 */
function transType(from: string, to: string): string {
  const target = to.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const source = from && from !== 'auto' ? (from.toLowerCase().startsWith('zh') ? 'zh' : 'en') : 'auto';
  if (source === target) {
    return target === 'zh' ? 'en2zh' : 'zh2en';
  }
  return `${source}2${target}`;
}

export const caiyunEngine: Engine = {
  id: 'caiyun',
  name: '彩云小译',
  requiresKey: true,
  async translate(text, from, to, ctx): Promise<string> {
    const token = await ctx.getSecret('caiyun.token', 'caiyun.token');
    if (!token) {
      throw new MissingCredentialError('未配置彩云小译 token，请执行命令「Translation: 设置引擎 API Key」');
    }
    const data = await requestJson<{
      target?: string[];
      message?: string;
    }>('https://api.interpreter.caiyunai.com/v1/translator', {
      method: 'POST',
      timeout: ctx.timeout,
      headers: {
        'Content-Type': 'application/json',
        'x-authorization': `token ${token}`
      },
      body: JSON.stringify({
        source: [text],
        trans_type: transType(from, to),
        request_id: `translation-plus-${Date.now()}`,
        detect: true
      })
    });

    if (!data.target || data.target.length === 0) {
      throw new Error(`彩云小译未返回译文${data.message ? `：${data.message}` : ''}`);
    }
    const out = data.target.join('\n');
    if (!out.trim()) {
      throw new Error('彩云小译返回空译文');
    }
    return out;
  }
};
