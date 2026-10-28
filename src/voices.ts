/** Edge TTS 语音列表（对应 tts/microsoft/EdgeTTSVoiceManager.kt） */
import { requestJson } from './util';

export interface EdgeVoice {
  ShortName: string;
  Locale: string;
  LocaleName: string;
  Gender: string;
  FriendlyName: string;
  Status?: string;
}

// 源码 constants.kt：EDGE_TTS_VOICES_URL = "https://api.msedgeservices.com/tts/cognitiveservices/voices/list"
const ENDPOINTS = [
  'https://api.msedgeservices.com/tts/cognitiveservices/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4',
  'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4'
];

let cached: { at: number; voices: EdgeVoice[] } | undefined;
const TTL = 30 * 60 * 1000;

export async function listEdgeVoices(timeout = 15000): Promise<EdgeVoice[]> {
  if (cached && Date.now() - cached.at < TTL) {
    return cached.voices;
  }
  let lastError: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const list = await requestJson<EdgeVoice[]>(endpoint, {
        timeout,
        retries: 0,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
      });
      const voices = Array.isArray(list) ? list.filter((voice) => voice.Status !== 'Deprecated') : [];
      if (voices.length > 0) {
        cached = { at: Date.now(), voices };
        return voices;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  return [];
}

/** 把语言码转成 Edge 的 locale：zh-CN、en-US… */
export function localeFor(language: string): string {
  const value = language.toLowerCase();
  if (value === 'zh-cn' || value === 'zh') {
    return 'zh-CN';
  }
  if (value === 'zh-tw') {
    return 'zh-TW';
  }
  if (value === 'en-gb') {
    return 'en-GB';
  }
  if (value === 'en') {
    return 'en-US';
  }
  return value.length === 5 ? value : value.slice(0, 2);
}
