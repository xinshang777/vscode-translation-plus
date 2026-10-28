import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';
import type { Duplex } from 'stream';
import { URL } from 'url';

/** 通过 CONNECT 隧道走 HTTP(S) 代理，代理配置由扩展层注入。 */
class TunnelAgent extends https.Agent {
  constructor(private readonly proxy: URL) {
    super({ keepAlive: true, maxSockets: 8 });
  }

  override createConnection(
    options: http.ClientRequestArgs,
    callback?: (err: Error | null, stream: Duplex) => void
  ): Duplex | null | undefined {
    if (!callback) {
      return undefined;
    }
    const finish = callback as (err: Error | null, stream?: Duplex) => void;
    const proxy = this.proxy;
    const proxyIsHttps = proxy.protocol === 'https:';
    const proxyPort = Number(proxy.port) || (proxyIsHttps ? 443 : 80);
    const host = String(options.host ?? options.hostname ?? '');
    const port = Number(options.port) || 443;
    const connectReq = (proxyIsHttps ? https : http).request({
      host: proxy.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers: { Host: `${host}:${port}` },
      timeout: 15000
    });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        finish(new HttpError(`代理 CONNECT 失败（HTTP ${res.statusCode}），请检查 translation.proxy`));
        return;
      }
      const secure = tls.connect({ socket, servername: host });
      secure.once('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
      secure.once('secureConnect', () => finish(null, secure));
    });
    connectReq.on('error', (error) => finish(error));
    connectReq.on('timeout', () => connectReq.destroy(new HttpError('代理连接超时')));
    connectReq.end();
    return undefined;
  }
}

let proxyUrl: string | undefined;
const agentCache = new Map<string, TunnelAgent>();

export function configureProxy(url: string | undefined): void {
  const normalized = url?.trim().replace(/\/+$/, '') ?? '';
  proxyUrl = normalized.length > 0 ? normalized : undefined;
  agentCache.clear();
}

function tunnelAgent(): TunnelAgent | undefined {
  if (!proxyUrl) {
    return undefined;
  }
  try {
    const parsed = new URL(proxyUrl);
    const cached = agentCache.get(proxyUrl);
    if (cached) {
      return cached;
    }
    const agent = new TunnelAgent(parsed);
    agentCache.set(proxyUrl, agent);
    return agent;
  } catch {
    return undefined;
  }
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

export class HttpError extends Error {
  public readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  retries?: number;
  /** 强制 IP 协议族（有的网络 IPv6 不通，强制 4 可绕过） */
  family?: 4 | 6;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function once(
  url: string,
  options: HttpOptions
): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  const { method = 'GET', headers = {}, body, timeout = 20000 } = options;
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new HttpError(`非法 URL: ${url}`));
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      reject(new HttpError(`不支持的协议: ${target.protocol}`));
      return;
    }
    const lib = target.protocol === 'https:' ? https : http;
    const finalHeaders: Record<string, string> = { ...headers };
    if (body !== undefined) {
      // 缺少 Content-Length 时 Node 会发 chunked，部分服务端（如 Bing）直接返回 411
      const hasLength = Object.keys(finalHeaders).some((key) => key.toLowerCase() === 'content-length');
      if (!hasLength) {
        finalHeaders['Content-Length'] = String(Buffer.byteLength(body, 'utf8'));
      }
    }
    const agent = target.protocol === 'https:' ? tunnelAgent() : undefined;
    const req = lib.request(
      target,
      {
        method,
        headers: finalHeaders,
        timeout,
        ...(agent ? { agent } : {}),
        ...(options.family ? { family: options.family } : {})
      },
      (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks),
          headers: res.headers
        })
      );
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new HttpError(`请求超时（${timeout}ms）`)));
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/** 发请求并返回文本。 */
export async function requestText(url: string, options: HttpOptions = {}): Promise<string> {
  const res = await requestBinary(url, options);
  return res.toString('utf8');
}

/** 带指数退避重试，并且最多跟随 3 次重定向（Bing 会把 www 跳到 cn.bing.com）。 */
export async function requestBinary(url: string, options: HttpOptions = {}): Promise<Buffer> {
  const result = await requestFollow(url, options);
  return result.body;
}

