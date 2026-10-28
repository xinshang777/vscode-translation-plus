export interface TextSpan {
  /** 全文中的起始偏移 */
  start: number;
  /** 全文中的结束偏移（不含） */
  end: number;
  text: string;
}

export type TextKind = 'comments' | 'strings' | 'commentsAndStrings';

interface Family {
  ids: string[];
  line: string[];
  block: Array<[string, string]>;
}

const FAMILIES: Family[] = [
  {
    ids: [
      'javascript',
      'typescript',
      'javascriptreact',
      'typescriptreact',
      'java',
      'c',
      'cpp',
      'csharp',
      'go',
      'rust',
      'php',
      'swift',
      'kotlin',
      'scala',
      'dart',
      'groovy',
      'objective-c',
      'objective-cpp',
      'less',
      'scss',
      'css',
      'jsonc',
      'json5',
      'vue',
      'svelte',
      'proto',
      'graphql'
    ],
    line: ['//'],
    block: [['/*', '*/']]
  },
  {
    ids: [
      'python',
      'ruby',
      'shellscript',
      'powershell',
      'yaml',
      'toml',
      'perl',
      'r',
      'dockerfile',
      'makefile',
      'ini',
      'properties',
      'git-commit',
      'coffeescript',
      'elixir',
      'julia',
      'nim',
      'tcl'
    ],
    line: ['#'],
    block: []
  },
  {
    ids: ['html', 'xml', 'markdown', 'svg', 'xsl', 'handlebars', 'razor'],
    line: [],
    block: [['<!--', '-->']]
  },
  {
    ids: ['sql', 'lua', 'haskell'],
    line: ['--'],
    block: [['/*', '*/']]
  },
  {
    ids: ['bat', 'vb', 'vbscript', 'asm'],
    line: ["'", ';'],
    block: []
  }
];

const LINE_COMMENT_LANGS = new Set(FAMILIES[1].ids);

function familyOf(languageId: string): Family {
  const found = FAMILIES.find((family) => family.ids.includes(languageId));
  return found ?? { ids: [], line: [], block: [] };
}

export function isCodeLanguage(languageId: string): boolean {
  return familyOf(languageId).line.length > 0 || familyOf(languageId).block.length > 0;
}

export function supportsComments(languageId: string): boolean {
  return isCodeLanguage(languageId);
}

/** 判断一个字符串是否值得翻译：含空格、含非 ASCII，或足够长的自然语言片段。 */
export function looksTranslatable(text: string): boolean {
  const value = text.trim();
  if (value.length < 2) {
    return false;
  }
  if (/\s/.test(value)) {
    return true;
  }
  // 无空格：只在含中日韩字符且不含路径分隔符时才翻译
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(value) && !/[/\\:@#${}]/.test(value);
}

/**
 * 在给定文本里扫描注释/字符串内容区间。
 * 返回的 span 只覆盖「内容」，不含 // /* # 等标记与引号，便于原位替换。
 */
export function extractSpans(text: string, languageId: string, kind: TextKind, smartStringFilter = true): TextSpan[] {
  const family = familyOf(languageId);
  const wantComments = kind === 'comments' || kind === 'commentsAndStrings';
  const wantStrings = kind === 'strings' || kind === 'commentsAndStrings';
  const spans: TextSpan[] = [];
  let i = 0;

  while (i < text.length) {
    if (wantComments) {
      const block = family.block.find(([open]) => text.startsWith(open, i));
      if (block) {
        const [open, close] = block;
        const closeIndex = close ? text.indexOf(close, i + open.length) : -1;
        const contentStart = i + open.length;
        const contentEnd = closeIndex === -1 ? text.length : closeIndex;
        const content = text.slice(contentStart, contentEnd);
        const lines = content.split('\n');
        const starred = lines.filter((line) => /^\s*\*/.test(line)).length;

        if (lines.length > 1 && starred >= Math.ceil(lines.length / 2)) {
          // JSDoc 风格：逐行翻译，只替换 "*" 之后的内容，结构完全不变
          let offset = contentStart;
          for (const line of lines) {
            const lineStart = offset;
            offset = lineStart + line.length + 1; // +1 = '\n'
            const matched = /^(\s*\*\s?)([\s\S]*?)\s*$/.exec(line);
            let spanStart: number;
            let spanText: string;
            if (matched) {
              spanStart = lineStart + matched[1].length;
              spanText = matched[2];
            } else {
              const trimmed = line.trim();
              if (trimmed.length === 0) {
                continue;
              }
              spanStart = lineStart + line.indexOf(trimmed);
              spanText = trimmed;
            }
            if (spanText.trim().length > 1 && /\p{L}/u.test(spanText)) {
              spans.push({ start: spanStart, end: spanStart + spanText.length, text: spanText });
            }
          }
        } else if (content.trim().length > 1 && /\p{L}/u.test(content)) {
          spans.push({ start: contentStart, end: contentEnd, text: content });
        }
        i = closeIndex === -1 ? text.length : closeIndex + close.length;
        continue;
      }

      const lineToken = family.line.find((token) => text.startsWith(token, i));
      if (lineToken) {
        const newline = text.indexOf('\n', i);
        const contentEnd = newline === -1 ? text.length : newline;
        const content = text.slice(i + lineToken.length, contentEnd);
        const raw = content.replace(/\r$/, '');
        if (raw.trim().length > 1) {
          // 去掉行尾空白，但保留 "// " 之后的那个空格，避免替换后变成 "//译文"
          const lead = raw.length - raw.trimStart().length;
          const tail = raw.trimEnd().length;
          const start = i + lineToken.length + lead;
          const end = i + lineToken.length + tail;
          spans.push({ start, end, text: text.slice(start, end) });
        }
        i = contentEnd;
        continue;
      }
    }

    if (wantStrings && (text[i] === '"' || text[i] === "'" || text[i] === '`')) {
      const quote = text[i];
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === quote) {
          break;
        }
        if (text[j] === '\n' && quote !== '`') {
          break;
        }
        j++;
      }
      const contentEnd = Math.min(j, text.length);
      const content = text.slice(i + 1, contentEnd);
      const multiLine = quote === '`';
      const worthTranslating = !smartStringFilter || multiLine || looksTranslatable(content);
      if (content.trim().length > 1 && worthTranslating) {
        spans.push({ start: i + 1, end: contentEnd, text: content });
      }
      i = contentEnd + 1;
      continue;
    }

    i++;
  }

  return spans;
}

/** 供「整文件注释翻译」使用：按行扫描行注释，返回每行注释内容。 */
export function lineCommentSpans(text: string, languageId: string): TextSpan[] {
  if (LINE_COMMENT_LANGS.has(languageId) || languageId === 'yaml') {
    return extractSpans(text, languageId, 'comments');
  }
  return extractSpans(text, languageId, 'comments');
}
