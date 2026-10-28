import * as vscode from 'vscode';
import { extractSpans, isCodeLanguage, supportsComments, type TextSpan } from './codeText';
import { conf } from './config';
import { isLookupableWord, lookupWord, lookupWordDetailed, type DictEntry } from './dictionary';
import { docHoverState, nativeWordRange } from './docHover';
import type { CardPanel } from './cardPanel';
import { ReplacePreviewProvider } from './preview';
import { HistoryProvider } from './history';
import { lastLookup } from './hover';
import type { CommentInlayHintsProvider } from './inlayHints';
import { lastInlay } from './inlayHints';
import { labelOf, supportedTargets, targetLanguages, type EngineId } from './languages';
import type { TranslationService } from './service';
import { speakText, stopAudio, type TtsEngine } from './audio';
import { openTranslationDialog, translateClipboardFlow, translateHoverDocumentation } from './dialog';
import { applyReplaceFormat, type ReplaceFormat } from './identifiers';
import { anyNonLatin, splitCamelCaseWords, wordRangeAt, type SelectionMode } from './plugin/camelCase';
import { createReplaceElements } from './replace';
import { splitPieces } from './util';
import { listEdgeVoices, localeFor } from './voices';
import { VocabularyProvider, type VocabularyStore } from './vocabulary';

interface DocSlice {
  text: string;
  /** 在文档中的起始偏移 */
  startOffset: number;
}

interface SegmentResult {
  segment: TextSpan;
  translated: string;
}

interface WorkGroup {
  slice: DocSlice;
  segments: TextSpan[];
  results: SegmentResult[];
}

function progress<T>(title: string, task: (token: vscode.CancellationToken) => Promise<T>): Thenable<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    (_progress, token) => task(token)
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function reportError(service: TranslationService, error: unknown, action: string): Promise<void> {
  const message = describeError(error);
  service.channel.appendLine(`[error] ${action}: ${message}`);
  const pick = await vscode.window.showErrorMessage(`翻译失败：${message}`, '查看日志', '切换引擎');
  if (pick === '查看日志') {
    service.channel.show(true);
  } else if (pick === '切换引擎') {
    await vscode.commands.executeCommand('translation.selectEngine');
  }
}

/** 选区 > 光标单词 > 光标所在整行 */
/** 取词（可临时指定模式，供 Translate(Inclusive)/(Exclusive) 使用） */
function sliceFor(
  doc: vscode.TextDocument,
  full: string,
  selection: vscode.Selection | vscode.Range,
  modeOverride?: SelectionMode
): DocSlice | undefined {
  if (!selection.isEmpty) {
    const startOffset = doc.offsetAt(selection.start);
    return { text: full.slice(startOffset, doc.offsetAt(selection.end)), startOffset };
  }
  const position = 'active' in selection ? selection.active : selection.start;
  const line = doc.lineAt(position.line);
  // 自动取词（对应 WordSelections.getSelectionFromCurrentCaret）
  const mode = modeOverride ?? (conf<string>('selectionMode', 'INCLUSIVE') as SelectionMode);
  const span = wordRangeAt(line.text, position.character, mode);
  if (span) {
    const lineStart = doc.offsetAt(new vscode.Position(position.line, 0));
    return { text: line.text.slice(span.start, span.end), startOffset: lineStart + span.start };
  }
  const startOffset = doc.offsetAt(line.range.start);
  return { text: line.text, startOffset };
}

