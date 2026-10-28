const http = require('http');
const net = require('net');
const https = require('https');
const tls = require('tls');

class TunnelAgent extends https.Agent {
  constructor(proxy) {
    super({ keepAlive: true, maxSockets: 8 });
    this.proxy = new URL(proxy);
  }
  createConnection(options, callback) {
    const p = this.proxy;
    const req = http.request({
      host: p.hostname,
      port: Number(p.port) || 80,
      method: 'CONNECT',
      path: `${options.host}:${options.port}`,
      headers: { Host: `${options.host}:${options.port}` }
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return callback(new Error('CONNECT ' + res.statusCode));
      const secure = tls.connect({ socket, servername: options.host });
      secure.once('secureConnect', () => callback(null, secure));
    });
    req.on('error', callback);
    req.end();
  }
}

const proxy = http.createServer((q, s) => {
  s.writeHead(501);
  s.end();
});
proxy.on('connect', (req, clientSocket, head) => {
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

(async () => {
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const agent = new TunnelAgent(`http://127.0.0.1:${proxy.address().port}`);

  const request = (headers) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        'https://www.bing.com/translator',
        { agent, headers, timeout: 15000 },
        (res) => {
          let len = 0;
          res.on('data', (chunk) => (len += chunk.length));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, len }));
        }
      );
      req.on('error', reject);
      req.end();
    });

  for (const [name, headers] of [
    ['无额外头', { 'User-Agent': 'Mozilla/5.0' }],
    ['带 Accept', { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }]
  ]) {
    try {
      const res = await request(headers);
      console.log(name, res.status, 'len', res.len, 'location', res.headers.location, 'server', res.headers.server);
    } catch (error) {
      console.log(name, 'ERR', error.message);
    }
  }
  proxy.close();
})();
