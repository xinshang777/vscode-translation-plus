import * as crypto from 'crypto';
import { requestJson } from '../util';
import { iso2 } from '../languages';
import type { Engine } from './types';
import { MissingCredentialError } from './types';

const HOST = 'open.volcengineapi.com';
const SERVICE = 'translate';
const REGION = 'cn-north-1';
const VERSION = '2020-06-01';
const ACTION = 'TranslateText';

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/** 火山引擎 V4 签名（HMAC-SHA256 派生链）。 */
export function volcSignature(options: {
  accessKeyId: string;
  secretKey: string;
  xDate: string;
  body: string;
  contentType: string;
  query: string;
}): { authorization: string; signedHeaders: string } {
  const { accessKeyId, secretKey, xDate, body, contentType, query } = options;
  const shortDate = xDate.slice(0, 8);
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalHeaders =
    `content-type:${contentType}\n` + `host:${HOST}\n` + `x-content-sha256:${sha256Hex(body)}\n` + `x-date:${xDate}\n`;
  const canonicalRequest = ['POST', '/', query, canonicalHeaders, signedHeaders, sha256Hex(body)].join('\n');

  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(secretKey, shortDate);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    signedHeaders,
    authorization:
      `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

export const volcengineEngine: Engine = {
  id: 'volcengine',
  name: '火山引擎翻译',
  requiresKey: true,
  async translate(text, from, to, ctx): Promise<string> {
    const accessKeyId = await ctx.getSecret('volcengine.accessKeyId', 'volcengine.accessKeyId');
    const secretKey = await ctx.getSecret('volcengine.secretKey', 'volcengine.secretKey');
    if (!accessKeyId || !secretKey) {
      throw new MissingCredentialError('未配置火山引擎 AK / SK，请执行命令「Translation: 设置引擎 API Key」');
    }

    const body = JSON.stringify({
      SourceLanguage: from === 'auto' ? 'auto' : iso2(from),
      TargetLanguage: iso2(to),
      TextList: [text]
    });
    const contentType = 'application/json';
    const xDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const query = `Action=${ACTION}&Version=${VERSION}`;
    const { authorization } = volcSignature({ accessKeyId, secretKey, xDate, body, contentType, query });

    const data = await requestJson<{
      ResponseMetadata?: { Error?: { Code?: string; Message?: string } };
      TranslationList?: Array<{ Translation?: string }>;
    }>(`https://${HOST}/?${query}`, {
      method: 'POST',
      timeout: ctx.timeout,
      headers: {
        Authorization: authorization,
        'Content-Type': contentType,
        Host: HOST,
        'X-Date': xDate,
        'X-Content-Sha256': sha256Hex(body)
      },
      body
    });

    const error = data.ResponseMetadata?.Error;
    if (error?.Code) {
      throw new Error(`火山引擎翻译错误 ${error.Code}: ${error.Message ?? ''}`);
    }
    const out = (data.TranslationList ?? []).map((item) => item.Translation ?? '').join('\n');
    if (!out.trim()) {
      throw new Error('火山引擎翻译返回空译文');
    }
    return out;
  }
};