/** 支持多光标：每个光标/选区各自成为一组待翻译片段。 */
function collectTargets(editor: vscode.TextEditor): DocSlice[] {
  const doc = editor.document;
  const full = doc.getText();
  const seen = new Set<string>();
  const slices: DocSlice[] = [];
  const selections = editor.selections && editor.selections.length > 0 ? editor.selections : [editor.selection];
  for (const selection of selections) {
    const slice = sliceFor(doc, full, selection);
    if (!slice || slice.text.trim().length === 0) {
      continue;
    }
    const key = `${slice.startOffset}:${slice.text.length}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    slices.push(slice);
  }
  return slices;
}

/** 根据 codeScope 决定实际要翻译的片段 */
function segmentsFor(doc: vscode.TextDocument, slice: DocSlice): TextSpan[] {
  const scope = conf<string>('codeScope', 'selection');
  if (scope === 'selection' || !isCodeLanguage(doc.languageId)) {
    return [{ start: 0, end: slice.text.length, text: slice.text }];
  }
  const kind = scope === 'comments' ? 'comments' : 'commentsAndStrings';
  return extractSpans(slice.text, doc.languageId, kind, conf('smartStringFilter', true));
}

async function translateSegments(
  service: TranslationService,
  segments: TextSpan[],
  to: string | undefined,
  token?: vscode.CancellationToken,
  force = false
): Promise<SegmentResult[]> {
  const dedupe = new Map<string, string>();
  const results: SegmentResult[] = [];
  for (const segment of segments) {
    if (token?.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    let translated = dedupe.get(segment.text);
    if (translated === undefined) {
      const outcome = await service.translate(segment.text, { to, force });
      translated = outcome.text;
      dedupe.set(segment.text, translated);
    }
    results.push({ segment, translated });
  }
  return results;
}

function applySegments(source: string, results: SegmentResult[]): string {
  let output = '';
  let cursor = 0;
  for (const { segment, translated } of results) {
    output += source.slice(cursor, segment.start) + translated;
    cursor = segment.end;
  }
  return output + source.slice(cursor);
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** 把各组的替换结果展开成文档级编辑，并去掉重叠区间（多光标交叉时会重叠）。 */
function buildEdits(groups: WorkGroup[]): Edit[] {
  const edits: Edit[] = [];
  for (const group of groups) {
    for (const { segment, translated } of group.results) {
      edits.push({
        start: group.slice.startOffset + segment.start,
        end: group.slice.startOffset + segment.end,
        text: translated
      });
    }
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Edit[] = [];
  for (const edit of edits) {
    const last = merged[merged.length - 1];
    if (last && edit.start < last.end) {
      continue;
    }
    merged.push(edit);
  }
  return merged;
}

function renderEdits(source: string, edits: Edit[]): string {
  let output = '';
  let cursor = 0;
  for (const edit of edits) {
    output += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return output + source.slice(cursor);
}

async function applyReplace(editor: vscode.TextEditor, groups: WorkGroup[]): Promise<boolean> {
  const doc = editor.document;
  const edits = buildEdits(groups);
  if (edits.length === 0) {
    return false;
  }
  return editor.edit((builder) => {
    for (const edit of edits) {
      builder.replace(new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end)), edit.text);
    }
  });
}

async function showDiff(original: string, translated: string, title: string): Promise<void> {
  const left = await vscode.workspace.openTextDocument({ content: original, language: 'plaintext' });
  const right = await vscode.workspace.openTextDocument({ content: translated, language: 'plaintext' });
  await vscode.commands.executeCommand('vscode.diff', left.uri, right.uri, title, { preview: true });
}

/**
 * 照 ReplaceWithTranslationAction 的行为：取词 → 拆驼峰 → 翻译 → 生成多组命名候选 → 让用户选。
 * 只有一个候选且 autoReplace 打开时才直接替换。
 */
async function replaceWithCandidates(
  service: TranslationService,
  editor: vscode.TextEditor,
  group: WorkGroup
): Promise<void> {
  const doc = editor.document;
  const segment = group.segments[0];
  const raw = segment.text;
  const source = raw.trim();
  const processed = splitCamelCaseWords(source);
  // 源码：processedText.any(NON_LATIN_CONDITION) ? ENGLISH : primaryLanguage
  const nonLatin = anyNonLatin(processed);
  const primary = conf('targetLanguage', 'zh-CN');
  const target = nonLatin ? 'en' : primary;
  const isPlainText = conf<string>('codeScope', 'selection') === 'selection' && doc.languageId === 'plaintext';

  let translated: string;
  try {
    translated = (
      await progress(`翻译中（${labelOf(target)}）…`, () =>
        service.translate(processed, { to: target, force: true })
      )
    ).text;
  } catch (error) {
    await reportError(service, error, '翻译并替换');
    return;
  }

  const separators = conf('separators', '_ -');
  const candidates = createReplaceElements(translated, [], target.toLowerCase().startsWith('en'), isPlainText, separators);
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage('没有可替换的译文');
    return;
  }

  let chosen = candidates[0];
  if (!(candidates.length === 1 && conf('autoReplace', true))) {
    const picked = await pickCandidateWithPreview(candidates, source);
    if (!picked) {
      return;
    }
    chosen = picked;
  }

  const start = group.slice.startOffset + segment.start + (raw.length - raw.trimStart().length);
  const end = start + source.length;
  const ok = await editor.edit((builder) => {
    builder.replace(new vscode.Range(doc.positionAt(start), doc.positionAt(end)), chosen);
  });
  if (ok) {
    void vscode.window.setStatusBarMessage(`$(check) 已替换为 ${chosen}`, 3000);
    flashRanges(editor, [new vscode.Range(doc.positionAt(start), doc.positionAt(start + chosen.length))]);
  }
}

/** 替换后的高亮闪烁，对应源码的 RangeHighlighter box 效果 */
const flashDecoration =
  typeof vscode.window.createTextEditorDecorationType === 'function'
    ? vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        borderRadius: '3px'
      })
    : undefined;

function flashRanges(editor: vscode.TextEditor, ranges: vscode.Range[]): void {
  if (!flashDecoration || ranges.length === 0) {
    return;
  }
  editor.setDecorations(flashDecoration, ranges);
  setTimeout(() => {
    try {
      editor.setDecorations(flashDecoration, []);
    } catch {
      /* 编辑器可能已关闭 */
    }
  }, 1200);
}

function dictionaryMarkdown(word: string, entry?: DictEntry, translation?: string): string {
  const lines = [`# ${word}`];
  const phonetic = [entry?.ukPhonetic, entry?.usPhonetic].filter(Boolean).join('　');
  if (phonetic) {
    lines.push('', phonetic);
  }
  if (entry?.meanings.length) {
    lines.push('', '## 释义', ...entry.meanings.map((item) => `- ${item}`));
  }
  if (entry?.forms?.length) {
    lines.push('', '## 词形', ...entry.forms.map((item) => `- ${item}`));
  }
  if (entry?.phrases?.length) {
    lines.push('', '## 短语', ...entry.phrases.map((item) => `- ${item}`));
  }
  if (entry?.examples?.length) {
    lines.push('', '## 例句');
    for (const example of entry.examples) {
      lines.push(`> ${example.en}`, '>', `> ${example.zh}`, '');
    }
  }
  if (entry?.webTranslations?.length) {
    lines.push('', '## 网络释义', ...entry.webTranslations.map((item) => `- ${item}`));
  }
  if (entry?.englishDefs?.length) {
    lines.push('', '## 英英释义', ...entry.englishDefs.map((item) => `- ${item}`));
  }
  if (entry?.collins?.length) {
    lines.push('', '## 柯林斯释义');
    for (const item of entry.collins) {
      lines.push(`- ${item.pos ? `**${item.pos}** ` : ''}${item.definition}`);
      if (item.example) {
        lines.push(`  > ${item.example}`);
      }
    }
  }
  if (translation) {
    lines.push('', '## 翻译', translation);
  }
  return lines.join('\n');
}

async function showMarkdownBeside(content: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

let activePreview: ReplacePreviewProvider | undefined;

/**
 * B4：带侧栏实时预览的候选选择器。
 * 有 createQuickPick 时用它 + onDidChangeActive 驱动预览；没有则退回 showQuickPick。
 */
async function pickCandidateWithPreview(candidates: string[], source: string): Promise<string | undefined> {
  const preview = activePreview;
  if (preview) {
    try {
      const document = await vscode.workspace.openTextDocument(ReplacePreviewProvider.uri);
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
        preserveFocus: true
      });
    } catch {
      /* 预览文档打不开不影响选择 */
    }
  }

  if (typeof vscode.window.createQuickPick !== 'function') {
    const pick = await vscode.window.showQuickPick(
      candidates.map((value, index) => ({ label: value, index })),
      { title: '选择替换形式', placeHolder: source.slice(0, 80) }
    );
    preview?.clear();
    return pick?.label;
  }

  return new Promise<string | undefined>((resolve) => {
    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { index: number }>();
    quickPick.title = '选择替换形式（Esc 取消）';
    quickPick.placeholder = source.slice(0, 80);
    quickPick.matchOnDescription = true;
    quickPick.items = candidates.map((value, index) => ({ label: value, index }));
    let accepted: string | undefined;

    quickPick.onDidChangeActive((active) => {
      const first = active[0];
      if (first) {
        preview?.setActive(first.index);
      }
    });
    quickPick.onDidAccept(() => {
      accepted = quickPick.selectedItems[0]?.label;
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      preview?.clear();
      resolve(accepted);
    });
    quickPick.show();
  });
}

