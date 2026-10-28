/**
 * B5：侧栏常驻「翻译卡片」Webview 面板，随光标更新（对应 IDEA 的 Balloon 卡片）。
 */
import * as vscode from 'vscode';
import { conf } from './config';
import { isLookupableWord, lookupWord, type DictEntry } from './dictionary';
import { labelOf } from './languages';
import { wordRangeAt, type SelectionMode } from './plugin/camelCase';
import type { TranslationService } from './service';
import { speakText, type TtsEngine } from './audio';
import type { VocabularyStore } from './vocabulary';

interface CardData {
  word: string;
  translation: string;
  engine: string;
  to: string;
  phonetic?: string;
  meanings: string[];
  examples: Array<{ en: string; zh: string }>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml(data: CardData | undefined): string {
  if (!data) {
    return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
  .hint { color: var(--vscode-descriptionForeground); line-height: 1.7; }
</style></head><body>
  <h3>翻译卡片</h3>
  <p class="hint">把光标放到一个单词上，或选中一段文本，这里会显示词典释义与译文。</p>
</body></html>`;
  }

  const meanings = data.meanings.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const examples = data.examples
    .map((item) => `<blockquote>${escapeHtml(item.en)}<br/><span class="muted">${escapeHtml(item.zh)}</span></blockquote>`)
    .join('');

  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 14px; line-height: 1.6; }
  h2 { margin: 0 0 4px 0; font-size: 1.25em; }
  .phonetic { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); }
  .translation { font-size: 1.1em; margin: 10px 0; padding: 8px 10px;
    background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-foreground); }
  ul { margin: 6px 0 0 18px; padding: 0; }
  li { margin: 2px 0; }
  blockquote { margin: 6px 0; padding-left: 10px; border-left: 2px solid var(--vscode-editorIndentGuide-background); }
  .muted { color: var(--vscode-descriptionForeground); }
  .meta { margin-top: 12px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 6px 12px; border-radius: 2px; cursor: pointer; font-size: 0.95em; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:hover { opacity: 0.9; }
</style></head><body>
  <h2>${escapeHtml(data.word)}</h2>
  ${data.phonetic ? `<div class="phonetic">${escapeHtml(data.phonetic)}</div>` : ''}
  <div class="translation">${escapeHtml(data.translation)}</div>
  ${meanings ? `<ul>${meanings}</ul>` : ''}
  ${examples}
  <div class="meta">${escapeHtml(data.engine)} · 译成${escapeHtml(labelOf(data.to))}</div>
  <div class="actions">
    <button data-cmd="copy">复制译文</button>
    <button data-cmd="replace">替换原文</button>
    <button data-cmd="speak" class="secondary">朗读</button>
    <button data-cmd="save" class="secondary">收藏</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    for (const button of document.querySelectorAll('button[data-cmd]')) {
      button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.cmd }));
    }
  </script>
</body></html>`;
}

export class CardPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private timer: NodeJS.Timeout | undefined;
  private lastKey = '';
  private current: (CardData & { uri?: string; start?: number; end?: number }) | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly service: TranslationService,
    private readonly vocabulary: VocabularyStore
  ) {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(() => this.scheduleFollow()),
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleFollow())
    );
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }

  toggle(): void {
    if (this.panel) {
      this.panel.dispose();
      return;
    }
    this.panel = vscode.window.createWebviewPanel('translationCard', '翻译卡片', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    this.panel.webview.html = renderHtml(undefined);
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.lastKey = '';
    });
    this.panel.webview.onDidReceiveMessage((message: { command?: string }) => void this.onMessage(message));
    this.scheduleFollow(0);
  }

  private scheduleFollow(delay = 450): void {
    if (!this.panel) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refreshFromEditor();
    }, delay);
  }

  private async refreshFromEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.panel) {
      return;
    }
    const document = editor.document;
    const selection = editor.selection;
    let text = '';
    let start = 0;
    let end = 0;

    if (!selection.isEmpty) {
      text = document.getText(selection);
      start = document.offsetAt(selection.start);
      end = document.offsetAt(selection.end);
    } else {
      const line = document.lineAt(selection.active.line);
      const mode = conf<string>('selectionMode', 'INCLUSIVE') as SelectionMode;
      const span = wordRangeAt(line.text, selection.active.character, mode);
      if (!span) {
        return;
      }
      text = line.text.slice(span.start, span.end);
      start = document.offsetAt(new vscode.Position(selection.active.line, span.start));
      end = document.offsetAt(new vscode.Position(selection.active.line, span.end));
    }

    const word = text.trim();
    if (word.length < 2 || word.length > 200) {
      return;
    }
    const key = `${document.uri.toString()}|${start}|${word}`;
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;

    const to = this.service.resolveDirection(word, conf('targetLanguage', 'zh-CN'));
    let translation = '';
    let engine = '';
    try {
      const outcome = await this.service.translate(word, { to, force: true });
      translation = outcome.text;
      engine = outcome.engineName;
    } catch {
      translation = '（翻译失败，详情看 Translation Plus 输出面板）';
    }

    const entry: DictEntry | undefined = isLookupableWord(word) ? await lookupWord(word) : undefined;
    const accent = conf<string>('phoneticAccent', 'us');
    this.current = {
      word,
      translation,
      engine,
      to,
      phonetic: accent === 'uk' ? entry?.ukPhonetic : entry?.usPhonetic,
      meanings: entry?.meanings ?? [],
      examples: entry?.examples ?? [],
      uri: document.uri.toString(),
      start,
      end
    };
    if (this.panel) {
      this.panel.webview.html = renderHtml(this.current);
    }
  }

  private async onMessage(message: { command?: string }): Promise<void> {
    const data = this.current;
    if (!data) {
      return;
    }
    switch (message.command) {
      case 'copy':
        await vscode.env.clipboard.writeText(data.translation);
        void vscode.window.setStatusBarMessage('$(check) 译文已复制', 3000);
        break;
      case 'speak':
        await speakText(data.word, /[\u4e00-\u9fff]/.test(data.word) ? 'zh' : 'en', conf<string>('ttsEngine', 'edge') as TtsEngine);
        break;
      case 'save':
        await this.vocabulary.add({
          word: data.word,
          translation: data.translation,
          from: 'auto',
          to: data.to,
          engine: data.engine,
          addedAt: Date.now()
        });
        void vscode.window.showInformationMessage(`已收藏「${data.word}」`);
        break;
      case 'replace': {
        const editor = vscode.window.activeTextEditor;
        if (!editor || data.start === undefined || data.end === undefined) {
          break;
        }
        const range = new vscode.Range(editor.document.positionAt(data.start), editor.document.positionAt(data.end));
        await editor.edit((builder) => builder.replace(range, data.translation));
        break;
      }
      default:
        break;
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.panel?.dispose();
  }
}
