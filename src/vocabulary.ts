import * as vscode from 'vscode';
import { labelOf } from './languages';

export interface VocabularyItem {
  word: string;
  translation: string;
  from: string;
  to: string;
  engine: string;
  addedAt: number;
}

const KEY = 'translation.vocabulary.v1';

export class VocabularyStore {
  constructor(private readonly state: vscode.Memento) {}

  list(): VocabularyItem[] {
    const items = this.state.get<VocabularyItem[]>(KEY, []);
    return Array.isArray(items) ? items : [];
  }

  async add(item: VocabularyItem): Promise<boolean> {
    const items = this.list();
    if (items.some((existing) => existing.word === item.word)) {
      return false;
    }
    items.unshift(item);
    await this.state.update(KEY, items.slice(0, 500));
    return true;
  }

  async remove(word: string): Promise<boolean> {
    const items = this.list();
    const next = items.filter((item) => item.word !== word);
    if (next.length === items.length) {
      return false;
    }
    await this.state.update(KEY, next);
    return true;
  }

  async clear(): Promise<number> {
    const count = this.list().length;
    await this.state.update(KEY, []);
    return count;
  }

  toMarkdown(): string {
    const items = this.list();
    if (items.length === 0) {
      return '# 生词本\n\n还没有收藏的单词。选中单词后按 `Ctrl+Shift+X` 翻译，或在悬停卡片里点「收藏」。\n';
    }
    const lines = ['# 生词本', '', `共 ${items.length} 条`, '', '| 单词 | 译文 | 语言 | 引擎 | 收藏时间 |', '| --- | --- | --- | --- | --- |'];
    for (const item of items) {
      const time = new Date(item.addedAt).toLocaleString();
      const escape = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      lines.push(
        `| **${escape(item.word)}** | ${escape(item.translation)} | ${labelOf(item.to)} | ${escape(item.engine)} | ${time} |`
      );
    }
    lines.push('');
    return lines.join('\n');
  }
}

export class VocabularyProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  static readonly scheme = 'translation-vocabulary';
  static readonly uri = vscode.Uri.parse(`${VocabularyProvider.scheme}://生词本/生词本.md`);

  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly store: VocabularyStore) {}

  provideTextDocumentContent(): string {
    return this.store.toMarkdown();
  }

  refresh(): void {
    this.emitter.fire(VocabularyProvider.uri);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