async function translateAndReplace(
  service: TranslationService,
  editor: vscode.TextEditor,
  to: string | undefined,
  forcePreview: boolean
): Promise<void> {
  const doc = editor.document;
  let slices = collectTargets(editor);
  // C1：替换路径也优先用语言服务词边界（与 PSI 取词最接近的替代）
  if (editor.selection.isEmpty && conf('languageServiceWordRange', true)) {
    const native = await nativeWordRange(doc, editor.selection.active);
    if (native) {
      const text = doc.getText(native);
      if (text.trim().length > 0) {
        slices = [{ text, startOffset: doc.offsetAt(native.start) }];
      }
    }
  }
  if (slices.length === 0) {
    void vscode.window.showWarningMessage('没有可翻译的文本：请选中内容，或把光标放到单词/行上');
    return;
  }

  const groups: WorkGroup[] = slices.map((slice) => ({
    slice,
    segments: segmentsFor(doc, slice).filter((segment) => segment.text.trim().length > 0),
    results: []
  }));
  const pending = groups.filter((group) => group.segments.length > 0);
  if (pending.length === 0) {
    void vscode.window.showWarningMessage(
      `当前范围模式「${conf<string>('codeScope', 'selection')}」下没有找到可翻译的注释或字符串`
    );
    return;
  }

  // 对应 Settings.replacementTranslateLanguageSelection：替换前先弹语言选择
  if (!to && conf('replacementLanguageSelection', false)) {
    const languagePick = await vscode.window.showQuickPick(
      supportedTargets(service.engineId, conf('filterLanguages', true)).map((lang) => ({
        label: lang.label,
        description: lang.detail,
        id: lang.id
      })),
      { placeHolder: '替换前选择目标语言' }
    );
    if (!languagePick) {
      return;
    }
    to = languagePick.id;
  }

  // 单一选区/单词：走源码 ReplaceWithTranslationAction 的候选式替换
  if (pending.length === 1 && pending[0].segments.length === 1 && !conf('previewBeforeReplace', false) && !forcePreview) {
    await replaceWithCandidates(service, editor, pending[0]);
    return;
  }

  const requested = to ?? conf('targetLanguage', 'zh-CN');
  const sampleText = pending
    .flatMap((group) => group.segments.map((segment) => segment.text))
    .join('\n');
  const target = to ? requested : service.resolveDirection(sampleText, requested);
  const targetLabel = labelOf(target);
  const flat = pending.flatMap((group) => group.segments);

  let results: SegmentResult[];
  try {
    results = await progress(`翻译中（${flat.length} 段 → ${targetLabel}）…`, (token) =>
      translateSegments(service, flat, target, token, true)
    );
  } catch (error) {
    await reportError(service, error, '翻译并替换');
    return;
  }

  let cursor = 0;
  for (const group of pending) {
    group.results = results.slice(cursor, cursor + group.segments.length);
    cursor += group.segments.length;
  }

  // 命名风格改写（IDEA 的 Replace with Translation > Separator）
  const replaceFormat = conf<string>('replaceFormat', 'original') as ReplaceFormat;
  if (replaceFormat !== 'original') {
    for (const group of pending) {
      for (const item of group.results) {
        item.translated = applyReplaceFormat(item.translated, replaceFormat);
      }
    }
  }

  const changed = pending.filter((group) => applySegments(group.slice.text, group.results) !== group.slice.text);
  if (changed.length === 0) {
    void vscode.window.showInformationMessage('译文与原文一致，无需替换');
    return;
  }

  if (forcePreview || conf('previewBeforeReplace', false)) {
    let before: string;
    let after: string;
    if (changed.length === 1) {
      before = changed[0].slice.text;
      after = applySegments(before, changed[0].results);
    } else {
      // 多光标：直接给整篇前后对比
      const edits = buildEdits(changed);
      before = doc.getText();
      after = renderEdits(before, edits);
    }
    await showDiff(before, after, `翻译预览（${targetLabel}）`);
    const pick = await vscode.window.showInformationMessage(
      `已生成「${targetLabel}」译文预览，是否应用？`,
      '应用并替换',
      '取消'
    );
    if (pick !== '应用并替换') {
      return;
    }
  }

  const applied = await applyReplace(editor, changed);
  if (applied) {
    const extra = changed.length > 1 ? `（${changed.length} 处）` : '';
    void vscode.window.setStatusBarMessage(`$(check) 已替换为${targetLabel}译文${extra}`, 3000);
    flashRanges(
      editor,
      buildEdits(changed).map(
        (edit) => new vscode.Range(editor.document.positionAt(edit.start), editor.document.positionAt(edit.end))
      )
    );
  } else {
    void vscode.window.showWarningMessage('替换失败：编辑器内容可能已被修改');
  }
}

