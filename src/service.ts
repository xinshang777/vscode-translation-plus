import * as vscode from 'vscode';
import { TranslationCache } from './cache';
import { conf, secretOrSetting } from './config';
import { ENGINES } from './engines';
import type { Engine, EngineContext } from './engines/types';
import { MissingCredentialError } from './engines/types';
import { engineCode, type EngineId } from './languages';
import { waitForSlot } from './rateLimit';
import { reindent, splitChunks, splitPieces, type SegmentMode } from './util';

export interface TranslateOutcome {
  text: string;
  from: string;
  to: string;
  engineId: EngineId;
  engineName: string;
  cached: boolean;
  elapsedMs: number;
}

export interface TranslateOptions {
  from?: string;
  to?: string;
  /** true 表示严格按 to 执行，不做中英自动互译 */
  force?: boolean;
}

export class TranslationService implements vscode.Disposable {
  readonly cache: TranslationCache;
  readonly channel: vscode.OutputChannel;
  private readonly inflight = new Map<string, Promise<TranslateOutcome>>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.cache = new TranslationCache(context.globalState, conf('cacheSize', 400));
    this.channel = vscode.window.createOutputChannel('Translation Plus');
  }

  get engineId(): EngineId {
    const id = conf<string>('engine', 'bing');
    return Object.prototype.hasOwnProperty.call(ENGINES, id) ? (id as EngineId) : 'google';
  }

  get engine(): Engine {
    return ENGINES[this.engineId];
  }

  listEngines(): Engine[] {
    return Object.values(ENGINES);
  }

  private engineContext(): EngineContext {
    return {
      getConfig: (key, defaultValue) => conf(key, defaultValue),
      getSecret: (key, settingKey) => secretOrSetting(this.context, key, settingKey),
      timeout: conf('timeout', 20000)
    };
  }

  /**
   * 中英自动互译（对应 IDEA 插件的“自动方向”）：
   * 目标语言是中文但原文几乎全是中文时，改译成英文；反之亦然。
   */
  resolveDirection(text: string, requested?: string): string {
    const target = requested ?? conf('targetLanguage', 'zh-CN');
    if (!conf('autoSwapDirection', true)) {
      return target;
    }
    const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
    const latin = (text.match(/[A-Za-z]/g) ?? []).length;
    // 目标中文、源文本以中文为主（哪怕只有两个字）→ 改译英文
    if (target.toLowerCase().startsWith('zh') && cjk >= 2 && cjk >= latin * 1.5) {
      return 'en';
    }
    if (target.toLowerCase().startsWith('en') && cjk > latin && cjk > 1) {
      return 'zh-CN';
    }
    return target;
  }

  async translate(text: string, options: TranslateOptions = {}): Promise<TranslateOutcome> {
    const primary = this.engineId;
    const fromInternal = options.from && options.from !== 'auto' ? options.from : conf('sourceLanguage', 'auto');
    const toInternal = options.force
      ? options.to ?? conf('targetLanguage', 'zh-CN')
      : this.resolveDirection(text, options.to);
    const primaryFrom = engineCode(primary, fromInternal);
    const primaryTo = engineCode(primary, toInternal);

    const cacheKey = this.cache.key(primary, primaryFrom, primaryTo, text);
    if (conf('cacheEnabled', true)) {
      const hit = this.cache.get(cacheKey);
      if (hit !== undefined) {
        return {
          text: hit,
          from: primaryFrom,
          to: primaryTo,
          engineId: primary,
          engineName: ENGINES[primary].name,
          cached: true,
          elapsedMs: 0
        };
      }
    }

    const running = this.inflight.get(cacheKey);
    if (running) {
      return running;
    }

    const startedAt = Date.now();
    const task = this.runChain(text, primary, fromInternal, toInternal)      .then(({ translated, engineId, from, to }) => {
        if (conf('cacheEnabled', true)) {
          this.cache.set(cacheKey, translated);
        }
        const outcome: TranslateOutcome = {
          text: translated,
          from,
          to,
          engineId,
          engineName: ENGINES[engineId].name,
          cached: false,
          elapsedMs: Date.now() - startedAt
        };
        this.channel.appendLine(
          `[${new Date().toLocaleTimeString()}] ${outcome.engineName} ${from} -> ${to} ${text.length} 字符 / ${outcome.elapsedMs}ms`
        );
        return outcome;
      })
      .catch((error: unknown) => {
        this.channel.appendLine(
          `[${new Date().toLocaleTimeString()}] 失败 ${ENGINES[primary].name} ${primaryFrom} -> ${primaryTo}: ${String(error)}`
        );
        throw error;
      })
      .finally(() => this.inflight.delete(cacheKey));

    this.inflight.set(cacheKey, task);
    return task;
  }

  /** 指定引擎翻译一次（用于全引擎连通性检测），不做回退 */
  async translateWithEngine(engineId: EngineId, text: string, toInternal: string): Promise<TranslateOutcome> {
    const engine = ENGINES[engineId];
    const ctx = this.engineContext();
    const from = engineCode(engineId, conf('sourceLanguage', 'auto'));
    const to = engineCode(engineId, toInternal);
    const started = Date.now();
    const translated = await engine.translate(text, from, to, ctx);
    return {
      text: translated,
      from,
      to,
      engineId,
      engineName: engine.name,
      cached: false,
      elapsedMs: Date.now() - started
    };
  }

  /** 引擎链：主引擎失败时按配置回退到其它免配置引擎。 */
  private chain(primary: EngineId): EngineId[] {
    if (!conf('fallbackEnabled', true)) {
      return [primary];
    }
    const free: EngineId[] = ['bing', 'google'];
    return [primary, ...free.filter((id) => id !== primary)];
  }

  private async runChain(
    text: string,
    primary: EngineId,
    fromInternal: string,
    toInternal: string
  ): Promise<{ translated: string; engineId: EngineId; from: string; to: string }> {
    const errors: string[] = [];
    for (const id of this.chain(primary)) {
      const engine = ENGINES[id];
      const from = engineCode(id, fromInternal);
      const to = engineCode(id, toInternal);
      try {
        await waitForSlot(id, conf('minInterval', 0));
        const translated = await this.run(engine, id, text, from, to);
        if (id !== primary) {
          this.channel.appendLine(`[fallback] ${ENGINES[primary].name} 失败，已回退到 ${engine.name}`);
        }
        return { translated, engineId: id, from, to };
      } catch (error) {
        if (error instanceof MissingCredentialError) {
          throw error;
        }
        errors.push(`${engine.name}: ${error instanceof Error ? error.message : String(error)}`);
        this.channel.appendLine(`[warn] ${engine.name} 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(errors.join(' ｜ '));
  }

  private async run(engine: Engine, engineId: EngineId, text: string, from: string, to: string): Promise<string> {
    const ctx = this.engineContext();
    const mode = conf<string>('segmentMode', 'whole') as SegmentMode;
    const usePieces = mode !== 'whole' && text.includes('\n');
    let result: string;

    if (usePieces) {
      // 增量翻译：逐行/逐句走片段缓存，改一行只请求这一行
      const pieces = splitPieces(text, mode);
      let output = '';
      let cursor = 0;
      let hits = 0;
      for (const piece of pieces) {
        // 片段之间的换行/空白必须原样保留
        output += text.slice(cursor, piece.start);
        cursor = piece.end;
        const core = piece.text.trim();
        if (!core) {
          output += piece.text;
          continue;
        }
        const coreStart = piece.text.indexOf(core);
        const lead = piece.text.slice(0, coreStart);
        const trail = piece.text.slice(coreStart + core.length);
        const key = this.cache.key(`${engineId}#piece`, from, to, core);
        const cached = conf('cacheEnabled', true) ? this.cache.get(key) : undefined;
        if (cached !== undefined) {
          hits++;
          output += lead + cached + trail;
          continue;
        }
        const translated = await this.translateUnit(engine, from, to, ctx, core);
        if (conf('cacheEnabled', true)) {
          this.cache.set(key, translated);
        }
        output += lead + translated + trail;
      }
      output += text.slice(cursor);
      this.channel.appendLine(
        `[incremental] ${mode} 模式：${pieces.length} 段，缓存命中 ${hits} 段，实际请求 ${pieces.length - hits} 段`
      );
      result = output;
    } else {
      result = await this.translateUnit(engine, from, to, ctx, text);
    }

    if (result.trim().length === 0) {
      throw new Error('引擎返回空译文');
    }
    if (conf('preserveIndent', true)) {
      result = reindent(result, text);
    }
    return result;
  }

  private async translateUnit(
    engine: Engine,
    from: string,
    to: string,
    ctx: EngineContext,
    text: string
  ): Promise<string> {
    const maxChunk = engine.id === 'openai' || engine.id === 'custom' ? 6000 : 3000;
    const chunks = splitChunks(text, maxChunk);
    const parts: string[] = [];
    for (const chunk of chunks) {
      if (!chunk.trim()) {
        parts.push(chunk);
        continue;
      }
      parts.push(await engine.translate(chunk, from, to, ctx));
    }
    return parts.join('');
  }

  dispose(): void {
    this.cache.dispose();
    this.channel.dispose();
  }
}
