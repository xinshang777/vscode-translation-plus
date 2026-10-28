import { HttpError, requestJson, USER_AGENT } from '../util';
import type { Engine } from './types';

interface GoogleSegment extends Array<unknown> {
  0: string;
}

export const googleEngine: Engine = {
  id: 'google',
  name: 'Google 翻译',
  requiresKey: false,
  async translate(text: string, from: string, to: string, ctx): Promise<string> {
    const host = ctx.getConfig('google.endpoint', 'translate.googleapis.com').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const url =
      `https://${host}/translate_a/single?client=gtx&dt=t&ie=UTF-8&oe=UTF-8` +
      `&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}` +
      `&q=${encodeURIComponent(text)}`;
    let data: unknown;
    try {
      data = await requestJson<unknown>(url, {
        timeout: ctx.timeout,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
      });
    } catch (error) {
      if (error instanceof HttpError && (error.status === 429 || error.status === 403)) {
        throw new Error(`Google 免费接口不可用（HTTP ${error.status}，多为 IP 被限流或需要代理），建议切换到 Bing 引擎`);
      }
      throw error;
    }
    const sentences = Array.isArray(data) && Array.isArray((data as unknown[])[0]) ? ((data as unknown[])[0] as GoogleSegment[]) : [];
    const out = sentences
      .map((segment) => (Array.isArray(segment) ? String(segment[0] ?? '') : ''))
      .join('');
    if (!out.trim()) {
      throw new Error('Google 翻译返回空结果（接口可能被限流，建议换 Bing 或配置代理）');
    }
    return out;
  }
};
