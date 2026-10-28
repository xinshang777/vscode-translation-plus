import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { conf, secretOrSetting } from './config';
import { requestBinary, USER_AGENT } from './util';
import { speak as speakSystem, stopSpeaking } from './tts';
import { synthesizeEdge, splitSentence } from './tts/edge';
import { synthesizeGoogle } from './tts/googleTts';
import { synthesizeOpenAi } from './tts/openaiTts';

/** 语音引擎，对应源码的 TTSEngine 枚举 + 词典音源 + 系统语音 */
export type TtsEngine = 'edge' | 'openai' | 'google' | 'dictionary' | 'system';

const FALLBACK_ORDER: TtsEngine[] = ['edge', 'google', 'dictionary', 'system'];

let player: ChildProcess | undefined;
let tempFile: string | undefined;
let speaking = false;
let lastGoodEngine: TtsEngine | undefined;
const speakingListeners: Array<(speaking: boolean) => void> = [];

/** 播放状态回调，对应 PlaybackStatus 的 bound 状态，用来驱动状态栏。 */
export function onSpeakingChanged(listener: (speaking: boolean) => void): void {
  speakingListeners.push(listener);
}

function setSpeaking(value: boolean): void {
  speaking = value;
  for (const listener of speakingListeners) {
    try {
      listener(value);
    } catch {
      /* ignore */
    }
  }
}

export function isSpeaking(): boolean {
  return speaking;
}

function cleanup(): void {
  if (tempFile) {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      /* ignore */
    }
    tempFile = undefined;
  }
}

function killPlayer(): void {
  stopSpeaking();
  if (player && !player.killed) {
    try {
      player.kill();
    } catch {
      /* ignore */
    }
  }
  player = undefined;
  setSpeaking(false);
  cleanup();
}

const WINDOWS_PLAYER = [
  '$ErrorActionPreference="Stop"',
  'Add-Type -AssemblyName PresentationCore',
  '$p = New-Object System.Windows.Media.MediaPlayer',
  '$p.Open([Uri]$env:TRANSLATION_AUDIO_FILE)',
  '$p.Play()',
  '$waited = 0',
  'while (-not $p.NaturalDuration.HasTimeSpan -and $waited -lt 3000) { Start-Sleep -Milliseconds 100; $waited += 100 }',
  'if ($p.NaturalDuration.HasTimeSpan) { $ms = [int]$p.NaturalDuration.TimeSpan.TotalMilliseconds } else { $ms = 1200 }',
  'Start-Sleep -Milliseconds ($ms + 300)',
  '$p.Close()'
].join('; ');

/** 播放并在结束后 resolve（用于逐句播放，尽量接近 IDEA 的流式播放） */
export function playFileAsync(file: string): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      setSpeaking(false);
      cleanup();
      resolve();
    };
    try {
      if (process.platform === 'win32') {
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_PLAYER],
          { windowsHide: true, stdio: 'ignore', env: { ...process.env, TRANSLATION_AUDIO_FILE: file } }
        );
        player = child;
        setSpeaking(true);
        child.once('exit', done);
        child.once('error', done);
        return;
      }
      const command = process.platform === 'darwin' ? 'afplay' : 'ffplay';
      const args = process.platform === 'darwin' ? [file] : ['-nodisp', '-autoexit', '-loglevel', 'quiet', file];
      const child = spawn(command, args, { stdio: 'ignore' });
      player = child;
      setSpeaking(true);
      child.once('exit', done);
      child.once('error', done);
    } catch {
      done();
    }
  });
}

/** 用系统播放器播放本地音频文件。 */
export function playFile(file: string): boolean {
  try {
    if (process.platform === 'win32') {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_PLAYER],
        { windowsHide: true, stdio: 'ignore', env: { ...process.env, TRANSLATION_AUDIO_FILE: file } }
      );
      player = child;
      setSpeaking(true);
      child.once('exit', () => {
        player = undefined;
        setSpeaking(false);
        cleanup();
      });
      return true;
    }
    if (process.platform === 'darwin') {
      player = spawn('afplay', [file], { stdio: 'ignore' });
      setSpeaking(true);
      player.once('exit', () => {
        setSpeaking(false);
        cleanup();
      });
      return true;
    }
    const candidates: Array<[string, string[]]> = [
      ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file]],
      ['mpg123', ['-q', file]],
      ['cvlc', ['--play-and-exit', '--quiet', file]]
    ];
    const child = spawn(candidates[0][0], candidates[0][1], { stdio: 'ignore' });
    child.once('error', () => {
      for (const [cmd, args] of candidates.slice(1)) {
        const fallback = spawn(cmd, args, { stdio: 'ignore' });
        fallback.once('error', () => undefined);
        player = fallback;
        return;
      }
    });
    player = child;
    return true;
  } catch {
    return false;
  }
}

function writeTemp(buffer: Buffer): string {
  const file = path.join(os.tmpdir(), `translation-plus-${Date.now()}.mp3`);
  fs.writeFileSync(file, buffer);
  tempFile = file;
  return file;
}

