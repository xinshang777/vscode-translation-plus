/**
 * 移植自 TranslationPlugin 的 ReplaceWithTranslationAction.kt：
 * - fixWhitespace：Google 会返回特殊空格，需归一
 * - splitCamelCaseWords：选中标识符先拆成单词再翻
 * - createReplaceElements：英文目标时生成 camel / Pascal / 分隔符 / 原文 多组候选
 */

import { splitCamelCase, splitCamelCaseWords } from './plugin/camelCase';

export { splitCamelCaseWords };

/** 源码里的空格集合：` \u00a0\u2000-\u200a\u202f\u205f\u3000` */
const SPACES = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g;

export function fixWhitespace(text: string): string {
  return text.replace(SPACES, ' ');
}

/** 直接用移植过来的 CamelCaseSplitter，只保留含字母/数字的词。 */
export function getWordsIn(text: string): string[] {
  return splitCamelCase(text).filter((word) => /[\p{L}\p{N}]/u.test(word));
}

function sanitizeIdentifierStart(word: string): string {
  return /^[\p{L}_$]/u.test(word.charAt(0)) ? word : `_${word}`;
}

function capitalizeJavaBean(word: string): string {
  if (!word) {
    return word;
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * 生成替换候选，顺序与源码一致：camel → Pascal → 各分隔符（小写、大写）→ 原文。
 * 目标语言不是英文或是纯文本时，源码只返回原译文。
 */
export function createReplaceElements(
  translation: string,
  dictionaryTranslations: string[],
  targetIsEnglish: boolean,
  isPlainText: boolean,
  separators: string
): string[] {
  const set = new Set<string>();
  for (const item of dictionaryTranslations) {
    if (item && item.trim()) {
      set.add(fixWhitespace(item));
    }
  }
  if (translation && translation.trim()) {
    set.add(fixWhitespace(translation));
  }
  const items = [...set];
  if (items.length === 0) {
    return [];
  }
  if (!targetIsEnglish || isPlainText) {
    return items.filter((item) => item.trim().length > 0);
  }

  const camel = new Set<string>();
  const pascal = new Set<string>();
  const original = new Set<string>();
  const separatorChars = [...separators].filter((ch) => ch !== '\n' && ch !== '\r' && ch !== '\t');
  const withSeparator = new Map<string, Set<string>>(separatorChars.map((ch) => [ch, new Set<string>()]));

  for (const item of items) {
    original.add(item);
    if (item.length > 50) {
      continue;
    }
    const words = getWordsIn(item);
    if (words.length === 0) {
      continue;
    }
    const camelBuilder: string[] = [];
    const pascalBuilder: string[] = [];
    const sepBuilders = new Map<string, string[]>(separatorChars.map((ch) => [ch, []]));

    words.forEach((word, index) => {
      const safe = index === 0 ? sanitizeIdentifierStart(word) : word;
      const lower = safe.toLowerCase();
      for (const [separator, parts] of sepBuilders) {
        parts.push(lower);
        if (index < words.length - 1) {
          parts.push(separator);
        }
      }
      const capitalized = capitalizeJavaBean(word);
      camelBuilder.push(index === 0 ? lower : capitalized);
      pascalBuilder.push(capitalized);
    });

    camel.add(camelBuilder.join(''));
    pascal.add(pascalBuilder.join(''));
    for (const [separator, parts] of sepBuilders) {
      const value = parts.join('');
      const bucket = withSeparator.get(separator);
      if (bucket) {
        bucket.add(value);
        bucket.add(value.toUpperCase());
      }
    }
  }

  const ordered = new Set<string>();
  camel.forEach((value) => ordered.add(value));
  pascal.forEach((value) => ordered.add(value));
  for (const bucket of withSeparator.values()) {
    bucket.forEach((value) => ordered.add(value));
  }
  original.forEach((value) => ordered.add(value));
  return [...ordered].filter((value) => value.trim().length > 0);
}
