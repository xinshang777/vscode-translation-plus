/**
 * 侧栏「翻译卡片」视图：用 Webview 画 IDEA 风格的卡片，随光标更新。
 * （VSCode 的 hover 只能渲染 Markdown，做不出这种外观，所以卡片走 Webview。）
 */
import * as vscode from 'vscode';
import { speakText, type TtsEngine } from './audio';
import { renderCardHtml, type CardSection } from './cardHtml';
import { conf } from './config';
import { isLookupableWord, lookupWord, type DictEntry } from './dictionary';
import { labelOf } from './languages';
import { wordRangeAt, type SelectionMode } from './plugin/camelCase';
import type { TranslationService } from './service';
import type { VocabularyStore } from './vocabulary';

export class CardViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'translationPlus.card';

  private view: vscode.WebviewView | undefined;
  private timer: NodeJS.Timeout | undefined;
  private lastKey = '';
  private pinned = false;
  private current:
    | { word: string; uri: string; start: number; end: number; translation: string; to: string; engine: string }
    | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly service: TranslationService,
    private readonly vocabulary: VocabularyStore
  ) {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(() => this.schedule()),
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule())
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = renderCardHtml(undefined);
    view.webview.onDidReceiveMessage((message: { command?: string }) => {
      void this.onMessage(message);
    });
    view.onDidDispose(() => {
      this.view = undefined;
      this.lastKey = '';
    });
    this.schedule(80);
  }

  private schedule(delay = 400): void {
    if (!this.view || this.pinned) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, delay);
  }

  private async refresh(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.view) {
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
      translation = '（翻译失败，看 Translation Plus 输出面板）';
      engine = this.service.engine.name;
    }

    const entry: DictEntry | undefined = isLookupableWord(word) ? await lookupWord(word) : undefined;
    this.current = { word, uri: document.uri.toString(), start, end, translation, to, engine };

    const accent = conf<string>('phoneticAccent', 'us');
    const sections: CardSection[] = [];
    const mainTranslation = translation.replace(/\s+/g, ' ').trim();
    // 释义里与译文完全相同的条目去掉，避免卡片里“同一句话出现两遍”
    const meanings = (entry?.meanings ?? []).filter(
      (meaning) => meaning.replace(/\s+/g, ' ').trim() !== mainTranslation
    );
    if (meanings.length > 0) {
      sections.push({ label: '释义', items: meanings });
    }
    if (entry?.forms?.length) {
      sections.push({ label: '词形', items: entry.forms.slice(0, 4) });
    }
    if (entry?.phrases?.length) {
      sections.push({ label: '短语', items: entry.phrases.slice(0, 3) });
    }
    if (entry?.examples?.length) {
      sections.push({
        label: '例句',
        items: entry.examples.slice(0, 2).map((example) => `${example.en}\u0001${example.zh}`)
      });
    }
    if (entry?.collins?.length) {
      sections.push({
        label: '柯林斯',
        items: entry.collins.slice(0, 2).map((item) => `${item.pos ? `${item.pos} ` : ''}${item.definition}`)
      });
    }
    if (entry?.englishDefs?.length) {
      sections.push({ label: '英英', items: entry.englishDefs.slice(0, 1) });
    }
    if (entry?.webTranslations?.length) {
      sections.push({ label: '网络释义', items: entry.webTranslations.slice(0, 2) });
    }

    if (this.view) {
      this.view.webview.html = renderCardHtml({
        word,
        phonetic: accent === 'uk' ? entry?.ukPhonetic : entry?.usPhonetic,
        translation,
        engine,
        to: labelOf(to),
        sections,
        pinned: this.pinned
      });
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
        await speakText(
          data.word,
          /[\u4e00-\u9fff]/.test(data.word) ? 'zh' : 'en',
          conf<string>('ttsEngine', 'edge') as TtsEngine
        );
        break;
      case 'save': {
        const added = await this.vocabulary.add({
          word: data.word,
          translation: data.translation,
          from: 'auto',
          to: data.to,
          engine: data.engine,
          addedAt: Date.now()
        });
        void vscode.window.showInformationMessage(added ? `已收藏「${data.word}」` : `「${data.word}」已在生词本`);
        break;
      }
      case 'replace': {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.toString() !== data.uri) {
          break;
        }
        const range = new vscode.Range(editor.document.positionAt(data.start), editor.document.positionAt(data.end));
        await editor.edit((builder) => builder.replace(range, data.translation));
        break;
      }
      case 'pin':
        this.pinned = !this.pinned;
        if (!this.pinned) {
          this.lastKey = '';
          this.schedule(50);
        } else if (this.view) {
          void vscode.window.showInformationMessage('卡片已钉住，不再跟随光标');
        }
        break;
      case 'detail':
        await vscode.commands.executeCommand('translation.showDictionaryDetail');
        break;
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
  }
}
