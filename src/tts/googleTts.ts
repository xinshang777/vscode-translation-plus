/**
 * 移植自 tts/GoogleTTSPlayer.kt：
 * - 官方方式：GET /v1/textToSpeech 返回 JSON，audioContent 是 base64
 * - 兜底方式：translate.google.com 的 translate_tts 直接返回 mp3（无需 key）
 */
import { requestBinary, requestJson } from '../util';

export interface GoogleTtsOptions {
  language: string;
  apiKey?: string;
  endpoint?: string;
  timeout?: number;
}

function googleLang(language: string): string {
  const value = language.toLowerCase();
  if (value.startsWith('zh-tw')) {
    return 'zh-TW';
  }
  if (value.startsWith('zh')) {
    return 'zh-CN';
  }
  if (value.startsWith('en-gb')) {
    return 'en-GB';
  }
  return value.startsWith('en') ? 'en' : value.slice(0, 2);
}

function looksLikeAudio(buffer: Buffer): boolean {
  if (buffer.length < 500) {
    return false;
  }
  const head = buffer.subarray(0, 3).toString('latin1');
  // ID3 头 / MPEG 帧同步字 / RIFF
  return head.startsWith('ID3') || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) || head.startsWith('RIF');
}

export async function synthesizeGoogle(text: string, options: GoogleTtsOptions): Promise<Buffer> {
  const lang = googleLang(options.language);
  const timeout = options.timeout ?? 20000;

  if (options.apiKey) {
    const endpoint = (options.endpoint ?? 'https://texttospeech.googleapis.com').replace(/\/+$/, '');
    const body = JSON.stringify({
      input: { text },
      voice: { languageCode: lang },
      audioConfig: { audioEncoding: 'MP3' }
    });
    const data = await requestJson<{ audioContent?: string }>(`${endpoint}/v1/textToSpeech?key=${encodeURIComponent(options.apiKey)}`, {
      method: 'POST',
      timeout,
      retries: 0,
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (!data.audioContent) {
      throw new Error('Google TTS 未返回音频');
    }
    return Buffer.from(data.audioContent, 'base64');
  }

  const url =
    'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob' +
    `&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text.slice(0, 200))}`;
  const buffer = await requestBinary(url, {
    timeout,
    retries: 0,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'audio/mpeg,*/*'
    }
  });
  if (!looksLikeAudio(buffer)) {
    throw new Error('Google TTS 返回的不是音频（可能被限流或需要代理）');
  }
  return buffer;
}
