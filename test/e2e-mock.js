// 精简版端到端检查：英文注释/字符串 → 中文，代码结构保持不变
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
}

let docText = '';
const registry = Object.create(null);
const logs = [];
const config = {};

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
  return {
    languageId,
    uri: { toString: () => 'file:///t' },
    getText: (range) => (range ? docText.slice(offsetAt(range.start), offsetAt(range.end)) : docText),
    offsetAt,
    positionAt,
    lineAt: (n) => {
      const lines = docText.split('\n');
      return { text: lines[n], range: { start: new Position(n, 0), end: new Position(n, lines[n].length) } };
    },
    getWordRangeAtPosition: () => undefined
  };
}

const hoverProviders = [];

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
    constructor(v) {
      this.value = v || '';
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
  StatusBarAlignment: { Right: 2 },
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1 },
  languages: {
    registerHoverProvider: (_selector, provider) => {
      hoverProviders.push(provider);
      return { dispose() {} };
    }
  },
  window: {
    activeTextEditor: undefined,
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
    createOutputChannel: () => ({
      appendLine: (v) => logs.push(v),
      append: () => {},
      show: () => {},
      dispose: () => {}
    }),
    withProgress: (_o, task) => Promise.resolve(task({ report() {} }, { isCancellationRequested: false })),
    showInformationMessage: async (m) => {
      logs.push(`[info] ${m}`);
      return undefined;
    },
    showWarningMessage: async (m) => logs.push(`[warn] ${m}`),
    showErrorMessage: async (m) => logs.push(`[error] ${m}`),
    showQuickPick: async (items) => (await items)[0],
    showInputBox: async () => undefined,
    setStatusBarMessage: (m) => logs.push(`[status] ${m}`),
    showTextDocument: async () => ({})
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, def) => (key in config ? config[key] : def),
      update: async () => {}
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    openTextDocument: async (arg) => makeDocument(arg && arg.content ? arg.content : '', 'markdown')
  },
  commands: {
    registerCommand: (id, fn) => {
      registry[id] = fn;
      return { dispose() {} };
    },
    executeCommand: async (id) => logs.push(`[exec] ${id}`)
  },
  env: { clipboard: { writeText: async () => {} } }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const extension = require(path.join(__dirname, '..', 'out', 'extension.js'));

