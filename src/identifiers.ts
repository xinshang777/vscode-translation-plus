/** 标识符断词：对应 IDEA 插件的 “Automatic word breaks”。 */

const WORD_CHAR = /[\p{L}\p{N}_$]/u;

export interface WordSpan {
  start: number;
  end: number;
  text: string;
}

/** 按 _ / $ / 数字 / 大小写驼峰把标识符切成子词：getUserName → get | User | Name */
export function camelSegments(word: string): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 1; i < word.length; i++) {
    const prev = word[i - 1];
    const cur = word[i];
    const camel = /[a-z]/.test(prev) && /[A-Z]/.test(cur);
    const digitBoundary = /[a-z]/i.test(prev) && /\d/.test(cur);
    const leaveDigit = /\d/.test(prev) && /[a-z]/i.test(cur);
    if (camel || digitBoundary || leaveDigit) {
      segments.push({ start, end: i });
      start = i;
    }
  }
  segments.push({ start, end: word.length });
  return segments.filter((segment) => segment.end > segment.start);
}

/**
 * 取光标所在的词：
 * 1) 落在标识符里时按驼峰/下划线再细分，只取光标所在那一段（IDEA 的 automatic word breaks）；
 * 2) 中文按连续的汉字成词；
 * 3) 都没有就取整个标识符。
 */
export function wordAt(lineText: string, column: number): WordSpan | undefined {
  if (lineText.length === 0) {
    return undefined;
  }
  const at = Math.min(Math.max(column, 0), lineText.length);
  // 先找到包含光标（或紧邻光标左侧）的连续标识符
  let probe = at;
  if (probe > 0 && !WORD_CHAR.test(lineText[probe] ?? '') && WORD_CHAR.test(lineText[probe - 1] ?? '')) {
    probe = at - 1;
  }
  if (!WORD_CHAR.test(lineText[probe] ?? '')) {
    // 试一下右侧
    if (!WORD_CHAR.test(lineText[at] ?? '')) {
      return undefined;
    }
    probe = at;
  }
  let start = probe;
  let end = probe;
  while (start > 0 && WORD_CHAR.test(lineText[start - 1])) {
    start--;
  }
  while (end < lineText.length && WORD_CHAR.test(lineText[end])) {
    end++;
  }
  const identifier = lineText.slice(start, end);
  const offset = probe - start;
  const segments = camelSegments(identifier);
  const hit = segments.find((segment) => offset >= segment.start && offset < segment.end) ?? segments[0];
  if (!hit) {
    return { start, end, text: identifier };
  }
  return { start: start + hit.start, end: start + hit.end, text: identifier.slice(hit.start, hit.end) };
}

/** 把译文改写成指定命名风格（IDEA 的 “Replace with Translation > Separator”）。 */
export type ReplaceFormat = 'original' | 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case' | 'space';

export function applyReplaceFormat(text: string, format: ReplaceFormat): string {
  if (format === 'original' || !text.trim() || text.includes('\n')) {
    return text;
  }
  const words = text
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return text;
  }
  const lower = words.map((word) => word.toLowerCase());
  switch (format) {
    case 'camelCase':
      return lower.map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))).join('');
    case 'PascalCase':
      return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');
    case 'snake_case':
      return lower.join('_');
    case 'kebab-case':
      return lower.join('-');
    case 'space':
      return lower.join(' ');
    default:
      return text;
  }
}
