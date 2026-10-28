import * as vscode from 'vscode';
import { onSpeakingChanged, stopAudio } from './audio';
import { registerCommands } from './commands';
import { conf } from './config';
import { setExtensionContext } from './contextHolder';
import { HistoryProvider } from './history';
import { CommentInlayHintsProvider } from './inlayHints';
import { TranslationHoverProvider } from './hover';
import { labelOf } from './languages';
import { TranslationService } from './service';
import { configureProxy } from './util';
import { VocabularyProvider, VocabularyStore } from './vocabulary';

let service: TranslationService | undefined;
let statusBar: vscode.StatusBarItem | undefined;

function updateStatusBar(): void {
  if (!statusBar || !service) {
    return;
  }
  const engine = service.engine;
  const target = labelOf(conf('targetLanguage', 'zh-CN'));
  const proxy = conf('proxy', '').trim();
  statusBar.text = `$(globe) ${engine.name} → ${target}`;
  const lines = [
    '**Translation Plus**',
    '',
    `- 引擎：${engine.name}`,
    `- 目标语言：${target}`,
    `- 划词翻译：${conf('hoverMode', 'selection')}`,
    `- 代理：${proxy || '未设置'}`,
    '',
    '`Ctrl+Shift+Y` 翻译　`Ctrl+Shift+X` 翻译并替换　`Ctrl+Shift+Alt+X` 预览差异',
    '',
    '点击切换引擎'
  ];
  const tooltip = new vscode.MarkdownString(lines.join('\n'));
  tooltip.isTrusted = true;
  statusBar.tooltip = tooltip;
  statusBar.show();
}

export function activate(context: vscode.ExtensionContext): void {
  setExtensionContext(context);
  service = new TranslationService(context);
  configureProxy(conf('proxy', ''));

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'translation.selectEngine';
  updateStatusBar();

  const vocabulary = new VocabularyStore(context.globalState);
  const vocabularyProvider = new VocabularyProvider(vocabulary);
  const historyProvider = new HistoryProvider(context.globalState);
  const hoverProvider = new TranslationHoverProvider(service);
  const inlayHintsProvider = new CommentInlayHintsProvider(service);

  // 朗读状态指示（对应 PlaybackStatus 的状态绑定）
  const speechStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  speechStatus.command = 'translation.stopSpeaking';
  speechStatus.text = '$(unmute) 朗读中…';
  speechStatus.tooltip = '点击停止朗读';
  onSpeakingChanged((speaking) => (speaking ? speechStatus.show() : speechStatus.hide()));

  context.subscriptions.push(
    statusBar,
    speechStatus,
    service,
    vocabularyProvider,
    historyProvider,
    inlayHintsProvider,
    { dispose: () => stopAudio() },
    ...registerCommands(context, service, vocabulary, vocabularyProvider, inlayHintsProvider),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider),
    vscode.languages.registerHoverProvider({ scheme: 'untitled' }, hoverProvider),
    vscode.languages.registerInlayHintsProvider({ scheme: 'file' }, inlayHintsProvider),
    vscode.languages.registerInlayHintsProvider({ scheme: 'untitled' }, inlayHintsProvider),
    vscode.workspace.registerTextDocumentContentProvider(VocabularyProvider.scheme, vocabularyProvider),
    vscode.workspace.registerTextDocumentContentProvider(HistoryProvider.scheme, historyProvider),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('translation')) {
        configureProxy(conf('proxy', ''));
        updateStatusBar();
      }
    })
  );

  service.channel.appendLine(
    `Translation Plus 已启动：引擎=${service.engine.name}，目标语言=${conf('targetLanguage', 'zh-CN')}，划词=${conf(
      'hoverMode',
      'selection'
    )}`
  );
}

export function deactivate(): void {
  void service?.cache.flush();
}
