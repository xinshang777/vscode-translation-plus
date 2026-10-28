import * as vscode from 'vscode';
import type { HistoryItem } from './dialog';

const HISTORY_KEY = 'translation.history.v1';

export function readHistoryFrom(state: vscode.Memento): HistoryItem[] {
  const items = state.get<HistoryItem[]>(HISTORY_KEY, []);
  return Array.isArray(items) ? items : [];
}

/** 历史记录面板（对应 ui/HistoryRenderer.kt），用只读文档呈现 */
export class HistoryProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  static readonly scheme = 'translation-history';
  static readonly uri = vscode.Uri.parse(`${HistoryProvider.scheme}://history/history.md`);

  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly state: vscode.Memento) {}

  provideTextDocumentContent(): string {
    const items = readHistoryFrom(this.state);
    if (items.length === 0) {
      return '# 翻译历史\n\n还没有记录。用 `Ctrl+Shift+O` 打开翻译对话框翻几句就会出现在这里。\n';
    }
    const lines = ['# 翻译历史', '', `共 ${items.length} 条（按时间倒序）`, '', '| 原文 | 译文 | 语言 | 引擎 | 时间 |', '| --- | --- | --- | --- | --- |'];
    const escape = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    for (const item of items) {
      lines.push(
        `| ${escape(item.source)} | ${escape(item.target)} | ${item.to} | ${escape(item.engine)} | ${new Date(
          item.at
        ).toLocaleString()} |`
      );
    }
    lines.push('');
    return lines.join('\n');
  }

  refresh(): void {
    this.emitter.fire(HistoryProvider.uri);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
