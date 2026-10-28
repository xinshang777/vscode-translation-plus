// 验证 B4 侧栏预览内容 与 B6 语言服务词边界
const Module = require('module');
const path = require('path');

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}
class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
  get isEmpty() {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
  contains(p) {
    const afterStart = p.line > this.start.line || (p.line === this.start.line && p.character >= this.start.character);
    const beforeEnd = p.line < this.end.line || (p.line === this.end.line && p.character <= this.end.character);
    return afterStart && beforeEnd;
  }
}

let hoverResult = [];

const vscode = {
  Position,
  Range,
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
      for (const fn of this.listeners) fn(value);
    }
    dispose() {}
  },
  Uri: { parse: (v) => ({ scheme: v.split(':')[0], toString: () => v }) },
  commands: {
    executeCommand: async (id) => (id === 'vscode.executeHoverProvider' ? hoverResult : undefined)
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { ReplacePreviewProvider } = require(path.join(__dirname, '..', 'out', 'preview'));
const { nativeWordRange } = require(path.join(__dirname, '..', 'out', 'docHover'));

(async () => {
  // B4
  const preview = new ReplacePreviewProvider();
  preview.set('upload file', ['uploadFile', 'UploadFile', 'upload_file']);
  const first = preview.provideTextDocumentContent();
  preview.setActive(2);
  const second = preview.provideTextDocumentContent();
  console.log('B4 首次预览含 uploadFile：', first.includes('uploadFile'));
  console.log('B4 首次预览标记第 1 个：', first.includes('将替换为（第 1 / 3 个）'));
  console.log('B4 切换后标记第 3 个：', second.includes('将替换为（第 3 / 3 个）'));
  console.log('B4 切换后正文是 upload_file：', second.includes('```text\nupload_file\n```'));

  // B6
  const document = { uri: { toString: () => 'file:///a.ts' } };
  hoverResult = [new vscode.Hover('docs', new Range(new Position(3, 4), new Position(3, 14)))];
  const range = await nativeWordRange(document, new Position(3, 6));
  console.log('\nB6 取到语言服务词边界：', Boolean(range), range ? `${range.start.character}-${range.end.character}` : '');

  hoverResult = [new vscode.Hover('no range')];
  const empty = await nativeWordRange(document, new Position(3, 6));
  console.log('B6 无 range 时返回 undefined：', empty === undefined);
})().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});
