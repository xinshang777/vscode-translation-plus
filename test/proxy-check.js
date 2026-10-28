// 验证 CONNECT 隧道代理真的能工作：起一个本地代理，让 Bing 请求走它
const http = require('http');
const net = require('net');
const { configureProxy } = require('../out/util');
const { bingEngine } = require('../out/engines/bing');
const { splitPieces } = require('../out/util');

const seen = [];
const proxy = http.createServer((req, res) => {
  res.writeHead(501);
  res.end('only CONNECT');
});
proxy.on('connect', (req, clientSocket, head) => {
  seen.push(req.url);
  const [host, port] = req.url.split(':');
  const upstream = net.connect(Number(port) || 443, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

const ctx = { getConfig: (k, d) => d, getSecret: async () => undefined, timeout: 20000 };

(async () => {
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const port = proxy.address().port;
  console.log(`本地代理已启动 127.0.0.1:${port}`);

  configureProxy(`http://127.0.0.1:${port}`);
  const viaProxy = await bingEngine.translate('proxy tunnel test', 'auto-detect', 'zh-Hans', ctx);
  console.log('走代理翻译:', JSON.stringify(viaProxy));
  console.log('代理收到的 CONNECT:', seen.join(', '));

  configureProxy(undefined);
  const direct = await bingEngine.translate('direct connection test', 'auto-detect', 'zh-Hans', ctx);
  console.log('直连翻译:', JSON.stringify(direct));
  console.log('代理收到次数（应仍为 1）:', seen.length);

  // 分句模式检查
  const sample = 'Hello world. How are you? I am fine.\n第二行中文。结束';
  const pieces = splitPieces(sample, 'sentence');
  console.log('\n分句结果:', pieces.map((p) => JSON.stringify(p.text)).join(' | '));
  const rebuilt = pieces.map((p) => p.text).join('');
  console.log('拼接是否等于原文:', rebuilt === sample);

  const lines = splitPieces('a\nbb\n\nccc', 'line');
  console.log('分行结果:', lines.map((p) => JSON.stringify(p.text)).join(' | '));

  proxy.close();
})().catch((error) => {
  console.error('FAILED', error.message);
  proxy.close();
  process.exit(1);
});
