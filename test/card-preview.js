// 用真实引擎 + 有道词典渲染一张卡片，检查排版
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
    return true;
  }
  contains() {
    return false;
  }
}

let docText = 'initial';
const config = { hoverMode: 'word', dictionaryEnabled: true, phoneticAccent: 'us', hoverDocumentation: false };

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
    constructor(v) {
      this.value = v || '';
      this.isTrusted = false;
    }
    appendMarkdown(t) {
      this.value += t;
      return this;
    }
  },
  Uri: { parse: (v) => ({ toString: () => v }) },
  commands: { executeCommand: async () => [] },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) })
  },
  window: {}
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { TranslationHoverProvider } = require(path.join(__dirname, '..', 'out', 'hover'));
const { bingEngine } = require(path.join(__dirname, '..', 'out', 'engines', 'bing'));

const document = {
  languageId: 'html',
  uri: { toString: () => 'file:///demo.html' },
  getText: () => docText,
  lineAt: () => ({ text: docText }),
  getWordRangeAtPosition: () => new Range(0, 0, 0, docText.length)
};

const service = {
  translate: async (text, options) => ({
    text: await bingEngine.translate(text, 'auto-detect', 'zh-Hans', {
      getConfig: (k, d) => d,
      getSecret: async () => undefined,
      timeout: 15000
    }),
    engineName: 'Bing 翻译',
    from: 'auto',
    to: 'zh-CN'
  }),
  resolveDirection: (_t, r) => r ?? 'zh-CN'
};

(async () => {
  const provider = new TranslationHoverProvider(service);
  const editor = { document, selection: new Selection(0, 0, 0, 0) };
  vscode.window.activeTextEditor = editor;
  const hover = await provider.provideHover(document, new Position(0, 3), { isCancellationRequested: false });
  console.log(hover ? hover.contents.value : '(没有卡片)');
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
