/**
 * B2：用 InlayHint 在注释行尾显示译文（对应 IDEA 的内联文档翻译）。
 * 网络请求不阻塞渲染：先返回已缓存的译文，未缓存的丢进队列，翻完再刷新。
 */
import * as vscode from 'vscode';
import { extractSpans } from './codeText';
import { conf } from './config';
import type { TranslationService } from './service';

const MAX_HINTS = 100;
const MAX_QUEUE = 60;

/** InlayHint 本身不可点击（没有 command 属性），把操作链接放进 tooltip，并用这里记住最近一条。 */
export const lastInlay: { text: string; translated: string } = { text: '', translated: '' };

export class CommentInlayHintsProvider implements vscode.InlayHintsProvider, vscode.Disposable {
  private readonly cache = new Map<string, string>();
  private readonly pending = new Set<string>();
  private readonly queue: string[] = [];
  private working = false;
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.emitter.event;

  constructor(private readonly service: TranslationService) {}

  async provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    _token: vscode.CancellationToken
  ): Promise<vscode.InlayHint[]> {
    if (!conf('inlayHints', false)) {
      return [];
    }
    const hints: vscode.InlayHint[] = [];
    const firstLine = Math.max(0, range.start.line - 2);
    const lastLine = Math.min(document.lineCount - 1, range.end.line + 2);

    for (let line = firstLine; line <= lastLine && hints.length < MAX_HINTS; line++) {
      const lineText = document.lineAt(line).text;
      if (!lineText.trim()) {
        continue;
      }
      for (const span of extractSpans(lineText, document.languageId, 'comments')) {
        const text = span.text.trim();
        if (text.length < 3 || !/[\p{L}]/u.test(text)) {
          continue;
        }
        const translated = this.cache.get(text);
        if (translated === undefined) {
          this.enqueue(text);
          continue;
        }
        const position = new vscode.Position(line, span.end);
        const hint = new vscode.InlayHint(position, ` → ${translated}`, vscode.InlayHintKind.Type);
        hint.paddingLeft = true;
        lastInlay.text = text;
        lastInlay.translated = translated;
        const tooltip = new vscode.MarkdownString(
          `**原文**\n\n${text}\n\n**译文**\n\n${translated}\n\n` +
            '[复制译文](command:translation.showInlayDetail) · [朗读原文](command:translation.speakInlayText)'
        );
        tooltip.isTrusted = true;
        hint.tooltip = tooltip;
        hints.push(hint);
      }
    }
    return hints;
  }

  private enqueue(text: string): void {
    if (this.pending.has(text) || this.cache.has(text) || this.queue.length >= MAX_QUEUE) {
      return;
    }
    this.pending.add(text);
    this.queue.push(text);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.working) {
      return;
    }
    this.working = true;
    try {
      while (this.queue.length > 0) {
        const text = this.queue.shift();
        if (text === undefined) {
          break;
        }
        try {
          const outcome = await this.service.translate(text);
          this.cache.set(text, outcome.text);
          if (this.cache.size > 400) {
            const first = this.cache.keys().next().value;
            if (first !== undefined) {
              this.cache.delete(first);
            }
          }
        } catch {
          this.cache.set(text, text);
        } finally {
          this.pending.delete(text);
        }
        this.scheduleFlush();
      }
    } finally {
      this.working = false;
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.refresh();
    }, 250);
  }

  refresh(): void {
    this.emitter.fire();
  }

  clear(): void {
    this.cache.clear();
    this.queue.length = 0;
    this.pending.clear();
    this.refresh();
  }

  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.emitter.dispose();
  }
}
