// 逐个执行 package.json 里声明的每个命令，确认都能跑起来不抛异常
const Module = require('module');
const path = require('path');
const fs = require('fs');

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
  contains(position) {
    return (
      position.line >= this.start.line &&
      position.line <= this.end.line &&
      position.character >= this.start.character &&
      position.character <= this.end.character
    );
  }
}

let docText = '';
const registry = Object.create(null);
const logs = [];
const config = {};
const updates = [];
const hoverProviders = [];
const contentProviders = Object.create(null);
let clipboard = '';

function makeDocument(text, languageId) {
  docText = text;
  const offsetAt = (pos) => {
    const lines = docText.split('\n');
    let offset = 0;
    for (let i = 0; i < pos.line; i++) offset += lines[i].length + 1;
    return Math.min(offset + pos.character, docText.length);
  };
  const positionAt = (offset) => {
    const before = docText.slice(0, offset);
    const line = (before.match(/\n/g) || []).length;
    return new Position(line, offset - (before.lastIndexOf('\n') + 1));
  };
  const uri = { scheme: 'file', fsPath: 'test.ts', toString: () => 'file:///test.ts' };
  return {
    languageId,
    uri,
    getText: (range) => (range ? docText.slice(offsetAt(range.start), offsetAt(range.end)) : docText),
    offsetAt,
    positionAt,
    get lineCount() {
      return docText.split('\n').length;
    },
    lineAt: (n) => {
      const lines = docText.split('\n');
      return { text: lines[n] ?? '', range: { start: new Position(n, 0), end: new Position(n, (lines[n] ?? '').length) } };
    },
    getWordRangeAtPosition: (pos) => {
      const line = (docText.split('\n')[pos.line] ?? '');
      const isWord = (ch) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);
      let start = pos.character;
      let end = pos.character;
      while (start > 0 && isWord(line[start - 1])) start--;
      while (end < line.length && isWord(line[end])) end++;
      return start === end ? undefined : new Range(pos.line, start, pos.line, end);
    }
  };
}

