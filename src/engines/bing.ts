import { formEncode, HttpError, requestFollow, requestJson, USER_AGENT } from '../util';
import type { Engine } from './types';

interface BingToken {
  host: string;
  ig: string;
  iid: string;
  key: string;
  token: string;
  expireAt: number;
}

let cached: BingToken | undefined;

function parseToken(html: string, host: string): BingToken {
  const ig = /IG:"([^"]+)"/.exec(html)?.[1];
  const iid = /data-iid="([^"]+)"/.exec(html)?.[1] ?? 'translator.5023';
  const params =
    /params_AbusePreventionHelper\s*=\s*\[(-?\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*\]/.exec(html) ??
    /params_AbusePreventionHelper\s*=\s*\[\s*(-?\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)/.exec(html);
  if (!ig || !params) {
    throw new HttpError('无法从 Bing 页面解析翻译令牌（可能被风控，或需要代理/换成 cn.bing.com）');
  }
  const lifetime = Number(params[3]) > 0 ? Number(params[3]) : 3600000;
  return {
    host,
    ig,
    iid,
    key: params[1],
    token: params[2],
    expireAt: Date.now() + Math.max(60000, Math.min(lifetime, 3600000) - 60000)
  };
}

async function ensureToken(host: string, timeout: number): Promise<BingToken> {
  if (cached && cached.host === host && cached.expireAt > Date.now()) {
    return cached;
  }
  // 跟随重定向：国内访问 www.bing.com 常被跳到 cn.bing.com，
  // 令牌只能在签发它的那个域名上用，所以这里要记住最终域名。
  const page = await requestFollow(`https://${host}/translator`, {
    timeout,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  });
  const finalHost = new URL(page.url).host || host;
  cached = parseToken(page.body.toString('utf8'), finalHost);
  return cached;
}

export const bingEngine: Engine = {
  id: 'bing',
  name: 'Bing 翻译',
  requiresKey: false,
  async translate(text: string, from: string, to: string, ctx): Promise<string> {
    const host = ctx.getConfig('bing.endpoint', 'www.bing.com').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await ensureToken(host, ctx.timeout);
      const body = formEncode({
        fromLang: from || 'auto-detect',
        text,
        to,
        token: token.token,
        key: token.key
      });
      const url = `https://${token.host}/ttranslatev3?isVertical=1&&IG=${encodeURIComponent(token.ig)}&IID=${encodeURIComponent(token.iid)}`;
      try {
        const data = await requestJson<unknown>(url, {
          method: 'POST',
          timeout: ctx.timeout,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
            Referer: `https://${token.host}/translator`,
            Origin: `https://${token.host}`,
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
          },
          body,
          retries: 0
        });
        const list = Array.isArray(data) ? data : [];
        const first = list[0] as { translations?: Array<{ text?: string }> } | undefined;
        const out = first?.translations?.map((item) => item.text ?? '').join('') ?? '';
        if (out.trim()) {
          return out;
        }
        lastError = new Error('Bing 返回空译文');
      } catch (error) {
        lastError = error;
        const status = error instanceof HttpError ? error.status : undefined;
        // 令牌过期或风控时才刷新重试，其它错误直接抛出
        if (status !== 400 && status !== 401 && status !== 403 && status !== 429) {
          throw error;
        }
      }
      cached = undefined;
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
};
