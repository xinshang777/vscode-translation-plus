import * as crypto from 'crypto';
import { requestJson } from '../util';
import { iso2 } from '../languages';
import type { Engine } from './types';
import { MissingCredentialError } from './types';

const ENDPOINT = 'https://mt.cn-hangzhou.aliyuncs.com/';

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
}

/** 阿里云 RPC 风格签名：Base64(HMAC-SHA1(AccessKeySecret + "&", "GET&%2F&" + 规范化参数)) */
export function aliyunSignature(params: Record<string, string>, accessKeySecret: string): string {
  const stringToSign = `GET&%2F&${percentEncode(canonicalQuery(params))}`;
  return crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign, 'utf8').digest('base64');
}

export const aliyunEngine: Engine = {
  id: 'aliyun',
  name: '阿里云翻译',
  requiresKey: true,
  async translate(text, from, to, ctx): Promise<string> {
    const accessKeyId = await ctx.getSecret('aliyun.accessKeyId', 'aliyun.accessKeyId');
    const accessKeySecret = await ctx.getSecret('aliyun.accessKeySecret', 'aliyun.accessKeySecret');
    if (!accessKeyId || !accessKeySecret) {
      throw new MissingCredentialError('未配置阿里云 AccessKeyId / AccessKeySecret，请执行命令「Translation: 设置引擎 API Key」');
    }

    const params: Record<string, string> = {
      Action: 'TranslateGeneral',
      Version: '2018-10-12',
      Format: 'JSON',
      AccessKeyId: accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      RegionId: ctx.getConfig('aliyun.region', 'cn-hangzhou'),
      FormatType: 'text',
      Scene: 'general',
      SourceLanguage: from === 'auto' ? 'auto' : iso2(from),
      TargetLanguage: iso2(to),
      SourceText: text
    };
    params.Signature = aliyunSignature(params, accessKeySecret);

    const url = `${ENDPOINT}?${canonicalQuery(params)}`;
    const data = await requestJson<{
      Code?: string;
      Message?: string;
      Data?: { Translated?: string };
    }>(url, { method: 'GET', timeout: ctx.timeout });

    if (data.Code && data.Code !== '200' && data.Code !== 'OK') {
      throw new Error(`阿里云翻译错误 ${data.Code}: ${data.Message ?? ''}（InvalidAccessKeyId.NotFound / SignatureDoesNotMatch 需检查密钥）`);
    }
    const out = data.Data?.Translated ?? '';
    if (!out.trim()) {
      throw new Error('阿里云翻译返回空译文');
    }
    return out;
  }
};
