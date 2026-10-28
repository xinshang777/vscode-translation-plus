import * as vscode from 'vscode';
import { conf } from './config';
import { labelOf, targetLanguages } from './languages';
import type { TranslationService } from './service';
import { speakText, type TtsEngine } from './audio';
import type { VocabularyStore } from './vocabulary';

export interface HistoryItem {
  source: string;
  target: string;
  from: string;
  to: string;
  engine: string;
  at: number;
}

const HISTORY_KEY = 'translation.history.v1';

export function readHistory(context: vscode.ExtensionContext): HistoryItem[] {
  const items = context.globalState.get<HistoryItem[]>(HISTORY_KEY, []);
  return Array.isArray(items) ? items : [];
}

async function pushHistory(context: vscode.ExtensionContext, item: HistoryItem): Promise<void> {
  const items = readHistory(context).filter((entry) => !(entry.source === item.source && entry.to === item.to));
  items.unshift(item);
  await context.globalState.update(HISTORY_KEY, items.slice(0, 100));
}

/** 对应 IDEA 的 “Show Translation Dialog”：输入 → 结果 → 复制/替换/朗读/收藏/历史/换语言。 */
export async function openTranslationDialog(
  context: vscode.ExtensionContext,
  service: TranslationService,
  vocabulary: VocabularyStore,
  refreshVocabulary: () => void
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
  const input = await vscode.window.showInputBox({
    title: '翻译对话框',
    prompt: `输入或粘贴要翻译的文本（当前引擎：${service.engine.name}）`,
    value: selected,
    ignoreFocusOut: true
  });
  if (input === undefined || input.trim().length === 0) {
    return;
  }

  const target = service.resolveDirection(input, conf('targetLanguage', 'zh-CN'));
  let outcome;
  try {
    outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '翻译中…', cancellable: false },
      () => service.translate(input, { to: target, force: true })
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`翻译失败：${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  await pushHistory(context, {
    source: input,
    target: outcome.text,
    from: outcome.from,
    to: target,
    engine: outcome.engineName,
    at: Date.now()
  });

  const actions = await vscode.window.showQuickPick(
    [
      { label: `$(clippy) ${outcome.text.split('\n')[0].slice(0, 80)}`, description: '复制译文', id: 'copy' },
      { label: '$(replace) 替换到编辑器选区', id: 'replace' },
      { label: '$(unmute) 朗读原文', id: 'speak' },
      { label: '$(star) 收藏到生词本', id: 'save' },
      { label: '$(history) 查看历史记录', id: 'history' },
      { label: '$(globe) 换个目标语言再翻', id: 'language' }
    ],
    {
      title: `${labelOf(target)} · ${outcome.engineName}`,
      placeHolder: outcome.text.replace(/\s*\n\s*/g, ' ⏎ ')
    }
  );
  if (!actions) {
    return;
  }

  switch (actions.id) {
    case 'copy':
      await vscode.env.clipboard.writeText(outcome.text);
      void vscode.window.setStatusBarMessage('$(check) 译文已复制', 3000);
      break;
    case 'replace': {
      if (!editor) {
        void vscode.window.showWarningMessage('没有打开的编辑器');
        break;
      }
      const range = editor.selection.isEmpty
        ? new vscode.Range(editor.selection.active, editor.selection.active)
        : editor.selection;
      await editor.edit((builder) => builder.replace(range, outcome.text));
      break;
    }
    case 'speak':
      await speakText(
        input,
        target.toLowerCase().startsWith('zh') ? 'zh' : 'en',
        conf<string>('ttsEngine', 'edge') as TtsEngine
      );
      break;
    case 'save':
      await vocabulary.add({
        word: input.slice(0, 120),
        translation: outcome.text,
        from: outcome.from,
        to: target,
        engine: outcome.engineName,
        addedAt: Date.now()
      });
      refreshVocabulary();
      void vscode.window.showInformationMessage('已收藏到生词本');
      break;
    case 'history': {
      const items = readHistory(context).map((item) => ({
        label: item.source.replace(/\s*\n\s*/g, ' ').slice(0, 60),
        description: item.target.replace(/\s*\n\s*/g, ' ').slice(0, 60),
        detail: `${labelOf(item.to)} · ${item.engine} · ${new Date(item.at).toLocaleString()}`
      }));
      if (items.length === 0) {
        void vscode.window.showInformationMessage('还没有历史记录');
        break;
      }
      await vscode.window.showQuickPick(items, { placeHolder: '历史记录（按时间倒序）' });
      break;
    }
    case 'language': {
      const pick = await vscode.window.showQuickPick(
        targetLanguages().map((lang) => ({ label: lang.label, description: lang.detail, id: lang.id })),
        { placeHolder: '选择目标语言' }
      );
      if (!pick) {
        break;
      }
      await vscode.workspace
        .getConfiguration('translation')
        .update('targetLanguage', pick.id, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`默认目标语言已改为 ${pick.label}`);
      break;
    }
    default:
      break;
  }
}

/**
 * B3 的 VSCode 等价物：扩展读不到输入框/弹窗里的选区（无 API），
 * 所以走「顶栏输入框（剪贴板预填）→ 顶部候选列表」这条链路：
 * 在任何输入框里 Ctrl+C，执行本命令，回车翻译，选中即可复制回剪贴板。
 */
export async function translateClipboardFlow(
  context: vscode.ExtensionContext,
  service: TranslationService,
  vocabulary: VocabularyStore,
  refreshVocabulary: () => void
): Promise<void> {
  let clipboardText = '';
  try {
    clipboardText = (await vscode.env.clipboard.readText()).trim();
  } catch {
    clipboardText = '';
  }

  const input = await vscode.window.showInputBox({
    title: '翻译（顶栏输入）',
    prompt: clipboardText
      ? '检测到剪贴板内容，已填入；回车直接翻译，也可以改'
      : '没有可读的剪贴板内容，请手动粘贴或输入',
    value: clipboardText.slice(0, 2000),
    ignoreFocusOut: true
  });
  if (!input || input.trim().length === 0) {
    return;
  }

  const target = service.resolveDirection(input, conf('targetLanguage', 'zh-CN'));
  let outcome;
  try {
    outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '翻译中…', cancellable: false },
      () => service.translate(input, { to: target, force: true })
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`翻译失败：${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  await pushHistory(context, {
    source: input,
    target: outcome.text,
    from: outcome.from,
    to: target,
    engine: outcome.engineName,
    at: Date.now()
  });

  const pick = await vscode.window.showQuickPick(
    [
      { label: outcome.text.replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 300), description: '选中即复制译文', id: 'copy' },
      { label: '$(clippy) 复制译文到剪贴板（回到原处 Ctrl+V）', id: 'copy' },
      { label: '$(unmute) 朗读原文', id: 'speak' },
      { label: '$(star) 收藏到生词本', id: 'save' },
      { label: '$(globe) 换目标语言再翻', id: 'language' }
    ],
    { title: `${labelOf(target)} · ${outcome.engineName}`, placeHolder: '选择要执行的操作' }
  );
  if (!pick) {
    return;
  }

  switch (pick.id) {
    case 'copy':
      await vscode.env.clipboard.writeText(outcome.text);
      void vscode.window.setStatusBarMessage('$(check) 译文已复制，可回原处粘贴', 4000);
      break;
    case 'speak':
      await speakText(
        input,
        target.toLowerCase().startsWith('zh') ? 'zh' : 'en',
        conf<string>('ttsEngine', 'edge') as TtsEngine
      );
      break;
    case 'save':
      await vocabulary.add({
        word: input.slice(0, 120),
        translation: outcome.text,
        from: outcome.from,
        to: target,
        engine: outcome.engineName,
        addedAt: Date.now()
      });
      refreshVocabulary();
      void vscode.window.showInformationMessage('已收藏到生词本');
      break;
    case 'language': {
      const languagePick = await vscode.window.showQuickPick(
        targetLanguages().map((lang) => ({ label: lang.label, description: lang.detail, id: lang.id })),
        { placeHolder: '选择目标语言' }
      );
      if (languagePick) {
        await vscode.workspace
          .getConfiguration('translation')
          .update('targetLanguage', languagePick.id, vscode.ConfigurationTarget.Global);
      }
      break;
    }
    default:
      break;
  }
}

