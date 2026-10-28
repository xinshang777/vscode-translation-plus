// 验证 B1（悬停里注入文档译文）与 B2（注释行尾 InlayHint 译文）
const Module = require('module');
const path = require('path');

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}
class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) {
      this.start = a;
      this.end = b;
    } else {
      this.start = new Position(a, b);
      this.end = new Position(c, d);
    }
  }
}
class Selection extends Range {
  constructor(a, b, c, d) {
    super(a, b, c, d);
    this.active = this.end;
  }
  get isEmpty() {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
  contains(p) {
    return p.line >= this.start.line && p.line <= this.end.line;
  }
}

let docText = '';
const config = { inlayHints: true, hoverDocumentation: true, hoverMode: 'word', dictionaryEnabled: false };
let nativeHover = [];

const vscode = {
  Position,
  Range,
  Selection,
  Hover: class {
    constructor(contents, range) {
      this.contents = contents;
      this.range = range;
    }
  },
  MarkdownString: class {
    constructor(value) {
      this.value = value || '';
      this.isTrusted = false;
    }
    appendMarkdown(text) {
      this.value += text;
      return this;
    }
  },
  InlayHint: class {
    constructor(position, label, kind) {
      this.position = position;
      this.label = label;
      this.kind = kind;
    }
  },
  InlayHintKind: { Type: 1, Parameter: 2 },
  EventEmitter: class {
    constructor() {
      this.listeners = [];
      this.event = (fn) => {
        this.listeners.push(fn);
        return { dispose() {} };
      };
    }
    fire() {
      for (const listener of this.listeners) listener();
    }
    dispose() {}
  },
  Uri: { parse: (v) => ({ scheme: v.split(':')[0], toString: () => v }) },
  ViewColumn: { Beside: -2 },
  ProgressLocation: { Notification: 15 },
  ThemeColor: class {},
  StatusBarAlignment: { Right: 2 },
  CancellationToken: class {},
  languages: {},
  window: {
    activeTextEditor: undefined,
    createTextEditorDecorationType: () => ({ dispose() {} }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    withProgress: (_o, task) => Promise.resolve(task({ report() {} }, { isCancellationRequested: false })),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showQuickPick: async (items) => (await items)[0],
    setStatusBarMessage: () => ({ dispose() {} }),
    showTextDocument: async () => ({})
  },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d), update: async () => {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    openTextDocument: async () => makeDocument('', 'plaintext')
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async (id) => {
      if (id === 'vscode.executeHoverProvider') return nativeHover;
      return undefined;
    }
  },
  env: { clipboard: { writeText: async () => {} } }
};

function makeDocument(text, languageId) {
  docText = text;
  const offsetAt = (pos) => {
    const lines = docText.split('\n');
    let offset = 0;
    for (let i = 0; i < pos.line; i++) offset += lines[i].length + 1;
    return Math.min(offset + pos.character, docText.length);
  };
  return {
    languageId,
    uri: { scheme: 'file', toString: () => 'file:///demo.ts' },
    get lineCount() {
      return docText.split('\n').length;
    },
    getText: (range) => (range ? docText.slice(offsetAt(range.start), offsetAt(range.end)) : docText),
    offsetAt,
    positionAt: (offset) => {
      const before = docText.slice(0, offset);
      const line = (before.match(/\n/g) || []).length;
      return new Position(line, offset - (before.lastIndexOf('\n') + 1));
    },
    lineAt: (n) => {
      const lines = docText.split('\n');
      return { text: lines[n] ?? '' };
    },
    getWordRangeAtPosition: (pos) => {
      const line = docText.split('\n')[pos.line] ?? '';
      const isWord = (ch) => ch !== undefined && /[A-Za-z]/.test(ch);
      let start = pos.character;
      let end = pos.character;
      while (start > 0 && isWord(line[start - 1])) start--;
      while (end < line.length && isWord(line[end])) end++;
      return start === end ? undefined : new Range(pos.line, start, pos.line, end);
    }
  };
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { CommentInlayHintsProvider } = require(path.join(__dirname, '..', 'out', 'inlayHints'));
const { TranslationHoverProvider } = require(path.join(__dirname, '..', 'out', 'hover'));

const stubService = {
  translate: async (text) => ({ text: `【${text}】`, from: 'auto', to: 'zh-CN', engineName: 'stub' }),
  resolveDirection: (text, requested) => requested ?? 'zh-CN'
};

(async () => {
  // ---- B2: InlayHint ----
  const document = makeDocument('// upload the file\nconst a = 1; // check the size', 'javascript');
  const inlay = new CommentInlayHintsProvider(stubService);
  const range = new Range(0, 0, 1, 30);

  const first = await inlay.provideInlayHints(document, range, { isCancellationRequested: false });
  console.log(`B2 首次调用返回 hint 数：${first.length}（预期 0，正在后台翻译）`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const second = await inlay.provideInlayHints(document, range, { isCancellationRequested: false });
  console.log(`B2 二次调用返回 hint 数：${second.length}（预期 2）`);
  for (const hint of second) {
    console.log(`   L${hint.position.line}:${hint.position.character} ${hint.label}`);
  }
  console.log(`B2 tooltip 是否有操作链接：${second[0] ? /command:translation\./.test(second[0].tooltip.value) : false}`);
  inlay.dispose();

  // ---- B1: 悬停注入文档译文 ----
  const hoverDoc = makeDocument('someSymbol here', 'typescript');
  nativeHover = [
    new vscode.Hover(
      new vscode.MarkdownString('Uploads a file to the remote server and returns the public url of the uploaded file.')
    )
  ];
  const editor = { document: hoverDoc, selection: new Selection(0, 0, 0, 0) };
  vscode.window.activeTextEditor = editor;

  const provider = new TranslationHoverProvider(stubService);
  const hover = await provider.provideHover(hoverDoc, new Position(0, 5), { isCancellationRequested: false });
  const text = hover ? hover.contents.value : '';
  console.log('\n--- B1 卡片全文 ---\n' + text.slice(0, 400) + '\n---');
  console.log(`B1 卡片是否含「文档译文」：${text.includes('文档译文')}`);
  console.log(`B1 卡片是否含切换链接：${text.includes('toggleDocumentation')}`);
  const docLine = text.split('\n').find((line) => line.includes('【Uploads')) ?? '';
  console.log(`B1 译文内容：${docLine.slice(0, 80)}`);
})().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});
