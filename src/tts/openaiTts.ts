/**
 * 移植自 tts/OpenAiTTSPlayer.kt：POST {endpoint}/audio/speech 拿 mp3。
 */
import { requestBinary } from '../util';

export interface OpenAiTtsOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  voice: string;
  speed?: number;
  timeout?: number;
}

export async function synthesizeOpenAi(text: string, options: OpenAiTtsOptions): Promise<Buffer> {
  const base = options.endpoint.replace(/\/+$/, '');
  const body = JSON.stringify({
    model: options.model || 'tts-1',
    input: text,
    voice: options.voice || 'alloy',
    speed: options.speed ?? 1,
    response_format: 'mp3'
  });
  return requestBinary(`${base}/audio/speech`, {
    method: 'POST',
    timeout: options.timeout ?? 30000,
    retries: 0,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`
    },
    body
  });
}