async function translateOnly(service: TranslationService, mode?: SelectionMode): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('请先打开一个文件');
    return;
  }
  const doc = editor.document;
  // B6：优先用语言服务给的词边界（没有则回退正则取词）
  let slice = sliceFor(doc, doc.getText(), editor.selection, mode);
  if (slice && editor.selection.isEmpty && conf('languageServiceWordRange', true)) {
    const native = await nativeWordRange(doc, editor.selection.active);
    if (native && native.contains(editor.selection.active)) {
      const text = doc.getText(native);
      if (text.trim().length > 0) {
        slice = { text, startOffset: doc.offsetAt(native.start) };
      }
    }
  }
  if (!slice || slice.text.trim().length === 0) {
    void vscode.window.showWarningMessage('没有可翻译的文本');
    return;
  }
  const target = service.resolveDirection(slice.text);
  try {
    const outcome = await progress('翻译中…', () => service.translate(slice.text, { to: target, force: true }));
    service.channel.appendLine(
      `\n===== ${new Date().toLocaleString()} | ${outcome.engineName} | ${outcome.from} -> ${outcome.to} =====\n` +
        `--- 原文 ---\n${slice.text}\n--- 译文 ---\n${outcome.text}\n`
    );
    const dict = conf('dictionaryEnabled', true) && isLookupableWord(slice.text) ? await lookupWord(slice.text) : undefined;
    if (dict) {
      service.channel.appendLine(
        `--- 词典 ---\n${[dict.phonetic, ...dict.meanings].filter(Boolean).join('\n')}\n`
      );
    }
    const oneLine = outcome.text.replace(/\s*\n\s*/g, ' ⏎ ');
    const previewText = oneLine.length > 300 ? `${oneLine.slice(0, 300)}…` : oneLine;
    const dictLine = dict && dict.meanings.length > 0 ? `【${dict.phonetic ?? dict.word}】${dict.meanings.slice(0, 2).join('；')}\n` : '';
    const pick = await vscode.window.showInformationMessage(
      `${dictLine}【${outcome.engineName}｜${labelOf(target)}】${previewText}`,
      '替换',
      '复制',
      '朗读',
      '打开日志'
    );
    if (pick === '替换') {
      const group: WorkGroup = {
        slice,
        segments: [{ start: 0, end: slice.text.length, text: slice.text }],
        results: [{ segment: { start: 0, end: slice.text.length, text: slice.text }, translated: outcome.text }]
      };
      await applyReplace(editor, [group]);
    } else if (pick === '复制') {
      await vscode.env.clipboard.writeText(outcome.text);
      void vscode.window.setStatusBarMessage('$(check) 译文已复制', 3000);
    } else if (pick === '朗读') {
      await speakSmart(outcome.text);
    } else if (pick === '打开日志') {
      service.channel.show(true);
    }
  } catch (error) {
    await reportError(service, error, '翻译');
  }
}

async function translateCommentsInDocument(service: TranslationService): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const doc = editor.document;
  if (!supportsComments(doc.languageId)) {
    void vscode.window.showWarningMessage(`无法识别 ${doc.languageId} 的注释语法（可在设置中调整 translation.codeScope）`);
    return;
  }
  const full = doc.getText();
  const segments = extractSpans(full, doc.languageId, 'comments').filter(
    (segment) => /[\p{L}]/u.test(segment.text) && segment.text.trim().length > 1
  );
  if (segments.length === 0) {
    void vscode.window.showInformationMessage('当前文件中没有找到可翻译的注释');
    return;
  }
  const commentText = segments.map((segment) => segment.text).join('\n');
  const target = service.resolveDirection(commentText, conf('targetLanguage', 'zh-CN'));
  let results: SegmentResult[];
  try {
    results = await progress(`翻译注释（${segments.length} 条 → ${labelOf(target)}）…`, (token) =>
      translateSegments(service, segments, target, token, true)
    );
  } catch (error) {
    await reportError(service, error, '翻译注释');
    return;
  }
  const changed = results.filter((item) => item.translated.trim() !== item.segment.text.trim());
  if (changed.length === 0) {
    void vscode.window.showInformationMessage('所有注释都已是目标语言');
    return;
  }
  const applied = await applyReplace(editor, [{ slice: { text: full, startOffset: 0 }, segments, results: changed }]);
  if (applied) {
    void vscode.window.setStatusBarMessage(`$(check) 已翻译 ${changed.length} 条注释`, 4000);
  }
}

/** 粗略判断发音语言：中文占比够高就按中文发音 */
function voiceLanguage(text: string): string {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  return cjk > 0 && cjk >= text.length * 0.2 ? 'zh' : 'en';
}

