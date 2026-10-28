// 验证：悬停中文词是否翻译成英文；方向判断是否符合预期
const Module = require('module');
const path = require('path');

const config = { autoSwapDirection: true, targetLanguage: 'zh-CN' };
const vscode = { workspace: { getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) }) } };

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { TranslationService } = require(path.join(__dirname, '..', 'out', 'service'));

// 只测 resolveDirection：构造一个最小实例（绕过构造函数里的 vscode 依赖）
const service = Object.create(TranslationService.prototype);

const cases = [
  ['初始', 'zh-CN'],
  ['上传文件到服务器', 'zh-CN'],
  ['hello world', 'zh-CN'],
  ['Hello 世界', 'zh-CN'],
  ['你好，世界', 'zh-CN'],
  ['翻译', 'zh-CN']
];

for (const [text, target] of cases) {
  console.log(`${JSON.stringify(text).padEnd(22)} → ${service.resolveDirection(text, target)}`);
}
