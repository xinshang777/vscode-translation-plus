import { formEncode, requestJson, sha256 } from '../util';
import type { Engine } from './types';
import { MissingCredentialError } from './types';

function truncate(text: string): string {
  const length = [...text].length;
  if (length <= 20) {
    return text;
  }
  return `${text.slice(0, 10)}${length}${text.slice(-10)}`;
}

export const youdaoEngine: Engine = {
  id: 'youdao',
  name: '有道智云',
  requiresKey: true,
  async translate(text: string, from: string, to: string, ctx): Promise<string> {
    const appKey = await ctx.getSecret('youdao.appKey', 'youdao.appKey');
    const appSecret = await ctx.getSecret('youdao.appSecret', 'youdao.appSecret');
    if (!appKey || !appSecret) {
      throw new MissingCredentialError('未配置有道 appKey / appSecret，请执行命令「Translation: 设置引擎 API Key」');
    }
    const salt = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const curtime = `${Math.floor(Date.now() / 1000)}`;
    const sign = sha256(appKey + truncate(text) + salt + curtime + appSecret);
    const body = formEncode({
      q: text,
      from: from || 'auto',
      to: to || 'zh-CHS',
      appKey,
      salt,
      sign,
      signType: 'v3',
      curtime
    });
    const data = await requestJson<{ errorCode?: string; translation?: string[] }>(
      'https://openapi.youdao.com/api',
      {
        method: 'POST',
        timeout: ctx.timeout,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      }
    );
    if (data.errorCode && data.errorCode !== '0') {
      throw new Error(`有道接口错误码 ${data.errorCode}（101 缺少 appKey，108 应用 ID 无效，202 签名校验失败，411 访问频率受限）`);
    }
    const out = (data.translation ?? []).join('\n');
    if (!out.trim()) {
      throw new Error('有道返回空译文');
    }
    return out;
  }
};
