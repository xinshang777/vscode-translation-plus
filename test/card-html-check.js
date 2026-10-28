const { renderCardHtml } = require('../out/cardHtml');

const html = renderCardHtml({
  word: 'initial',
  phonetic: '美 /ɪˈnɪʃ(ə)l/',
  translation: '初始',
  engine: 'Bing 翻译',
  to: '简体中文',
  pinned: false,
  sections: [
    { label: '释义', items: ['adj. 开始的，最初的', 'n. （姓名的）首字母'] },
    { label: '词形', items: ['复数：initials', '过去式：initialled'] },
    { label: '例句', items: ['The initial reaction has been excellent.\u0001最初的反应极好。'] },
    { label: '柯林斯', items: ['ADJ You use initial to describe something…'] }
  ]
});

const checks = {
  长度: html.length,
  卡片容器: html.includes('class="card"'),
  词性徽章: html.includes('class="pos"'),
  渲染按钮: html.includes('data-cmd="replace"'),
  内联脚本: html.includes('acquireVsCodeApi'),
  双语例句: html.includes('class="zh"'),
  主题变量: html.includes('--vscode-button-background')
};
console.log(checks);

const empty = renderCardHtml(undefined);
console.log('空态提示:', empty.includes('翻译卡片'));

// 简单结构校验：标签配平
const open = (html.match(/<div/g) || []).length;
const close = (html.match(/<\/div>/g) || []).length;
console.log('div 开/闭:', open, close, open === close ? '✅ 配平' : '❌ 不配平');
