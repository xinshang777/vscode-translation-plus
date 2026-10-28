// 验证 B3：顶栏输入（剪贴板预填）→ 顶部候选 → 复制回剪贴板
const Module = require('module');
const path = require('path');

let clipboardText = 'clipboard: upload the file now';
let lastQuickPick = null;

const vscode = {
  Position: class {},
  Range: class {},
  Selection: class {},
  ThemeColor: class {},
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
  StatusBarAlignment: { Right: 2 },
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1 },
  ViewColumn: { Beside: -2 },
  window: {
    withProgress: (_o, task) => Promise.resolve(task({ report() {} }, { isCancellationRequested: false })),
    showInputBox: async (options) => options && options.value,
    showQuickPick: async (items) => {
      const resolved = await items;
      lastQuickPick = resolved;
      return resolved[0];
    },
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async (m) => {
      throw new Error(`unexpected error message: ${m}`);
    },
    setStatusBarMessage: () => ({ dispose() {} }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    createTextEditorDecorationType: () => ({ dispose() {} }),
    showTextDocument: async () => ({})
  },
  workspace: {
    getConfiguration: () => ({ get: (_k, d) => d, update: async () => {} }),
    openTextDocument: async () => ({})
  },
  commands: { executeCommand: async () => undefined, registerCommand: () => ({ dispose() {} }) },
  env: {
    clipboard: {
      readText: async () => clipboardText,
      writeText: async (value) => {
        clipboardText = value;
      }
    }
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { translateClipboardFlow } = require(path.join(__dirname, '..', 'out', 'dialog'));

const service = {
  translate: async (text) => ({ text: `【${text}】`, from: 'auto', to: 'zh-CN', engineName: 'stub' }),
  resolveDirection: (_text, requested) => requested ?? 'zh-CN',
  engineId: 'bing'
};

const vocabulary = {
  list: () => [],
  add: async () => true
};

(async () => {
  await translateClipboardFlow({ globalState: { get: (_k, d) => d, update: async () => {} } }, service, vocabulary, () => {});
  console.log('候选列表首项：', lastQuickPick && lastQuickPick[0].label);
  console.log('剪贴板最终内容：', clipboardText);
  console.log('是否已把译文写回剪贴板：', clipboardText.startsWith('【'));
})().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});