/** 按配置的语音引擎发音，失败自动降级，并在状态栏提示实际用了哪个 */
async function speakSmart(text: string): Promise<void> {
  if (!text.trim()) {
    return;
  }
  try {
    const engine = conf<string>('ttsEngine', 'edge') as TtsEngine;
    const result = await speakText(text, voiceLanguage(text), engine);
    const names: Record<string, string> = {
      edge: 'Edge TTS',
      google: 'Google TTS',
      openai: 'OpenAI TTS',
      dictionary: '词典音源',
      system: '系统语音'
    };
    void vscode.window.setStatusBarMessage(`$(unmute) ${names[result.engine] ?? result.engine}`, 2500);
  } catch (error) {
    void vscode.window.showWarningMessage(`朗读失败：${describeError(error)}`);
  }
}

async function speakSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const doc = editor.document;
  const slice = sliceFor(doc, doc.getText(), editor.selection);
  if (!slice || !slice.text.trim()) {
    return;
  }
  await speakSmart(slice.text);
}

export function registerCommands(
  context: vscode.ExtensionContext,
  service: TranslationService,
  vocabulary: VocabularyStore,
  vocabularyProvider: VocabularyProvider,
  inlayHints?: CommentInlayHintsProvider,
  preview?: ReplacePreviewProvider,
  cardPanel?: CardPanel
): vscode.Disposable[] {
  const register = (id: string, handler: (...args: unknown[]) => unknown) =>
    vscode.commands.registerCommand(id, handler);

  activePreview = preview;

  const pickLookup = () => {
    const editor = vscode.window.activeTextEditor;
    const entry = lastLookup.value;
    if (!editor || !entry || entry.uri.toString() !== editor.document.uri.toString()) {
      return { editor, entry: undefined, range: undefined };
    }
    return { editor, entry, range: entry.range };
  };

  const disposables: vscode.Disposable[] = [
    register('translation.translate', () => translateOnly(service)),

    // 对应源码的 Translate(Inclusive) / Translate(Exclusive)
    register('translation.translateInclusive', () => translateOnly(service, 'INCLUSIVE')),
    register('translation.translateExclusive', () => translateOnly(service, 'EXCLUSIVE')),

    register('translation.openDialog', () =>
      openTranslationDialog(context, service, vocabulary, () => vocabularyProvider.refresh())
    ),

    register('translation.translateDocumentation', () => translateHoverDocumentation(service)),

    register('translation.translateAndReplace', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      await translateAndReplace(service, editor, undefined, false);
    }),

    register('translation.translateAndReplaceWithLanguage', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const pick = await vscode.window.showQuickPick(
        supportedTargets(service.engineId, conf('filterLanguages', true)).map((lang) => ({
          label: lang.label,
          description: lang.detail,
          id: lang.id
        })),
        { placeHolder: '选择目标语言（仅本次生效，已按当前引擎过滤）' }
      );
      if (!pick) {
        return;
      }
      await translateAndReplace(service, editor, pick.id, false);
    }),

    register('translation.previewTranslation', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      await translateAndReplace(service, editor, undefined, true);
    }),

    register('translation.copyTranslation', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      let slice = sliceFor(editor.document, editor.document.getText(), editor.selection);
      if (slice && editor.selection.isEmpty && conf('languageServiceWordRange', true)) {
        const native = await nativeWordRange(editor.document, editor.selection.active);
        if (native) {
          const text = editor.document.getText(native);
          if (text.trim().length > 0) {
            slice = { text, startOffset: editor.document.offsetAt(native.start) };
          }
        }
      }
      if (!slice || !slice.text.trim()) {
        return;
      }      try {
        const outcome = await progress('翻译中…', () => service.translate(slice.text));
        await vscode.env.clipboard.writeText(outcome.text);
        void vscode.window.setStatusBarMessage(`$(check) 译文已复制（${outcome.engineName}）`, 3000);
      } catch (error) {
        await reportError(service, error, '复制译文');
      }
    }),

    register('translation.translateDocumentComments', () => translateCommentsInDocument(service)),

    register('translation.speak', () => speakSelection()),
    register('translation.stopSpeaking', () => stopAudio()),

    register('translation.speakLast', async () => {
      const { entry } = pickLookup();
      if (entry) {
        await speakSmart(entry.text);
      } else {
        await speakSelection();
      }
    }),

    register('translation.copyLast', async () => {
      const { entry } = pickLookup();
      if (!entry) {
        await vscode.commands.executeCommand('translation.copyTranslation');
        return;
      }
      await vscode.env.clipboard.writeText(entry.translated);
      void vscode.window.setStatusBarMessage('$(check) 译文已复制', 3000);
    }),

    register('translation.replaceLast', async () => {
      const { editor, entry } = pickLookup();
      if (!editor || !entry) {
        return;
      }
      const current = editor.document.getText(entry.range);
      if (current.trim() !== entry.text.trim()) {
        void vscode.window.showWarningMessage('原文已变化，请重新悬停后再替换');
        return;
      }
      const ok = await editor.edit((builder) => builder.replace(entry.range, entry.translated));
      if (ok) {
        void vscode.window.setStatusBarMessage('$(check) 已替换', 3000);
      }
    }),

    register('translation.addLastToVocabulary', async () => {
      const { entry } = pickLookup();
      if (!entry) {
        void vscode.window.showWarningMessage('先把鼠标悬停在单词或译文上，再点「收藏」');
        return;
      }
      const added = await vocabulary.add({
        word: entry.text,
        translation: entry.translated,
        from: 'auto',
        to: entry.to,
        engine: entry.engine,
        addedAt: Date.now()
      });
      vocabularyProvider.refresh();
      void vscode.window.showInformationMessage(added ? `已收藏「${entry.text}」` : `「${entry.text}」已在生词本中`);
    }),

    register('translation.showVocabulary', async () => {
      const document = await vscode.workspace.openTextDocument(VocabularyProvider.uri);
      await vscode.window.showTextDocument(document, { preview: false });
    }),

    register('translation.clearVocabulary', async () => {
      const count = await vocabulary.clear();
      vocabularyProvider.refresh();
      void vscode.window.showInformationMessage(`生词本已清空（${count} 条）`);
    }),

    register('translation.translateClipboard', () =>
      translateClipboardFlow(context, service, vocabulary, () => vocabularyProvider.refresh())
    ),

    register('translation.toggleCardPanel', () => cardPanel?.toggle()),

    register('translation.toggleDocumentation', async () => {
      docHoverState.mode = docHoverState.mode === 'translated' ? 'original' : 'translated';
      void vscode.window.setStatusBarMessage(
        `$(book) 文档显示：${docHoverState.mode === 'translated' ? '译文' : '原文'}`,
        2500
      );
      try {
        await vscode.commands.executeCommand('editor.action.showHover');
      } catch {
        /* 某些编辑器上下文没有 hover */
      }
    }),

    register('translation.toggleInlayHints', async () => {
      const next = !conf('inlayHints', false);
      await vscode.workspace
        .getConfiguration('translation')
        .update('inlayHints', next, vscode.ConfigurationTarget.Global);
      inlayHints?.refresh();
      void vscode.window.showInformationMessage(`注释行尾译文：${next ? '已开启' : '已关闭'}`);
    }),

    register('translation.showInlayDetail', async (text: unknown, translated: unknown) => {
      const source = typeof text === 'string' && text ? text : lastInlay.text;
      const target = typeof translated === 'string' && translated ? translated : lastInlay.translated;
      if (!target) {
        void vscode.window.showInformationMessage('把鼠标移到注释行尾的译文上，tooltip 里有操作');
        return;
      }
      const pick = await vscode.window.showInformationMessage(`原文：${source}
译文：${target}`, '复制译文', '朗读原文');
      if (pick === '复制译文') {
        await vscode.env.clipboard.writeText(target);
        void vscode.window.setStatusBarMessage('$(check) 译文已复制', 3000);
      } else if (pick === '朗读原文') {
        await speakSmart(source);
      }
    }),

    register('translation.speakInlayText', () => speakSmart(lastInlay.text)),

    register('translation.showDictionaryDetail', async () => {
      const { entry } = pickLookup();
      const editor = vscode.window.activeTextEditor;
      const word = entry?.text ?? (editor ? sliceFor(editor.document, editor.document.getText(), editor.selection)?.text : undefined);
      if (!word || !word.trim()) {
        void vscode.window.showWarningMessage('先把光标放到单词上，或先悬停出卡片');
        return;
      }
      const dict = await lookupWord(word.trim());
      let translation = entry?.translated;
      if (!translation) {
        try {
          translation = (await service.translate(word.trim())).text;
        } catch {
          translation = undefined;
        }
      }
      await showMarkdownBeside(dictionaryMarkdown(word.trim(), dict, translation));
    }),

    register('translation.pinCard', async () => {
      const { entry } = pickLookup();
      if (!entry) {
        void vscode.window.showWarningMessage('先悬停出翻译卡片，再点「钉住」');
        return;
      }
      const dict = await lookupWord(entry.text);
      await showMarkdownBeside(dictionaryMarkdown(entry.text, dict, entry.translated));
    }),

    register('translation.wordOfTheDay', async () => {
      // 源码的每日一词就是从生词本里随机抽一个
      const items = vocabulary.list();
      if (items.length === 0) {
        void vscode.window.showInformationMessage('生词本还是空的：先收藏几个词，每日一词从生词本里抽');
        return;
      }
      const pick = items[Math.floor(Math.random() * items.length)];
      const dict = await lookupWord(pick.word);
      await showMarkdownBeside(
        `> 每日一词 · 来自生词本（共 ${items.length} 个）\n\n` +
          dictionaryMarkdown(pick.word, dict, pick.translation)
      );
    }),

    register('translation.selectVoice', async () => {
      try {
        const voices = await listEdgeVoices();
        if (voices.length === 0) {
          void vscode.window.showWarningMessage('没有取到 Edge 语音列表');
          return;
        }
        const locale = localeFor(conf('targetLanguage', 'zh-CN'));
        const current = conf('edgeVoice', '');
        const sorted = [...voices].sort((a, b) => {
          const weight = (voice: { Locale: string; ShortName: string }) =>
            (voice.ShortName === current ? 4 : 0) + (voice.Locale === locale ? 2 : 0);
          return weight(b) - weight(a);
        });
        const pick = await vscode.window.showQuickPick(
          sorted.map((voice) => ({
            label: voice.ShortName,
            description: `${voice.Gender} · ${voice.LocaleName}`,
            detail: voice.FriendlyName
          })),
          { placeHolder: `选择 Edge 语音（共 ${voices.length} 个，${locale} 优先）`, matchOnDetail: true }
        );
        if (!pick) {
          return;
        }
        await vscode.workspace
          .getConfiguration('translation')
          .update('edgeVoice', pick.label, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage(`Edge 语音已设为 ${pick.label}`);
      } catch (error) {
        void vscode.window.showErrorMessage(`读取语音列表失败：${describeError(error)}`);
      }
    }),

    register('translation.showHistory', async () => {
      const document = await vscode.workspace.openTextDocument(HistoryProvider.uri);
      await vscode.window.showTextDocument(document, { preview: false });
    }),

    register('translation.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local.translation-plus');
    }),

    register('translation.removeFromVocabulary', async () => {
      const items = vocabulary.list().map((item) => ({
        label: item.word,
        description: item.translation.replace(/\s+/g, ' ').slice(0, 60),
        detail: `${item.engine} · ${new Date(item.addedAt).toLocaleString()}`
      }));
      if (items.length === 0) {
        void vscode.window.showInformationMessage('生词本是空的');
        return;
      }
      const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择要删除的词条' });
      if (!pick) {
        return;
      }
      await vocabulary.remove(pick.label);
      vocabularyProvider.refresh();
      void vscode.window.showInformationMessage(`已从生词本删除「${pick.label}」`);
    }),

    register('translation.selectEngine', async () => {
      const items = service.listEngines().map((engine) => ({
        label: engine.name,
        description: engine.id === service.engineId ? '当前使用' : engine.id,
        detail: engine.requiresKey ? '需要 API Key' : '免配置',
        id: engine.id
      }));
      const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择翻译引擎' });
      if (!pick) {
        return;
      }
      await vscode.workspace.getConfiguration('translation').update('engine', pick.id, vscode.ConfigurationTarget.Global);
      // 对应 Switch Engine：同时切换翻译引擎与 TTS 引擎
      const ttsPick = await vscode.window.showQuickPick(
        [
          { label: 'Edge TTS', id: 'edge' },
          { label: 'Google TTS', id: 'google' },
          { label: 'OpenAI TTS', id: 'openai' },
          { label: '有道词典音源', id: 'dictionary' },
          { label: '系统语音', id: 'system' }
        ],
        { placeHolder: `翻译引擎已切换为 ${pick.label}，再选一个 TTS 引擎（Esc 跳过）` }
      );
      if (ttsPick) {
        await vscode.workspace
          .getConfiguration('translation')
          .update('ttsEngine', ttsPick.id, vscode.ConfigurationTarget.Global);
      }
      void vscode.window.setStatusBarMessage(`$(check) 引擎：${pick.label}${ttsPick ? ` / ${ttsPick.label}` : ''}`, 3000);
    }),

    register('translation.selectTargetLanguage', async () => {
      const current = conf('targetLanguage', 'zh-CN');
      const items = supportedTargets(service.engineId, conf('filterLanguages', true)).map((lang) => ({
        label: lang.label,
        description: lang.id === current ? `${lang.detail}（当前）` : lang.detail,
        id: lang.id
      }));
      const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择默认目标语言' });
      if (!pick) {
        return;
      }
      await vscode.workspace
        .getConfiguration('translation')
        .update('targetLanguage', pick.id, vscode.ConfigurationTarget.Global);
    }),

    register('translation.setApiKey', async () => {
      const groups: Array<{ label: string; description: string; fields: Array<{ key: string; label: string }> }> = [
        { label: '百度翻译', description: 'APP ID + 密钥', fields: [{ key: 'baidu.appId', label: 'APP ID' }, { key: 'baidu.appKey', label: '密钥' }] },
        { label: '腾讯云翻译', description: 'SecretId + SecretKey', fields: [{ key: 'tencent.secretId', label: 'SecretId' }, { key: 'tencent.secretKey', label: 'SecretKey' }] },
        { label: '阿里云翻译', description: 'AccessKeyId + AccessKeySecret', fields: [{ key: 'aliyun.accessKeyId', label: 'AccessKeyId' }, { key: 'aliyun.accessKeySecret', label: 'AccessKeySecret' }] },
        { label: '火山引擎翻译', description: 'AK + SK', fields: [{ key: 'volcengine.accessKeyId', label: 'Access Key ID' }, { key: 'volcengine.secretKey', label: 'Secret Access Key' }] },
        { label: '彩云小译', description: 'token', fields: [{ key: 'caiyun.token', label: 'token' }] },
        { label: 'DeepL', description: 'API Key', fields: [{ key: 'deepl.apiKey', label: 'API Key' }] },
        { label: '有道智云', description: 'appKey + appSecret', fields: [{ key: 'youdao.appKey', label: '应用 ID' }, { key: 'youdao.appSecret', label: '应用密钥' }] },
        { label: 'OpenAI 兼容', description: 'API Key（随后填 base url 与模型）', fields: [{ key: 'openai.apiKey', label: 'API Key' }] }
      ];

      const pick = await vscode.window.showQuickPick(
        groups.map((group) => ({ label: group.label, description: group.description, group })),
        { placeHolder: '要配置哪个引擎的凭据？（保存在 VSCode 安全存储，不写入 settings.json）' }
      );
      if (!pick) {
        return;
      }

      for (const field of pick.group.fields) {
        const value = await vscode.window.showInputBox({
          title: `${pick.group.label} · ${field.label}`,
          password: true,
          ignoreFocusOut: true,
          prompt: '留空并回车表示清除已保存的值'
        });
        if (value === undefined) {
          return;
        }
        if (value.trim().length === 0) {
          await context.secrets.delete(field.key);
        } else {
          await context.secrets.store(field.key, value.trim());
        }
      }

      if (pick.group.label === 'OpenAI 兼容') {
        const endpoint = await vscode.window.showInputBox({
          title: 'OpenAI 兼容接口 base url',
          value: conf('openai.endpoint', 'https://api.openai.com/v1'),
          ignoreFocusOut: true,
          prompt: '例如 https://api.deepseek.com/v1、http://127.0.0.1:11434/v1'
        });
        if (endpoint !== undefined) {
          await vscode.workspace
            .getConfiguration('translation')
            .update('openai.endpoint', endpoint.trim(), vscode.ConfigurationTarget.Global);
        }
        const model = await vscode.window.showInputBox({
          title: '模型名称',
          value: conf('openai.model', 'gpt-4o-mini'),
          ignoreFocusOut: true
        });
        if (model !== undefined) {
          await vscode.workspace
            .getConfiguration('translation')
            .update('openai.model', model.trim(), vscode.ConfigurationTarget.Global);
        }
      }

      const engineIdMap: Record<string, string> = {
        百度翻译: 'baidu',
        腾讯云翻译: 'tencent',
        阿里云翻译: 'aliyun',
        火山引擎翻译: 'volcengine',
        彩云小译: 'caiyun',
        DeepL: 'deepl',
        有道智云: 'youdao',
        'OpenAI 兼容': 'openai'
      };
      const engineId = engineIdMap[pick.group.label];
      if (engineId) {
        await vscode.workspace.getConfiguration('translation').update('engine', engineId, vscode.ConfigurationTarget.Global);
      }
      void vscode.window.showInformationMessage(`已配置 ${pick.group.label}，并已切换为该引擎`);
    }),

    register('translation.selfTest', async () => {
      const lines: string[] = [];
      let pass = 0;
      let fail = 0;
      const record = (name: string, ok: boolean, detail: string) => {
        lines.push(`${ok ? '✅' : '❌'} ${name}：${detail}`);
        if (ok) {
          pass++;
        } else {
          fail++;
        }
      };
      const started = Date.now();
      lines.push(
        `版本 ${context.extension.packageJSON.version ?? '?'}｜引擎 ${service.engine.name}｜目标 ${labelOf(
          conf('targetLanguage', 'zh-CN')
        )}｜作用范围 ${conf('codeScope', 'selection')}｜悬停 ${conf('hoverMode', 'selection')}｜切片 ${conf(
          'segmentMode',
          'line'
        )}｜发音 ${conf('ttsEngine', 'edge')}`
      );

      const sample = 'Hello, world! This is a self test.';
      let firstMs = 0;
      try {
        const t0 = Date.now();
        const outcome = await service.translate(sample);
        firstMs = Date.now() - t0;
        record('引擎连通', true, `${outcome.text}（${firstMs}ms，${outcome.engineName}）`);
      } catch (error) {
        record('引擎连通', false, describeError(error));
      }

      const dictDetail = await lookupWordDetailed('upload', 8000, true);
      const dict = dictDetail.entry;
      record(
        '词典查询',
        Boolean(dict && dict.meanings.length > 0),
        dict && dict.meanings.length > 0
          ? `${dict.phonetic ?? ''} ${dict.meanings[0] ?? ''}`.trim()
          : `失败：${dictDetail.error ?? '未返回释义'}`
      );

      try {
        const result = await speakText('upload', 'en', conf<string>('ttsEngine', 'edge') as TtsEngine);
        record('发音', result.played, result.engine === 'system' ? '系统 TTS' : result.engine);
      } catch (error) {
        record('发音', false, describeError(error));
      }

      const spans = extractSpans('// hello world\nconst a = "upload failed";', 'javascript', 'commentsAndStrings', true);
      record('注释/字符串识别', spans.length === 2, `${spans.length} 段`);

      const pieces = splitPieces('first line\nsecond line\nthird line', 'line');
      record('增量切片', pieces.length === 3, `${pieces.length} 段`);

      const t1 = Date.now();
      try {
        await service.translate(sample);
        record('缓存', true, `第二次 ${Date.now() - t1}ms（首次 ${firstMs}ms）`);
      } catch (error) {
        record('缓存', false, describeError(error));
      }

      lines.push('', `结果：${pass} 通过 / ${fail} 失败，总用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
      service.channel.appendLine(`\n===== 自检 ${new Date().toLocaleString()} =====\n${lines.join('\n')}`);
      service.channel.show(true);
      void vscode.window.showInformationMessage(
        `自检完成：${pass} 通过 / ${fail} 失败（详情见 Translation Plus 输出面板）`
      );
    }),

    register('translation.testAllEngines', async () => {
      const engines = service.listEngines();
      const lines: string[] = [`===== 全引擎连通性检测 ${new Date().toLocaleString()} =====`];
      let ok = 0;
      let bad = 0;
      for (const engine of engines) {
        const started = Date.now();
        try {
          const outcome = await service.translateWithEngine(engine.id as EngineId, 'Hello, world!', 'zh-CN');
          const ms = Date.now() - started;
          lines.push(`✅ ${engine.name}（${engine.id}）：${outcome.text.slice(0, 40)}  ${ms}ms`);
          ok++;
        } catch (error) {
          lines.push(`❌ ${engine.name}（${engine.id}）：${describeError(error)}`);
          bad++;
        }
      }
      lines.push('', `结果：${ok} 可用 / ${bad} 不可用`);
      service.channel.appendLine(lines.join('\n'));
      service.channel.show(true);
      void vscode.window.showInformationMessage(`全引擎检测完成：${ok} 可用 / ${bad} 不可用（详情见输出面板）`);
    }),

    register('translation.clearCache', async () => {
      const size = await service.cache.clear();
      void vscode.window.showInformationMessage(`翻译缓存已清空（${size} 条）`);
    }),

    register('translation.testEngine', async () => {
      const sample = 'Hello, world! This is a translation smoke test.';
      try {
        const outcome = await progress('测试翻译引擎…', () => service.translate(sample));
        const preview = `译文：${outcome.text}\n引擎：${outcome.engineName}\n耗时：${outcome.elapsedMs}ms`;
        const pick = await vscode.window.showInformationMessage(preview, '查看日志');
        if (pick === '查看日志') {
          service.channel.show(true);
        }
      } catch (error) {
        await reportError(service, error, '测试引擎');
      }
    })
  ];

  return disposables;
}