async function runCase(title, source, languageId, selectionEndLine, scope, command = 'translation.translateAndReplace', extra = {}) {
  const document = makeDocument(source, languageId);
  const editor = {
    document,
    selection: new Selection(0, 0, selectionEndLine, 0),
    get selections() {
      return [this.selection];
    },
    edit: async (callback) => {
      // 真实 VSCode 里同一批 edit 都基于编辑前的文档版本，所以先收集再倒序应用
      const ops = [];
      callback({
        replace(range, text) {
          ops.push({ start: document.offsetAt(range.start), end: document.offsetAt(range.end), text });
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
  Object.assign(config, { engine: 'bing', targetLanguage: 'zh-CN', codeScope: scope, cacheEnabled: true }, extra);
  await registry[command]();
  console.log(`\n===== ${title} =====\n${docText}`);
}

(async () => {
  const state = new Map();
  extension.activate({
    subscriptions: [],
    globalState: {
      get: (key, def) => (state.has(key) ? state.get(key) : def),
      update: async (key, value) => {
        state.set(key, value);
      }
    },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} }
  });

  const js = [
    '// upload the file to the server',
    'function upload(file) {',
    '  const url = "/api/upload";',
    '  const msg = "Upload failed, please retry";',
    '  const id = "user_id";',
    '  return post(url, file, msg);',
    '}'
  ].join('\n');
  await runCase('JS · 注释+字符串', js, 'javascript', 6, 'commentsAndStrings');
  await runCase('JS · 只翻注释', js, 'javascript', 6, 'comments');

  const py = '# read the config file\nimport os  # import the standard library\ndef main():\n    pass';
  await runCase('Python · 整文件注释', py, 'python', 0, 'comments', 'translation.translateDocumentComments');

  await runCase('中文 → 自动互译成英文', '这是一个自动互译测试。\n第二行也是中文。', 'plaintext', 1, 'selection');

  // 增量翻译 1：整段 4 行按行切分，第二次只改一行
  const block1 = ['// upload the file', '// check the size limit', '// send to server', '// return the url'].join('\n');
  await runCase('增量·整段第一次', block1, 'plaintext', 4, 'selection', 'translation.translateAndReplace', {
    segmentMode: 'line'
  });
  const block2 = ['// upload the file', '// check the size limit', '// send to remote server', '// return the url'].join('\n');
  await runCase('增量·整段第二次（改第 3 行）', block2, 'plaintext', 4, 'selection', 'translation.translateAndReplace', {
    segmentMode: 'line'
  });

  // 增量翻译 2：整文件注释，第二次只改一条注释
  const countRequests = () => logs.filter((line) => /^\[\d{2}:\d{2}:\d{2}\]/.test(line)).length;
  const doc1 = ['// upload the file', '// check the size limit', '// send to server', '// return the url'].join('\n');
  const doc2 = ['// upload the file', '// check the size limit', '// send to remote server', '// return the url'].join('\n');
  let mark = countRequests();
  await runCase('注释增量·第一次', doc1, 'javascript', 0, 'comments', 'translation.translateDocumentComments');
  const firstRequests = countRequests() - mark;
  mark = countRequests();
  await runCase('注释增量·第二次（改 1 条）', doc2, 'javascript', 0, 'comments', 'translation.translateDocumentComments');
  const secondRequests = countRequests() - mark;
  console.log(`\n===== 增量统计 =====\n第一次请求 ${firstRequests} 次，第二次（只改 1 条）请求 ${secondRequests} 次`);

  // 悬停卡片：单词词典 + 译文
  config.hoverMode = 'word';
  config.dictionaryEnabled = true;
  config.engine = 'bing';
  config.targetLanguage = 'zh-CN';
  config.cacheEnabled = false;
  const hoverDoc = makeDocument('the upload failed, please retry later', 'plaintext');
  hoverDoc.getWordRangeAtPosition = (pos) => {
    const line = docText.split('\n')[pos.line] ?? '';
    const isWord = (ch) => ch !== undefined && /[A-Za-z]/.test(ch);
    let start = pos.character;
    let end = pos.character;
    while (start > 0 && isWord(line[start - 1])) start--;
    while (end < line.length && isWord(line[end])) end++;
    return start === end ? undefined : new Range(pos.line, start, pos.line, end);
  };
  const hoverEditor = { document: hoverDoc, selection: new Selection(0, 0, 0, 0) };
  vscode.window.activeTextEditor = hoverEditor;
  const provider = hoverProviders[0];
  const hover = await provider.provideHover(hoverDoc, new Position(0, 5), { isCancellationRequested: false });
  console.log('\n===== 悬停卡片（词：upload） =====\n' + (hover ? hover.contents.value : '（无）'));

  // 收藏 + 生词本
  await registry['translation.addLastToVocabulary']();
  await registry['translation.addLastToVocabulary']();
  await registry['translation.showVocabulary']();

  // 多光标：两个光标各翻一个单词
  const multiSource = 'hello world, again';
  const multiDocument = makeDocument(multiSource, 'plaintext');
  const multiEditor = {
    document: multiDocument,
    selection: new Selection(0, 0, 0, 5),
    selections: [new Selection(0, 0, 0, 5), new Selection(0, 13, 0, 18)],
    edit: async (callback) => {
      const ops = [];
      callback({
        replace(range, text) {
          ops.push({ start: multiDocument.offsetAt(range.start), end: multiDocument.offsetAt(range.end), text });
        }
      });
      ops.sort((a, b) => b.start - a.start);
      for (const op of ops) {
        docText = docText.slice(0, op.start) + op.text + docText.slice(op.end);
      }
      return true;
    }
  };
  vscode.window.activeTextEditor = multiEditor;
  Object.assign(config, { engine: 'bing', targetLanguage: 'zh-CN', codeScope: 'selection', cacheEnabled: true });
  await registry['translation.translateAndReplace']();
  console.log(`\n===== 多光标替换 =====\n${docText}`);

  console.log('\n===== 增量日志 =====\n' + logs.filter((line) => line.startsWith('[incremental]')).join('\n'));
  console.log('\n===== 日志 =====\n' + logs.slice(-6).join('\n'));
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