function hoverToMarkdown(hovers: vscode.Hover[]): string {
  const blocks: string[] = [];
  for (const hover of hovers) {
    for (const content of hover.contents) {
      if (typeof content === 'string') {
        blocks.push(content);
      } else if (content instanceof vscode.MarkdownString) {
        blocks.push(content.value);
      } else {
        blocks.push(content.value);
      }
    }
  }
  return blocks
    .join('\n\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}

/** 对应 IDEA 的 “Translate Quick Documentation”：取光标处悬浮文档并翻译。 */
export async function translateHoverDocumentation(service: TranslationService): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('请先打开一个文件');
    return;
  }
  const position = editor.selection.active;
  let hovers: vscode.Hover[] = [];
  try {
    const result = await vscode.commands.executeCommand<vscode.Hover[] | undefined>(
      'vscode.executeHoverProvider',
      editor.document.uri,
      position
    );
    hovers = Array.isArray(result) ? result : [];
  } catch {
    hovers = [];
  }
  const markdown = hoverToMarkdown(hovers);
  if (!markdown) {
    void vscode.window.showWarningMessage('光标处没有可翻译的悬浮文档');
    return;
  }

  const target = service.resolveDirection(markdown, conf('targetLanguage', 'zh-CN'));
  let translated: string;
  try {
    translated = (
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '翻译文档…', cancellable: false },
        () => service.translate(markdown, { to: target, force: true })
      )
    ).text;
  } catch (error) {
    void vscode.window.showErrorMessage(`翻译失败：${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const document = await vscode.workspace.openTextDocument({
    content: `# 原文\n\n${markdown}\n\n---\n\n# 译文（${labelOf(target)}）\n\n${translated}\n`,
    language: 'markdown'
  });
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}
