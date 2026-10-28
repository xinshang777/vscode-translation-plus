/**
 * 移植自 TranslationPlugin 的 tts/microsoft/*：
 * Edge TTS 走 WebSocket，一次握手可合成整句，返回 mp3。
 * 协议细节（speech.config / ssml / Path:turn.end / 二进制帧头）按源码实现。
 */
import * as crypto from 'crypto';
import WebSocket from 'ws';

// 两个端点都保留：新版 cognitiveservices 与老版 edge/v1，按顺序尝试。
// （老端点在新网络环境下已被弃用/拦截，实测本机 403；新版握手返回 200 但不成连接。）
export const EDGE_ENDPOINTS = [
  'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1',
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
];
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
// 源码 Http.kt：DEFAULT_CHROMIUM_VERSION = "155.0.4283.45"
//   getUserAgent()        → Chrome/<大版本>.0.0.0 … Edg/<大版本>.0.0.0
//   getSecMsGecVersion()  → "1-<完整四段版本>"
// 版本过旧会被服务端拒绝，所以这里跟源码一样可配置（对应 registry 键）。
const DEFAULT_CHROMIUM_VERSION = '155.0.4283.45';

function chromiumVersion(override?: string): string {
  const value = (override ?? '').trim();
  return /^\d+(\.\d+){3}$/.test(value) ? value : DEFAULT_CHROMIUM_VERSION;
}

function buildUserAgent(version: string): string {
  const major = version.split('.')[0];
  return (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    `Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`
  );
}

const ORIGIN: string = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';

const MAX_TEXT_LENGTH = 200;

/** 对应 DRM.generateSecMsGecToken：Windows file time 向下取整到 5 分钟，再拼 token 做 SHA256 大写。 */
export function secMsGecToken(token = TRUSTED_CLIENT_TOKEN, now = Date.now()): string {
  const ticks = BigInt(now) * 10000n + 116444736000000000n;
  const rounded = ticks - (ticks % 3000000000n);
  return crypto.createHash('sha256').update(`${rounded}${token}`).digest('hex').toUpperCase();
}

