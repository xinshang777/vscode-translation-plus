/**
 * B1：把语言服务的悬浮文档翻成中文，注入到自己的 Hover 卡片里。
 * 对应 IDEA 的 Quick Documentation 翻译（含原文/译文切换）。
 */
import * as vscode from 'vscode';
import type { TranslationService } from './service';

export type DocHoverMode = 'translated' | 'original';

/** 全局状态：当前以「译文」还是「原文」展示文档 */
export const docHoverState: { mode: DocHoverMode; busy: boolean } = {
  mode: 'translated',
  busy: false
};

const cache = new Map<string, string>();
const MAX_CACHE = 120;

export function hoverToText(hovers: vscode.Hover[]): string {
  const blocks: string[] = [];
  for (const hover of hovers) {
    const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
    for (const content of contents) {
      if (typeof content === 'string') {
        blocks.push(content);
      } else if (content && typeof content === 'object' && 'value' in content) {
        blocks.push(String((content as { value: unknown }).value));
      }
    }
  }
  return blocks
    .join('\n\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\r/g, '')
    .trim();
}

function looksLikeDocumentation(text: string, sourceWord: string): boolean {
  // 太短的不是文档（多为别的扩展的一行译文）
  if (text.length < 40) {
    return false;
  }
  // 我们自己卡片里的标记，别再当文档翻一遍
  if (/\$\(globe\)|译成简体中文|全部释义|钉住这张卡片/.test(text)) {
    return false;
  }
  const hasCjk = /[\u4e00-\u9fff]/.test(text);
  const sourceIsAscii = /^[\x00-\x7f]+$/.test(sourceWord);
  // 悬停的是英文单词、抓到的却是中文 → 多半是别的翻译扩展的 hover，不是文档
  if (hasCjk && sourceIsAscii) {
    return false;
  }
  // 至少得像个句子/段落
  return /\s/.test(text) || text.length > 80;
}

/** 判断文档译文与主译文是否重复（重复就别再显示一遍） */
export function isRedundantDocumentation(docs: { original: string; translated: string }, translation: string): boolean {
  const main = translation.replace(/\s+/g, ' ').trim();
  if (!main) {
    return false;
  }
  const docText = `${docs.original}\n${docs.translated}`.replace(/\s+/g, ' ');
  if (docText.includes(main)) {
    return true;
  }
  // 中文主译文很短时（如"初始"），原文里包含它也算重复
  return main.length <= 6 && docs.original.includes(main);
}

/**
 * 取当前光标位置的语言服务文档并翻译。
 * 注意：调用 executeHoverProvider 会触发所有 hover provider（包括自己），
 * 所以用 busy 标记防止递归。
 */
export async function translatedDocumentation(
  document: vscode.TextDocument,
  position: vscode.Position,
  service: TranslationService,
  sourceWord = ''
): Promise<{ original: string; translated: string } | undefined> {
  if (docHoverState.busy) {
    return undefined;
  }
  docHoverState.busy = true;
  let original = '';
  try {
    const result = await vscode.commands.executeCommand<vscode.Hover[] | undefined>(
      'vscode.executeHoverProvider',
      document.uri,
      position
    );
    original = Array.isArray(result) ? hoverToText(result) : '';
  } catch {
    original = '';
  } finally {
    docHoverState.busy = false;
  }

  if (!original || !looksLikeDocumentation(original, sourceWord)) {
    return undefined;
  }

  const cached = cache.get(original);
  if (cached) {
    return { original, translated: cached };
  }

  try {
    const outcome = await service.translate(original);
    cache.set(original, outcome.text);
    if (cache.size > MAX_CACHE) {
      const first = cache.keys().next().value;
      if (first !== undefined) {
        cache.delete(first);
      }
    }
    return { original, translated: outcome.text };
  } catch {
    return undefined;
  }
}

export function clearDocumentationCache(): void {
  cache.clear();
}

/**
 * B6：用语言服务 hover 返回的 range 当作「词边界」，替代 IDEA 的 PSI 取词。
 * 拿不到或范围为空时返回 undefined，由调用方回退到正则取词。
 */
export async function nativeWordRange(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Range | undefined> {
  if (docHoverState.busy) {
    return undefined;
  }
  docHoverState.busy = true;
  try {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[] | undefined>(
      'vscode.executeHoverProvider',
      document.uri,
      position
    );
    for (const hover of Array.isArray(hovers) ? hovers : []) {
      const range = hover.range;
      if (range && !range.isEmpty && range.contains(position)) {
        return range;
      }
    }
  } catch {
    /* 语言服务不可用 */
  } finally {
    docHoverState.busy = false;
  }
  return undefined;
}
