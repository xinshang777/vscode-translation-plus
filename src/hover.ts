import * as vscode from 'vscode';
import { conf } from './config';
import { isLookupableWord, lookupWord, type DictEntry } from './dictionary';
import { docHoverState, isRedundantDocumentation, translatedDocumentation } from './docHover';
import { labelOf } from './languages';
import type { TranslationService } from './service';

export interface LastLookup {
  uri: vscode.Uri;
  range: vscode.Range;
  text: string;
  translated: string;
  engine: string;
  to: string;
  phonetic?: string;
  at: number;
}

/** 悬停卡片里「替换 / 复制 / 朗读 / 收藏」按钮操作的对象。 */
export const lastLookup: { value?: LastLookup } = {};

/** 把 "adj. 最初的" 拆成 "**adj.** 最初的"，让词性更醒目 */
function formatMeaning(meaning: string): string {
  const matched = /^([a-z]{1,5}\.)\s*(.+)$/i.exec(meaning);
  return matched ? `**${matched[1]}** ${matched[2]}` : meaning;
}

function buildCard(
  source: string,
  translated: string,
  engine: string,
  to: string,
  entry?: DictEntry,
  docs?: { original: string; translated: string }
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;

  const word = source.length <= 60 ? source : `${source.slice(0, 60)}…`;
  const accent = conf<string>('phoneticAccent', 'us');
  const phonetic = accent === 'uk' ? entry?.ukPhonetic : entry?.usPhonetic;

  // ① 标题行：词 + 音标 + 发音
  md.appendMarkdown(
    `### ${word}${phonetic ? `　\`${phonetic}\`` : ''}　[🔊](command:translation.speakLast "朗读")\n\n`
  );
  // ② 译文放最上面（IDEA 也是先给译文）
  md.appendMarkdown(`#### ${translated.replace(/\n/g, ' ')}\n\n`);

  const sections: string[] = [];

  // ③ 释义
  if (entry && entry.meanings.length > 0) {
    const lines = entry.meanings.slice(0, 4).map((meaning) => `- ${formatMeaning(meaning)}`);
    sections.push(['**释义**', ...lines].join('\n'));
  }
  // ④ 词形（压成一行，最多 3 项）
  if (entry?.forms?.length) {
    const forms = entry.forms.slice(0, 3).join(' ｜ ');
    sections.push(`**词形**　${forms}${entry.forms.length > 3 ? ' …' : ''}`);
  }
  // ⑤ 短语
  if (entry?.phrases?.length) {
    sections.push(['**短语**', ...entry.phrases.slice(0, 3).map((item) => `- ${item}`)].join('\n'));
  }
  // ⑥ 例句（只要一条，双语）
  if (entry?.examples?.length) {
    const example = entry.examples[0];
    sections.push(`**例句**\n> ${example.en}\n>\n> ${example.zh}`);
  }
  // ⑦ 柯林斯（一条）
  if (entry?.collins?.length) {
    const collins = entry.collins[0];
    sections.push(`**柯林斯**　${collins.pos ? `*${collins.pos}* ` : ''}${collins.definition}`);
  }
  // ⑧ 英英释义（一条）
  if (entry?.englishDefs?.length) {
    sections.push(`**英英**　${entry.englishDefs[0]}`);
  }
  // ⑨ 网络释义（两条）
  if (entry?.webTranslations?.length) {
    sections.push(['**网络释义**', ...entry.webTranslations.slice(0, 2).map((item) => `- ${item}`)].join('\n'));
  }

  if (sections.length > 0) {
    md.appendMarkdown(`---\n\n${sections.join('\n\n')}\n\n`);
  }

  // ⑩ 文档译文
  if (docs) {
    const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
    if (docHoverState.mode === 'original') {
      md.appendMarkdown(
        `---\n\n**文档原文**\n\n${clip(docs.original, 600)}\n\n[看译文](command:translation.toggleDocumentation "切换为译文")\n\n`
      );
    } else {
      md.appendMarkdown(
        `---\n\n**文档译文**\n\n${clip(docs.translated, 600)}\n\n[看原文](command:translation.toggleDocumentation "切换为原文")\n\n`
      );
    }
  }

  // ⑪ 底部：引擎 + 操作
  md.appendMarkdown(
    `---\n\n$(globe) ${engine} · ${labelOf(to)}　` +
      [
        '[替换](command:translation.replaceLast "用译文替换原文")',
        '[复制](command:translation.copyLast "复制译文")',
        '[收藏](command:translation.addLastToVocabulary "加入生词本")',
        '[全部释义](command:translation.showDictionaryDetail "展开全部释义与例句")',
        '[钉住](command:translation.pinCard "钉住这张卡片")'
      ].join('　')
  );
  return md;
}

export class TranslationHoverProvider implements vscode.HoverProvider {
  constructor(private readonly service: TranslationService) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const mode = conf<string>('hoverMode', 'selection');
    if (mode === 'off') {
      return undefined;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) {
      return undefined;
    }

    let text: string | undefined;
    let range: vscode.Range | undefined;
    const selection = editor.selection;
    if (!selection.isEmpty && selection.contains(position)) {
      text = document.getText(selection);
      range = selection;
    } else if (mode === 'word' || mode === 'all') {
      const wordRange = document.getWordRangeAtPosition(position, /[\p{L}\p{N}_'’-]+/u);
      if (!wordRange) {
        return undefined;
      }
      const word = document.getText(wordRange).trim();
      // 中英日韩都要能翻；只有「拉丁字母词」才会去查词典（isLookupableWord 在下面判）
      if (!word || word.length < 2 || word.length > 60 || !/[\p{L}\p{N}]/u.test(word)) {
        return undefined;
      }
      text = word;
      range = wordRange;
    } else {
      return undefined;
    }

    const source = text.trim();
    if (source.length < 2 || source.length > 1000) {
      return undefined;
    }

    const to = this.service.resolveDirection(source, conf('targetLanguage', 'zh-CN'));
    const dictionaryEnabled = conf('dictionaryEnabled', true) && isLookupableWord(source);
    const entry = dictionaryEnabled ? await lookupWord(source) : undefined;
    if (token.isCancellationRequested) {
      return undefined;
    }

    let translated: string;
    let engineName: string;
    try {
      const outcome = await this.service.translate(source, { to, force: true });
      translated = outcome.text;
      engineName = outcome.engineName;
    } catch {
      return undefined;
    }
    if (token.isCancellationRequested) {
      return undefined;
    }

    lastLookup.value = {
      uri: document.uri,
      range,
      text: source,
      translated,
      engine: engineName,
      to,
      phonetic: entry?.phonetic,
      at: Date.now()
    };

    // B1：附带语言服务的文档译文（只对单词/悬停模式，避免每次划词都多请求）
    let docs: { original: string; translated: string } | undefined;
    if (conf('hoverDocumentation', true) && (mode === 'word' || mode === 'all')) {
      const candidate = await translatedDocumentation(document, position, this.service, source);
      if (candidate && !isRedundantDocumentation(candidate, translated)) {
        docs = candidate;
      }
      if (token.isCancellationRequested) {
        return undefined;
      }
    }

    return new vscode.Hover(buildCard(source, translated, engineName, to, entry, docs), range);
  }

  /** 供命令使用：当前悬停目标已失效时返回 undefined。 */
  pick(editor: vscode.TextEditor): LastLookup | undefined {
    const value = lastLookup.value;
    if (!value || value.uri.toString() !== editor.document.uri.toString()) {
      return undefined;
    }
    return value;
  }
}
