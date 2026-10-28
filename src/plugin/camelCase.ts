/**
 * 直接移植自 TranslationPlugin：
 *   util/CamelCaseSplitter.kt        （逐行对应）
 *   util/WordSelections.kt           （条件常量 + 取词模式）
 *
 * 这些是纯逻辑，和 IDE 无关，所以按原实现搬运。
 */

type CharKind = 'upper' | 'lower' | 'title' | 'letter' | 'other';

/** 对应 Character.getType + isLetter 判定 */
function kindOf(char: string): CharKind {
  if (/[A-Z]/.test(char)) {
    return 'upper';
  }
  if (/[a-z]/.test(char)) {
    return 'lower';
  }
  if (/[\u01c5\u01c8\u01cb\u01f2]/.test(char)) {
    return 'title';
  }
  if (/[\p{Lu}\p{Ll}]/u.test(char)) {
    return /[\p{Lu}]/u.test(char) ? 'upper' : 'lower';
  }
  if (/[\p{L}\p{M}]/u.test(char)) {
    return 'letter';
  }
  return 'other';
}

function isLetter(kind: CharKind): boolean {
  return kind === 'upper' || kind === 'lower' || kind === 'title' || kind === 'letter';
}

/**
 * CamelCaseSplitter.split 的直译。
 * getUserName → [get, User, Name]；HTTPServer2Port → [HTTP, Server, 2, Port]
 */
export function splitCamelCase(text: string): string[] {
  if (![...text].some((char) => !/[a-z]/.test(char) || !/\p{L}/u.test(char))) {
    return [text];
  }

  const result: string[] = [];
  let index = 0;
  let wordStart = -1;
  let prevKind: CharKind = 'other';

  while (index < text.length) {
    const char = text[index];
    const kind = kindOf(char);

    if (isLetter(kind)) {
      if (!isLetter(prevKind) && wordStart >= 0) {
        result.push(text.slice(wordStart, index));
        wordStart = -1;
      }
      if (wordStart < 0) {
        wordStart = index;
      } else if (kind === 'upper' && prevKind === 'lower') {
        result.push(text.slice(wordStart, index));
        wordStart = index;
      } else if (index - wordStart > 1 && kind === 'lower' && prevKind === 'upper') {
        result.push(text.slice(wordStart, index - 1));
        wordStart = index - 1;
      }
    } else if (wordStart < 0 || (!isLetter(prevKind) && prevKind === kind)) {
      if (wordStart < 0) {
        wordStart = index;
      }
    } else {
      result.push(text.slice(wordStart, index));
      wordStart = index;
    }

    prevKind = kind;
    index++;
  }

  if (wordStart >= 0) {
    result.push(text.slice(wordStart, index));
  }
  return result;
}

/** SelectWordUtil.JAVA_IDENTIFIER_PART_CONDITION 的近似：字母、数字、_、$ */
export function isJavaIdentifierPart(char: string): boolean {
  return /[\p{L}\p{N}_$]/u.test(char);
}

/** 源码里的 NON_LATIN_CONDITION：char.code > 0xFF 且是标识符组成部分 */
export function isNonLatin(char: string): boolean {
  return char.codePointAt(0)! > 0xff && isJavaIdentifierPart(char);
}

export function anyNonLatin(text: string): boolean {
  return [...text].some(isNonLatin);
}

/** 取词模式，对应 WordSelections.SelectionMode */
export type SelectionMode = 'EXCLUSIVE' | 'INCLUSIVE';

/**
 * 只对「单个标识符」做驼峰拆分，避免把整行代码拆散。
 * 源码里 Replace 动作只在取词结果上调用，这里保持同样的适用范围。
 */
export function splitCamelCaseWords(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || !/^[\p{L}\p{N}_$]+$/u.test(trimmed)) {
    return text;
  }
  const words = splitCamelCase(trimmed);
  return words.length > 1 ? words.join(' ') : text;
}

/** 从一行文本里按取词模式取出词范围（对应 getSelectionFromCurrentCaret） */
export function wordRangeAt(
  lineText: string,
  column: number,
  mode: SelectionMode = 'INCLUSIVE'
): { start: number; end: number } | undefined {
  const at = Math.min(Math.max(column, 0), lineText.length);
  let probe = at;
  if (!isJavaIdentifierPart(lineText[probe] ?? '') && isJavaIdentifierPart(lineText[probe - 1] ?? '')) {
    probe = at - 1;
  }
  if (!isJavaIdentifierPart(lineText[probe] ?? '')) {
    if (!isJavaIdentifierPart(lineText[at] ?? '')) {
      return undefined;
    }
    probe = at;
  }

  let start = probe;
  let end = probe;
  while (start > 0 && isJavaIdentifierPart(lineText[start - 1])) {
    start--;
  }
  while (end < lineText.length && isJavaIdentifierPart(lineText[end])) {
    end++;
  }

  if (mode === 'INCLUSIVE') {
    // 最大范围：把左右被非空白分隔的连续标识符也算进来（等价 SelectWordUtil 的最大区间）
    while (start > 0 && !/\s/.test(lineText[start - 1])) {
      start--;
    }
    while (end < lineText.length && !/\s/.test(lineText[end])) {
      end++;
    }
  }
  return start === end ? undefined : { start, end };
}
