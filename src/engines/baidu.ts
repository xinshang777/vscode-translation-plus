import { formEncode, md5, requestJson } from '../util';
import { iso2 } from '../languages';
import type { Engine } from './types';
import { MissingCredentialError } from './types';

const ENDPOINT = 'https://fanyi-api.baidu.com/api/trans/vip/translate';

/** 百度自己的语言码和 ISO 不完全一样 */
const MAP: Record<string, string> = {
  ja: 'jp',
  ko: 'kor',
  fr: 'fra',
  es: 'spa',
  vi: 'vie',
  'zh-tw': 'cht',
  'zh-cn': 'zh'
};

function baiduLang(id: string): string {
  if (!id || id === 'auto') {
    return 'auto';
  }
  return MAP[id.toLowerCase()] ?? iso2(id);
}

export const baiduEngine: Engine = {
  id: 'baidu',
  name: '百度翻译',
  requiresKey: true,
  async translate(text, from, to, ctx): Promise<string> {
    const appId = await ctx.getSecret('baidu.appId', 'baidu.appId');
    const appKey = await ctx.getSecret('baidu.appKey', 'baidu.appKey');
    if (!appId || !appKey) {
      throw new MissingCredentialError('未配置百度翻译 appId / 密钥，请执行命令「Translation: 设置引擎 API Key」');
    }
    const salt = String(Date.now());
    // 百度标准版：sign = md5(appid + q + salt + 密钥)
    const sign = md5(appId + text + salt + appKey);
    const data = await requestJson<{
      trans_result?: Array<{ dst?: string }>;
      error_code?: string;
      error_msg?: string;
    }>(ENDPOINT, {
      method: 'POST',
      timeout: ctx.timeout,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({
        q: text,
        from: baiduLang(from),
        to: baiduLang(to),
        appid: appId,
        salt,
        sign
      })
    });

    if (data.error_code && data.error_code !== '52000') {
      // 错误码表照抄 BaiduTranslator.errorMessageMap
      const codes: Record<string, string> = {
        '52001': '请求超时',
        '52002': '系统错误',
        '52003': '未授权用户（appId 无效）',
        '54000': '必填参数为空',
        '54001': '签名错误',
        '54003': '访问频率受限',
        '54004': '账户余额不足',
        '54005': '长 query 请求频繁',
        '58000': '客户端 IP 非法',
        '58001': '译文语言方向不支持',
        '58002': '服务当前已关闭',
        '90107': '认证未通过或未生效'
      };
      const code = data.error_code;
      throw new Error(`百度翻译错误 ${code}：${codes[code] ?? data.error_msg ?? '未知错误'}`);
    }
    const out = (data.trans_result ?? []).map((item) => item.dst ?? '').join('\n');
    if (!out.trim()) {
      throw new Error('百度翻译返回空译文');
    }
    return out;
  }
};