function dictionaryQuery(text: string, language: string): string {
  return language.toLowerCase().startsWith('zh')
    ? text.replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '')
    : text.replace(/[^\p{L}\p{N}'-]/gu, '');
}

function dictionaryAudioUrl(text: string, language: string, accent: string): string {
  const query = encodeURIComponent(dictionaryQuery(text, language));
  if (language.toLowerCase().startsWith('zh')) {
    return `https://dict.youdao.com/dictvoice?audio=${query}&le=zh&type=2`;
  }
  // type=2 美音，type=1 英音
  return `https://dict.youdao.com/dictvoice?audio=${query}&type=${accent === 'uk' ? 1 : 2}`;
}

/** 有道 dictvoice 是词典音源，只覆盖词条，长句会 500。 */
function canUseDictionary(text: string, language: string): boolean {
  const value = text.trim();
  if (!value) {
    return false;
  }
  if (language.toLowerCase().startsWith('zh')) {
    return !/\s/.test(value) && value.length <= 12;
  }
  return /^[\p{L}'-]+$/u.test(value) && value.length <= 24;
}

export interface SpeakOptions {
  engine?: TtsEngine;
  language: string;
  text: string;
}

export interface SpeakResult {
  engine: TtsEngine | 'none';
  played: boolean;
  error?: string;
}

/** 逐句合成、逐句播放：第一句就出声，接近 IDEA 的流式播放体验 */
async function playSentences(text: string, synth: (chunk: string) => Promise<Buffer>): Promise<boolean> {
  const sentences = splitSentence(text, 200);
  if (sentences.length === 0) {
    return false;
  }
  for (const sentence of sentences) {
    const buffer = await synth(sentence);
    if (buffer.length < 500) {
      return false;
    }
    await playFileAsync(writeTemp(buffer));
  }
  return true;
}

async function tryEngine(engine: TtsEngine, text: string, language: string): Promise<boolean> {
  try {
    if (engine === 'edge') {
      return await playSentences(text, (chunk) =>
        synthesizeEdge(chunk, {
          language,
          voice: conf('edgeVoice', ''),
          rate: conf('edgeRate', 0),
          chromiumVersion: conf('edgeChromiumVersion', ''),
          timeout: 8000
        })
      );
    }
    if (engine === 'google') {
      return await playSentences(text, (chunk) =>
        synthesizeGoogle(chunk, {
          language,
          apiKey: conf('google.ttsKey', ''),
          timeout: 8000
        })
      );
    }
    if (engine === 'openai') {
      const key = conf('openai.apiKey', '') || (await secretOrSettingValue('openai.apiKey'));
      if (!key) {
        return false;
      }
      return await playSentences(text, (chunk) =>
        synthesizeOpenAi(chunk, {
          endpoint: conf('openai.endpoint', 'https://api.openai.com/v1'),
          apiKey: key,
          model: conf('openai.ttsModel', 'tts-1'),
          voice: conf('openai.ttsVoice', 'alloy'),
          timeout: 20000
        })
      );
    }
    if (engine === 'dictionary') {
      if (!canUseDictionary(text, language)) {
        return false;
      }
      const buffer = await requestBinary(dictionaryAudioUrl(text, language, conf('phoneticAccent', 'us')), {
        timeout: 6000,
        retries: 0,
        headers: { 'User-Agent': USER_AGENT, Accept: 'audio/mpeg,*/*' }
      });
      if (buffer.length < 800) {
        return false;
      }
      return playFile(writeTemp(buffer));
    }
    return false;
  } catch {
    return false;
  }
}

async function secretOrSettingValue(key: string): Promise<string | undefined> {
  const { getExtensionContext } = await import('./contextHolder');
  const context = getExtensionContext();
  if (!context) {
    return undefined;
  }
  return context.secrets.get(key);
}

/**
 * 发音主入口：按配置的引擎尝试，失败自动降级。
 * 返回实际使用的引擎，便于状态栏提示。
 */
export async function speakText(text: string, language: string, engine?: TtsEngine): Promise<SpeakResult> {
  const value = text.trim();
  if (!value) {
    return { engine: 'none', played: false };
  }
  killPlayer();

  const preferred = engine ?? (conf<string>('ttsEngine', 'edge') as TtsEngine);
  // 记住上次成功的引擎，避免每次都先等 Edge 超时
  const order: TtsEngine[] = [];
  for (const candidate of [lastGoodEngine, preferred, ...FALLBACK_ORDER]) {
    if (candidate && !order.includes(candidate)) {
      order.push(candidate);
    }
  }
  const errors: string[] = [];

  for (const candidate of order) {
    if (candidate === 'system') {
      setSpeaking(true);
      speakSystem(value, () => setSpeaking(false));
      lastGoodEngine = 'system';
      return { engine: 'system', played: true };
    }
    const ok = await tryEngine(candidate, value, language);
    if (ok) {
      lastGoodEngine = candidate;
      return { engine: candidate, played: true };
    }
    errors.push(candidate);
  }

  speakSystem(value, () => setSpeaking(false));
  return { engine: 'system', played: true, error: `已降级：${errors.join('/')} 不可用` };
}

export function stopAudio(): void {
  killPlayer();
}
