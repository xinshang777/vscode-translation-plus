// 悬停中文词的真实渲染（Bing 翻成英文）
const Module = require('module');
const path = require('path');

class Position {
  constructor(l, c) {
    this.line = l;
    this.character = c;
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

const docText = '初始';
const config = {
  hoverMode: 'word',
  dictionaryEnabled: true,
  phoneticAccent: 'us',
  hoverDocumentation: false,
  targetLanguage: 'zh-CN',
  autoSwapDirection: true
};

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
  workspace: { getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) }) },
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
  languageId: 'markdown',
  uri: { toString: () => 'file:///demo.md' },
  getText: () => docText,
  lineAt: () => ({ text: docText }),
  getWordRangeAtPosition: () => new Range(0, 0, 0, docText.length)
};

const service = {
  translate: async (text, options) => ({
    text: await bingEngine.translate(text, 'auto-detect', options && options.to === 'en' ? 'en' : 'zh-Hans', {
      getConfig: (k, d) => d,
      getSecret: async () => undefined,
      timeout: 15000
    }),
    engineName: 'Bing 翻译'
  }),
  resolveDirection: () => 'en'
};

(async () => {
  const provider = new TranslationHoverProvider(service);
  vscode.window.activeTextEditor = { document, selection: new Selection(0, 0, 0, 0) };
  const hover = await provider.provideHover(document, new Position(0, 1), { isCancellationRequested: false });
  console.log(hover ? hover.contents.value : '(没有卡片 —— 这就是 bug)');
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