const vscode = {
  Position,
  Range,
  Selection,
  CancellationError: class extends Error {},
  Hover: class {
    constructor(contents, range) {
      this.contents = contents;
      this.range = range;
    }
  },
  MarkdownString: class {
    constructor(value) {
      this.value = value || '';
    }
    appendMarkdown(text) {
      this.value += text;
      return this;
    }
    appendText(text) {
      this.value += text;
      return this;
    }
  },
  EventEmitter: class {
    constructor() {
      this.listeners = [];
      this.event = (fn) => {
        this.listeners.push(fn);
        return { dispose() {} };
      };
    }
    fire(value) {
      for (const listener of this.listeners) listener(value);
    }
    dispose() {}
  },
  Uri: {
    parse: (value) => ({ scheme: value.split(':')[0], fsPath: value, toString: () => value }),
    file: (value) => ({ scheme: 'file', fsPath: value, toString: () => `file://${value}` })
  },
  InlayHint: class {
    constructor(position, label, kind) {
      this.position = position;
      this.label = label;
      this.kind = kind;
    }
  },
  InlayHintKind: { Type: 1, Parameter: 2 },
  ThemeColor: class {
    constructor(id) {
      this.id = id;
    }
  },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  StatusBarAlignment: { Right: 2 },
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1 },
  languages: {
    registerHoverProvider: (_selector, provider) => {
      hoverProviders.push(provider);
      return { dispose() {} };
    },
    registerInlayHintsProvider: () => ({ dispose() {} })
  },
  window: {
    activeTextEditor: undefined,
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    createTextEditorDecorationType: () => ({ dispose() {} }),
    createOutputChannel: () => ({
      appendLine: (value) => logs.push(String(value)),
      append: () => {},
      show: () => {},
      dispose: () => {}
    }),
    withProgress: (_options, task) =>
      Promise.resolve(task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) })),
    showInformationMessage: async (message) => {
      logs.push(`[info] ${message}`);
      return '取消';
    },
    showWarningMessage: async (message) => {
      logs.push(`[warn] ${message}`);
      return undefined;
    },
    showErrorMessage: async (message) => {
      logs.push(`[error] ${message}`);
      return undefined;
    },
    showQuickPick: async (items) => {
      const resolved = await items;
      return resolved[0];
    },
    showInputBox: async (options) => (options && options.value ? options.value : 'hello from input box'),
    setStatusBarMessage: (message) => {
      logs.push(`[status] ${message}`);
      return { dispose() {} };
    },
    onDidChangeTextEditorSelection: () => ({ dispose() {} }),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    registerWebviewViewProvider: () => ({ dispose() {} }),
    createWebviewPanel: () => ({
      webview: { html: '', onDidReceiveMessage: () => ({ dispose() {} }) },
      onDidDispose: () => ({ dispose() {} }),
      dispose() {}
    }),
    showTextDocument: async () => ({})
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, def) => (key in config ? config[key] : def),
      update: async (key, value) => {
        config[key] = value;
        updates.push(`${key}=${JSON.stringify(value)}`);
      }
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: (scheme, provider) => {
      contentProviders[scheme] = provider;
      return { dispose() {} };
    },
    openTextDocument: async (arg) => makeDocument(arg && arg.content !== undefined ? arg.content : '', 'markdown')
  },
  commands: {
    registerCommand: (id, fn) => {
      registry[id] = fn;
      return { dispose() {} };
    },
    executeCommand: async (id) => logs.push(`[exec] ${id}`)
  },
  env: {
    clipboard: {
      readText: async () => 'clipboard sample text',
      writeText: async (value) => {
        clipboard = value;
      }
    }
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const extension = require(path.join(__dirname, '..', 'out', 'extension.js'));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const results = [];

async function check(id, setup) {
  try {
    await setup();
    await registry[id]();
    results.push([id, 'OK', '']);
  } catch (error) {
    results.push([id, 'FAIL', error && error.message ? error.message : String(error)]);
  }
}

function openEditor(text, languageId, selection) {
  const document = makeDocument(text, languageId);
  const editor = {
    document,
    selection,
    get selections() {
      return [this.selection];
    },
    setDecorations: () => {},
    edit: async (callback) => {
      const ops = [];
      callback({
        replace(range, value) {
          ops.push({ start: document.offsetAt(range.start), end: document.offsetAt(range.end), text: value });
        }
      });
      ops.sort((a, b) => b.start - a.start);
      for (const op of ops) {
        docText = docText.slice(0, op.start) + op.text + docText.slice(op.end);
      }
      return true;
    }
  };
  vscode.window.activeTextEditor = editor;
  return editor;
}

(async () => {
  extension.activate({
    subscriptions: [],
    extension: { packageJSON: { version: 'test' } },
    globalState: (() => {
      const state = new Map();
      return {
        get: (key, def) => (state.has(key) ? state.get(key) : def),
        update: async (key, value) => state.set(key, value)
      };
    })(),
    secrets: {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {}
    }
  });

  Object.assign(config, {
    engine: 'bing',
    targetLanguage: 'zh-CN',
    codeScope: 'comments',
    cacheEnabled: true,
    segmentMode: 'line',
    hoverMode: 'all',
    dictionaryEnabled: true,
    voice: 'system'
  });

  const jsSource = ['// upload the file to server', 'const url = "/api/upload";', 'const msg = "Upload failed";'].join('\n');
  const pyDoc = '# read the config file\nimport os\nprint(1)';

  // 先跑一次悬停，让 lastLookup 有值，后面 card 相关命令才有对象
  await check('translation.translate', () => openEditor('hello world', 'plaintext', new Selection(0, 0, 0, 11)));
  await check('translation.translateInclusive', () => openEditor('hello world', 'plaintext', new Selection(0, 0, 0, 0)));
  await check('translation.translateExclusive', () => openEditor('hello world', 'plaintext', new Selection(0, 0, 0, 0)));
  await check('translation.openDialog', () => openEditor('hello world', 'plaintext', new Selection(0, 0, 0, 11)));
  await check('translation.translateClipboard', () => openEditor('hello world', 'plaintext', new Selection(0, 0, 0, 11)));
  await check('translation.translateDocumentation', () =>
    openEditor('hello world', 'plaintext', new Selection(0, 0, 0, 0))
  );
  await check('translation.translateAndReplace', () => openEditor(jsSource, 'javascript', new Selection(0, 0, 2, 0)));
  await check('translation.translateAndReplaceWithLanguage', () =>
    openEditor(jsSource, 'javascript', new Selection(0, 0, 2, 0))
  );
  await check('translation.previewTranslation', () => openEditor(jsSource, 'javascript', new Selection(0, 0, 0, 24)));
  await check('translation.copyTranslation', () => openEditor('copy this text', 'plaintext', new Selection(0, 0, 0, 14)));
  await check('translation.translateDocumentComments', () => openEditor(pyDoc, 'python', new Selection(0, 0, 0, 0)));

  // 悬停一次，填充 lastLookup
  const hoverEditor = openEditor('the upload failed', 'plaintext', new Selection(0, 0, 0, 0));
  await hoverProviders[0].provideHover(hoverEditor.document, new Position(0, 5), { isCancellationRequested: false });

  await check('translation.speak', () => openEditor('hello', 'plaintext', new Selection(0, 0, 0, 5)));
  await check('translation.stopSpeaking', async () => {});
  await check('translation.speakLast', async () => {});
  await check('translation.copyLast', async () => {});
  await check('translation.replaceLast', async () => {
    openEditor('the upload failed', 'plaintext', new Selection(0, 0, 0, 0));
  });
  await check('translation.addLastToVocabulary', async () => {});
  await check('translation.showVocabulary', async () => {});
  await check('translation.clearVocabulary', async () => {});
  await check('translation.removeFromVocabulary', async () => {});
  await check('translation.showDictionaryDetail', () => openEditor('hello world', 'plaintext', new Selection(0, 0, 0, 5)));
  await check('translation.pinCard', async () => {});
  await check('translation.wordOfTheDay', async () => {});
  await check('translation.selectVoice', async () => {});
  await check('translation.showHistory', async () => {});
  await check('translation.openSettings', async () => {});
  await check('translation.toggleDocumentation', async () => {});
  await check('translation.toggleCardPanel', async () => {});
  await check('translation.toggleInlayHints', async () => {});
  await check('translation.showInlayDetail', async () => {});
  await check('translation.speakInlayText', async () => {});
  await check('translation.selectEngine', async () => {});
  await check('translation.selectTargetLanguage', async () => {});
  await check('translation.setApiKey', async () => {});
  await check('translation.testAllEngines', async () => {});
  await check('translation.clearCache', async () => {});
  await check('translation.testEngine', async () => {});
  await check('translation.selfTest', async () => {});

  const declared = pkg.contributes.commands.map((item) => item.command);
  const notRun = declared.filter((id) => !results.some(([done]) => done === id));

  console.log('命令\t结果\t错误');
  for (const [id, status, message] of results) {
    console.log(`${status === 'OK' ? '✅' : '❌'} ${id}\t${status}${message ? `\t${message}` : ''}`);
  }
  console.log(`\n共 ${results.length} 个命令，失败 ${results.filter(([, s]) => s === 'FAIL').length} 个`);
  console.log(`未执行: ${notRun.join(', ') || '无'}`);
  console.log(`设置项被修改: ${updates.join(', ') || '无'}`);
  const provider = contentProviders['translation-vocabulary'];
  console.log(`生词本内容前 80 字: ${provider ? JSON.stringify(provider.provideTextDocumentContent().slice(0, 80)) : '未注册'}`);
})().catch((error) => {
  console.error('HARNESS FAILED', error);
  process.exit(1);
});