/** 同 requestBinary，但额外返回最终生效的 URL（跨域重定向后需要知道落到哪个域名）。 */
export async function requestFollow(
  url: string,
  options: HttpOptions = {}
): Promise<{ body: Buffer; url: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const res = await requestAttempt(current, options);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      const method = (options.method ?? 'GET').toUpperCase();
      const canFollow = method === 'GET' || method === 'HEAD' || res.status === 307 || res.status === 308;
      if (!canFollow) {
        throw new HttpError(`HTTP ${res.status}: 需要重定向到 ${String(res.headers.location)}`, res.status);
      }
      current = new URL(String(res.headers.location), current).toString();
      continue;
    }
    return { body: res.body, url: current };
  }
  throw new HttpError('重定向次数过多');
}

async function requestAttempt(
  url: string,
  options: HttpOptions
): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  const retries = options.retries ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await once(url, options);
      if (res.status >= 300 && res.status < 400) {
        return res;
      }
      if (res.status >= 400) {
        const err = new HttpError(`HTTP ${res.status}: ${res.body.toString('utf8').slice(0, 300)}`, res.status);
        if (res.status < 500 && res.status !== 429) {
          throw err;
        }
        lastError = err;
      } else {
        return res;
      }
    } catch (err) {
      lastError = err;
      if (
        err instanceof HttpError &&
        err.status !== undefined &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 429
      ) {
        break;
      }
    }
    if (attempt < retries) {
      await delay(400 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function requestJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const text = await requestText(url, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`响应不是合法 JSON: ${text.slice(0, 200)}`);
  }
}

export function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export function md5(input: string): string {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex');
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 按段落/句子边界切分长文本，避免超出单次请求上限。 */
export function splitChunks(text: string, max = 3500): string[] {
  if (text.length <= max) {
    return [text];
  }
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = Math.max(
      rest.lastIndexOf('\n\n', max),
      rest.lastIndexOf('\n', max),
      rest.lastIndexOf('. ', max),
      rest.lastIndexOf('。', max),
      rest.lastIndexOf('！', max),
      rest.lastIndexOf('？', max)
    );
    if (cut < max * 0.5) {
      cut = rest.lastIndexOf(' ', max);
    }
    if (cut < max * 0.3) {
      cut = max;
    }
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length) {
    parts.push(rest);
  }
  return parts;
}

/** 把译文按原文的行缩进重新对齐。 */
export function reindent(translated: string, original: string): string {
  if (!original.includes('\n')) {
    return translated;
  }
  const originalLines = original.split(/\r?\n/);
  const translatedLines = translated.split(/\r?\n/);
  const fixed = translatedLines.map((line, index) => {
    const source = originalLines[index];
    if (source === undefined || line.trim().length === 0) {
      return line;
    }
    const indent = /^[ \t]*/.exec(source)?.[0] ?? '';
    if (!indent) {
      return line;
    }
    if (line.startsWith(indent)) {
      return line;
    }
    return indent + line.replace(/^[ \t]+/, '');
  });
  return fixed.join('\n');
}

/** 支持 a.b.0.c 与 a[0].b 两种写法的取值。 */
export function dotGet(value: unknown, path: string): unknown {
  if (!path) {
    return value;
  }
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((key) => key.length > 0)
    .reduce<unknown>((acc, key) => {
      if (acc === null || acc === undefined) {
        return undefined;
      }
      return (acc as Record<string, unknown>)[key];
    }, value);
}

export function uniqKey(...parts: string[]): string {
  return parts.join('\u0001');
}

export type SegmentMode = 'whole' | 'line' | 'sentence';

export interface TextPiece {
  start: number;
  end: number;
  text: string;
}

/**
 * 把文本切成可独立翻译并缓存的片段（增量翻译的基础）。
 * 片段与原文严格对齐，拼接回去等于原文。
 */
export function splitPieces(text: string, mode: SegmentMode): TextPiece[] {
  if (mode === 'whole' || text.length === 0) {
    return [{ start: 0, end: text.length, text }];
  }
  const pieces: TextPiece[] = [];
  if (mode === 'line') {
    let offset = 0;
    for (const line of text.split('\n')) {
      pieces.push({ start: offset, end: offset + line.length, text: line });
      offset += line.length + 1;
    }
    return pieces;
  }
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const isTerminator =
      '。！？!?'.includes(ch) || (ch === '.' && (i + 1 >= text.length || /\s/.test(text[i + 1] ?? '')));
    if (isTerminator) {
      let end = i + 1;
      while (end < text.length && /["'”’）)】]/.test(text[end])) {
        end++;
      }
      pieces.push({ start, end, text: text.slice(start, end) });
      start = end;
      i = end - 1;
    } else if (ch === '\n') {
      pieces.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  if (start < text.length) {
    pieces.push({ start, end: text.length, text: text.slice(start) });
  }
  return pieces;
}
