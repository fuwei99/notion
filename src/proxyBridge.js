import http from 'http';
import net from 'net';
import { URL } from 'url';

function log(...args) {
  console.log('[ProxyBridge]', ...args);
}

let bridgeServer = null;

/**
 * 启动本地代理桥：监听 HOST:PORT，把所有流量转发到带认证的上游 AUTH_PROXY_URL，
 * 自动注入 Proxy-Authorization，供不支持认证的 chrome_proxy_server 使用。
 */
export function startProxyBridge({
  authProxyUrl = process.env.AUTH_PROXY_URL || '',
  port = parseInt(process.env.PROXY_BRIDGE_PORT || '7861', 10),
  host = process.env.PROXY_BRIDGE_HOST || '127.0.0.1',
} = {}) {
  if (bridgeServer) {
    log('代理桥已在运行');
    return bridgeServer;
  }
  if (!authProxyUrl) {
    log('未设置 AUTH_PROXY_URL，跳过启动');
    return null;
  }

  const upstream = new URL(authProxyUrl);
  const upstreamHost = upstream.hostname;
  const upstreamPort = parseInt(
    upstream.port || (upstream.protocol === 'https:' ? '443' : '80'),
    10
  );
  const upstreamAuth =
    upstream.username && upstream.password
      ? 'Basic ' +
        Buffer.from(
          `${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`
        ).toString('base64')
      : '';

  const connectToUpstream = () => net.connect({ host: upstreamHost, port: upstreamPort });

  const server = http.createServer((clientReq, clientRes) => {
    const reqHeaders = { ...clientReq.headers };
    if (upstreamAuth) reqHeaders['proxy-authorization'] = upstreamAuth;

    const proxyReq = http.request(
      {
        host: upstreamHost,
        port: upstreamPort,
        method: clientReq.method,
        path: clientReq.url,
        headers: reqHeaders,
        agent: false,
      },
      (upstreamRes) => {
        clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
      }
    );

    proxyReq.on('error', (err) => {
      log('HTTP 转发错误:', err.message);
      if (!clientRes.headersSent) clientRes.writeHead(502);
      clientRes.end('Bad Gateway');
    });

    clientReq.pipe(proxyReq);
  });

  server.on('connect', (req, clientSocket, head) => {
    const target = req.url;
    log(`CONNECT ${target}`);

    const upSocket = connectToUpstream();
    let connected = false;

    const connectLine =
      `CONNECT ${target} HTTP/1.1\r\n` +
      `Host: ${target}\r\n` +
      (upstreamAuth ? `Proxy-Authorization: ${upstreamAuth}\r\n` : '') +
      `\r\n`;

    upSocket.on('connect', () => upSocket.write(connectLine));

    upSocket.on('data', function onData(chunk) {
      if (connected) return;
      const text = chunk.toString('utf8');
      const m = text.match(/^HTTP\/\d\.\d (\d+)/);
      if (!m) {
        log('上游 CONNECT 响应异常:', text.split('\r\n')[0]);
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        upSocket.destroy();
        return;
      }
      const status = parseInt(m[1], 10);
      if (status !== 200) {
        log(`上游拒绝 CONNECT (${status}):`, text.split('\r\n')[0]);
        clientSocket.end(`HTTP/1.1 ${status} Bad Gateway\r\n\r\n`);
        upSocket.destroy();
        return;
      }
      connected = true;
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const idx = chunk.indexOf('\r\n\r\n');
      if (idx !== -1 && chunk.length > idx + 4) clientSocket.write(chunk.slice(idx + 4));
      upSocket.removeListener('data', onData);
      upSocket.pipe(clientSocket);
      clientSocket.pipe(upSocket);
      if (head && head.length) upSocket.write(head);
    });

    upSocket.on('error', (err) => {
      log('上游连接错误:', err.message);
      if (!connected) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.destroy();
    });

    clientSocket.on('error', (err) => {
      log('客户端连接错误:', err.message);
      upSocket.destroy();
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      log('启动失败:', err.message);
      reject(err);
    });
    server.listen(port, host, () => {
      log(
        `代理桥已启动: ${host}:${port} → ${upstreamHost}:${upstreamPort}${upstreamAuth ? ' (带认证)' : ''}`
      );
      bridgeServer = server;
      resolve(server);
    });
  });
}

export function stopProxyBridge() {
  if (!bridgeServer) return;
  bridgeServer.close();
  bridgeServer = null;
  log('代理桥已停止');
}

// 作为独立脚本运行
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  if (!process.env.AUTH_PROXY_URL) {
    console.error('[ProxyBridge] 未设置 AUTH_PROXY_URL 环境变量，退出');
    process.exit(1);
  }
  startProxyBridge().catch((err) => {
    console.error('[ProxyBridge] 启动失败:', err.message);
    process.exit(1);
  });
  const shutdown = (sig) => {
    log(`收到 ${sig}，关闭代理桥`);
    stopProxyBridge();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
