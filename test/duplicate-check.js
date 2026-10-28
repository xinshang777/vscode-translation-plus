// 复现“内容写两遍”的场景：别的扩展的 hover 被当作文档翻译
const Module = require('module');
const path = require('path');

const vscode = {
  MarkdownString: class {
    constructor(v) {
      this.value = v || '';
      this.isTrusted = false;
    }
  },
  commands: { executeCommand: async () => undefined }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { translatedDocumentation, isRedundantDocumentation } = require(path.join(__dirname, '..', 'out', 'docHover'));

const service = { translate: async (t) => ({ text: `【${t}】` }) };
const document = { uri: { toString: () => 'file:///a.html' } };

function hoverOf(value) {
  return [{ contents: [{ value }] }];
}

(async () => {
  // 场景 1：别的翻译扩展的 hover（中文短句）→ 应该被过滤
  vscode.commands.executeCommand = async () => hoverOf('翻译：初始');
  console.log('中文短 hover（应被过滤）:', await translatedDocumentation(document, {}, service, 'initial'));

  // 场景 2：英文文档 → 正常翻译
  vscode.commands.executeCommand = async () =>
    hoverOf('Specifies the initial value of the CSS property when the element is rendered for the first time.');
  const docs = await translatedDocumentation(document, {}, service, 'initial');
  console.log('英文文档（应保留）:', docs ? docs.translated.slice(0, 40) : undefined);

  // 场景 3：文档译文与主译文重复 → 判重
  console.log('判重（完全相同）:', isRedundantDocumentation({ original: '初始', translated: '初始' }, '初始'));
  console.log('判重（不重复）:', isRedundantDocumentation({ original: 'abc', translated: 'xyz' }, '初始'));
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
