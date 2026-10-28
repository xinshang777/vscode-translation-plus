import * as crypto from 'crypto';
import { requestJson } from '../util';
import { iso2 } from '../languages';
import type { Engine } from './types';
import { MissingCredentialError } from './types';

const HOST = 'tmt.tencentcloudapi.com';
const SERVICE = 'tmt';
const VERSION = '2018-03-21';

function hex(buffer: Buffer): string {
  return buffer.toString('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

export const tencentEngine: Engine = {
  id: 'tencent',
  name: '腾讯云翻译',
  requiresKey: true,
  async translate(text, from, to, ctx): Promise<string> {
    const secretId = await ctx.getSecret('tencent.secretId', 'tencent.secretId');
    const secretKey = await ctx.getSecret('tencent.secretKey', 'tencent.secretKey');
    if (!secretId || !secretKey) {
      throw new MissingCredentialError('未配置腾讯云 SecretId / SecretKey，请执行命令「Translation: 设置引擎 API Key」');
    }

    const payload = JSON.stringify({
      SourceText: text,
      Source: from === 'auto' ? 'auto' : iso2(from),
      Target: iso2(to),
      ProjectId: 0
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const contentType = 'application/json; charset=utf-8';

    const canonicalHeaders = `content-type:${contentType}\nhost:${HOST}\n`;
    const signedHeaders = 'content-type;host';
    const canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signedHeaders,
      crypto.createHash('sha256').update(payload, 'utf8').digest('hex')
    ].join('\n');

    const credentialScope = `${date}/${SERVICE}/tc3_request`;
    const stringToSign = [
      'TC3-HMAC-SHA256',
      String(timestamp),
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')
    ].join('\n');

    const secretDate = hmac(`TC3${secretKey}`, date);
    const secretService = hmac(secretDate, SERVICE);
    const secretSigning = hmac(secretService, 'tc3_request');
    const signature = hex(hmac(secretSigning, stringToSign));

    const authorization =
      `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const data = await requestJson<{
      Response?: { TargetText?: string; Source?: string; Error?: { Code?: string; Message?: string } };
    }>(`https://${HOST}`, {
      method: 'POST',
      timeout: ctx.timeout,
      headers: {
        Authorization: authorization,
        'Content-Type': contentType,
        Host: HOST,
        'X-TC-Action': 'TextTranslate',
        'X-TC-Version': VERSION,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': ctx.getConfig('tencent.region', 'ap-guangzhou')
      },
      body: payload
    });

    const error = data.Response?.Error;
    if (error?.Code) {
      throw new Error(`腾讯云翻译错误 ${error.Code}: ${error.Message ?? ''}（AuthFailure.SignatureFailure 签名错误，LimitExceeded 频率限制）`);
    }
    const out = data.Response?.TargetText ?? '';
    if (!out.trim()) {
      throw new Error('腾讯云翻译返回空译文');
    }
    return out;
  }
};