function uuid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** 对应源码里的 getTimestamp()：`EEE MMM dd yyyy HH:mm:ss 'GMT'Z (zzzz)` */
function timestamp(): string {
  const date = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (value: number) => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const gmt = `GMT${sign}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
  return (
    `${days[date.getDay()]} ${months[date.getMonth()]} ${pad(date.getDate())} ${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${gmt} (China Standard Time)`
  );
}

/** 语言 → Edge 语音名，对应 EdgeTTSVoiceManager.getDefaultVoiceName 的常用子集 */
const VOICES: Record<string, string> = {
  zh: 'zh-CN-XiaoxiaoNeural',
  'zh-cn': 'zh-CN-XiaoxiaoNeural',
  'zh-tw': 'zh-TW-HsiaoChenNeural',
  en: 'en-US-AriaNeural',
  'en-gb': 'en-GB-SoniaNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
  fr: 'fr-FR-DeniseNeural',
  de: 'de-DE-KatjaNeural',
  es: 'es-ES-ElviraNeural',
  ru: 'ru-RU-SvetlanaNeural',
  pt: 'pt-BR-FranciscaNeural',
  it: 'it-IT-ElsaNeural',
  ar: 'ar-SA-ZariyahNeural',
  th: 'th-TH-PremwadeeNeural',
  vi: 'vi-VN-HoaiMyNeural',
  id: 'id-ID-GadisNeural',
  hi: 'hi-IN-SwaraNeural',
  tr: 'tr-TR-EmelNeural',
  nl: 'nl-NL-ColetteNeural',
  pl: 'pl-PL-ZofiaNeural',
  uk: 'uk-UA-PolinaNeural'
};

export function voiceFor(language: string, override?: string): string {
  if (override && override.trim()) {
    return override.trim();
  }
  const key = language.toLowerCase();
  return VOICES[key] ?? VOICES[key.slice(0, 2)] ?? VOICES.en;
}

/** 对应源码的 splitSentence(200)：按标点/空格切，超长再硬切。 */
export function splitSentence(text: string, max = MAX_TEXT_LENGTH): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }
  if (normalized.length <= max) {
    return [normalized];
  }
  const pieces: string[] = [];
  const parts = normalized.split(/(?<=[?.,;:!。！？；：，])\s*/);
  let buffer = '';
  for (const part of parts) {
    if ((buffer + part).length <= max) {
      buffer += part;
      continue;
    }
    if (buffer) {
      pieces.push(buffer.trim());
      buffer = '';
    }
    if (part.length <= max) {
      buffer = part;
    } else {
      for (let i = 0; i < part.length; i += max) {
        pieces.push(part.slice(i, i + max));
      }
    }
  }
  if (buffer.trim()) {
    pieces.push(buffer.trim());
  }
  return pieces;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function speechConfig(): string {
  return (
    'X-Timestamp:' +
    timestamp() +
    '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
          }
        }
      }
    })
  );
}

function ssmlRequest(text: string, language: string, voice: string, rate: number): string {
  const langTag = language.length === 5 ? `${language.slice(0, 2)}-${language.slice(3).toUpperCase()}` : language;
  const ratePercent = `${rate >= 0 ? '+' : ''}${Math.round(rate * 100)}%`;
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${langTag}'>` +
    `<voice name='${voice}'><prosody rate='${ratePercent}' pitch='+0Hz'>${escapeXml(text)}</prosody></voice></speak>`;
  return (
    `X-RequestId:${uuid()}\r\nContent-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${timestamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`
  );
}

export interface EdgeTtsOptions {
  language: string;
  voice?: string;
  rate?: number;
  timeout?: number;
  /** 指定端点，留空则按 EDGE_ENDPOINTS 顺序尝试 */
  endpoint?: string;
  /** Chromium 版本（如 "155.0.4283.45"），版本过旧会被服务端拒绝 */
  chromiumVersion?: string;
}

/** 合成整段文本，返回 mp3 字节。 */
export async function synthesizeEdge(text: string, options: EdgeTtsOptions): Promise<Buffer> {
  const sentences = splitSentence(text);
  if (sentences.length === 0) {
    return Buffer.alloc(0);
  }
  const voice = voiceFor(options.language, options.voice);
  const rate = options.rate ?? 0;
  const timeout = options.timeout ?? 20000;
  const connectionId = uuid();
  const attempts = options.endpoint && options.endpoint.trim() ? [options.endpoint.trim()] : EDGE_ENDPOINTS;
  const failures: string[] = [];
  for (const endpoint of attempts) {
    try {
      const buffer = await synthesizeOnEndpoint(
        endpoint,
        sentences,
        options.language,
        voice,
        rate,
        timeout,
        chromiumVersion(options.chromiumVersion)
      );
      if (buffer.length > 0) {
        return buffer;
      }
      failures.push(`${endpoint}: 没有音频返回`);
    } catch (error) {
      failures.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Edge TTS 合成失败（${failures.join(' ｜ ')}）`);
}

function synthesizeOnEndpoint(
  endpoint: string,
  sentences: string[],
  language: string,
  voice: string,
  rate: number,
  timeout: number,
  version: string
): Promise<Buffer> {
  // 源码 EdgeTTSSource.getWSSUri() 用的就是 Ocp-Apim-Subscription-Key，这里保持一致
  const url =
    `${endpoint}?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGecToken()}&Sec-MS-GEC-Version=1-${version}` +
    `&TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${uuid()}`;

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = new WebSocket(url, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': buildUserAgent(version),
        Origin: ORIGIN
      }
    });

    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Edge TTS 超时'));
    }, timeout);

    let index = 0;
    const next = () => {
      if (index < sentences.length) {
        socket.send(speechConfig());
        socket.send(ssmlRequest(sentences[index++], language, voice, rate));
      } else {
        clearTimeout(timer);
        socket.close();
        resolve(Buffer.concat(chunks));
      }
    };

    socket.on('open', next);

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const headerLength = data.readUInt16BE(0);
        const header = data.subarray(2, 2 + headerLength).toString('utf8');
        if (header.includes('Path:audio')) {
          chunks.push(data.subarray(2 + headerLength));
        }
        return;
      }
      const message = data.toString('utf8');
      if (message.includes('Path:turn.end')) {
        next();
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    socket.on('close', (code, reason) => {
      if (chunks.length === 0 && code !== 1000) {
        clearTimeout(timer);
        reject(new Error(`连接关闭（${code}）${reason.toString()}`));
      }
    });
  });
}
