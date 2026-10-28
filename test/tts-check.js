// 验证朗读链路：edge 失败后是否自动落到 google 并真的出声
const Module = require('module');
const path = require('path');

const config = { ttsEngine: 'edge', edgeVoice: '', phoneticAccent: 'us' };

const vscode = {
  workspace: {
    getConfiguration: () => ({
      get: (key, def) => (key in config ? config[key] : def),
      update: async () => {}
    })
  },
  StatusBarAlignment: { Right: 2 }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { speakText, onSpeakingChanged } = require(path.join(__dirname, '..', 'out', 'audio'));

let speakingEvents = 0;
onSpeakingChanged((value) => {
  if (value) {
    speakingEvents++;
  }
});

(async () => {
  const started = Date.now();
  const result = await speakText('你好，这是整句语音测试。', 'zh');
  console.log('实际使用的引擎：', result.engine);
  console.log('是否播放：', result.played);
  console.log('耗时(ms)：', Date.now() - started);
  console.log('播放状态事件数：', speakingEvents);
  await new Promise((resolve) => setTimeout(resolve, 2500));
})().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});
