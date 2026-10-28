/**
 * B4：替换候选的 QuickPick + 侧栏实时预览。
 * createQuickPick + onDidChangeActive → 更新只读预览文档。
 */
import * as vscode from 'vscode';

interface PreviewState {
  original: string;
  candidates: string[];
  active: number;
}

const state: PreviewState = { original: '', candidates: [], active: 0 };

export class ReplacePreviewProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  static readonly scheme = 'translation-replace-preview';
  static readonly uri = vscode.Uri.parse(`${ReplacePreviewProvider.scheme}://preview/replace.md`);

  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  set(original: string, candidates: string[]): void {
    state.original = original;
    state.candidates = candidates;
    state.active = 0;
    this.refresh();
  }

  setActive(index: number): void {
    if (index === state.active) {
      return;
    }
    state.active = index;
    this.refresh();
  }

  clear(): void {
    state.original = '';
    state.candidates = [];
    this.refresh();
  }

  provideTextDocumentContent(): string {
    if (state.candidates.length === 0) {
      return '# 替换预览\n\n（暂无候选，选中一段文本后按 `Ctrl+Shift+X`）\n';
    }
    const chosen = state.candidates[state.active] ?? state.candidates[0];
    const lines = [
      '# 替换预览',
      '',
      '## 原文',
      '',
      '```text',
      state.original,
      '```',
      '',
      `## 将替换为（第 ${state.active + 1} / ${state.candidates.length} 个）`,
      '',
      '```text',
      chosen,
      '```',
      '',
      '## 全部候选',
      ''
    ];
    state.candidates.forEach((candidate, index) => {
      lines.push(`${index === state.active ? '**▶**' : '　'} \`${candidate}\``);
    });
    lines.push('', '> 在上方候选列表里上下移动即可实时预览；回车确认替换，Esc 取消。');
    return lines.join('\n');
  }

  refresh(): void {
    this.emitter.fire(ReplacePreviewProvider.uri);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
