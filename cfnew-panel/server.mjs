import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createSubscriptionEngine } from './engine.mjs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateTesting = process.env.CFNEW_ALLOW_PRIVATE === 'yes';
const landing = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const bridge = await readFile(new URL('./bridge.js', import.meta.url), 'utf8');
const safeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c');

export function normalizeWorker(value) {
  const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请输入 Worker 域名');
  if (!privateTesting && (url.protocol !== 'https:' || (url.port && url.port !== '443'))) throw new Error('Worker 须使用 HTTPS');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('域名中不要带路径');
  return url.origin;
}

function isPublicAddress(address) {
  const value = address.toLowerCase();
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  // IPv6 公网单播；映射地址仍按 IPv4 规则判断。
  if (value.startsWith('::ffff:') && value.includes('.')) return isPublicAddress(value.slice(7));
  return isIP(value) === 6 && /^[23][0-9a-f]{3}:/.test(value) && !value.startsWith('2001:db8:');
}

export async function loadWorkerConfig(workerBase, uuid) {
  const url = new URL(workerBase + '/' + uuid + '/api/config');
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || (!privateTesting && addresses.some(item => !isPublicAddress(item.address)))) throw new Error('Worker 域名必须解析到公网地址');
  const address = addresses[0];
  const body = await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; CFnewPanel)' },
      // 固定已校验的解析结果，禁止重定向到内网或二次解析切换地址。
      lookup: (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
    }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('读取配置失败，请确认 Worker 域名、UUID 和核心版本')); return; }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 131072) { request.destroy(new Error('配置过大')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    const timer = setTimeout(() => request.destroy(new Error('连接 Worker 超时')), 10000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
    request.end();
  });
  const config = JSON.parse(body);
  if (!config || Array.isArray(config) || typeof config !== 'object' || typeof config.kvEnabled !== 'boolean') throw new Error('该地址没有兼容的配置接口');
  return config;
}

function targetForAgent(agent = '') {
  const ua = agent.toLowerCase();
  if (ua.includes('sing-box') || ua.includes('singbox')) return 'singbox';
  if (ua.includes('clash') || ua.includes('mihomo') || ua.includes('stash')) return 'clash';
  if (ua.includes('surge')) return 'surge';
  if (ua.includes('loon')) return 'loon';
  if (ua.includes('quantumult')) return 'quanx';
  return 'base64';
}

export async function handlePanel(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('只支持 GET', { status: 405 });
  if (url.pathname === '/health') return Response.json({ ok: true });
  if (url.pathname === '/') return new Response(landing, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (!['/panel', '/sub'].includes(url.pathname)) return new Response('Not Found', { status: 404 });
  try {
    const workerBase = normalizeWorker((url.searchParams.get('host') || '').trim());
    const uuid = (url.searchParams.get('uuid') || '').trim().toLowerCase();
    if (!uuidPattern.test(uuid)) throw new Error('请填写有效 UUID');
    const config = await loadWorkerConfig(workerBase, uuid);
    const engine = createSubscriptionEngine(config, uuid);
    // 节点生成用 Worker 主机，不能误用面板主机作为 SNI/Host。
    const workerUrl = new URL(workerBase + '/' + uuid + '/sub');
    workerUrl.searchParams.set('target', url.searchParams.get('target') || targetForAgent(request.headers.get('User-Agent')));
    if (url.pathname === '/sub') return await engine.subscribe(new Request(workerUrl, { headers: request.headers }));
    const rendered = await engine.render(new Request(workerBase + '/' + uuid, { headers: request.headers }));
    const subParams = new URLSearchParams({ host: workerBase, uuid });
    const context = { host: workerBase, uuid, apiBase: workerBase + '/' + uuid, subPath: '/sub?' + subParams, config };
    const boot = '<script>window.CFNEW=' + safeJson(context) + ';window.CFNEW.subUrl=location.origin+window.CFNEW.subPath;' + bridge + '</script>';
    let html = await rendered.text();
    html = html.replace('<head>', '<head>' + boot);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    if (url.pathname === '/sub') return new Response('订阅更新失败：' + error.message, { status: 503 });
    const message = String(error.message).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    return new Response('<!doctype html><meta charset="utf-8"><p>' + message + '</p><a href="/">返回填写域名和 UUID</a>', { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

export function createPanelServer() {
  return createHttpServer(async (incoming, outgoing) => {
    try {
      const request = new Request('http://' + (incoming.headers.host || 'localhost') + incoming.url, { method: incoming.method, headers: incoming.headers });
      const response = await handlePanel(request);
      const headers = Object.fromEntries(response.headers);
      Object.assign(headers, { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      outgoing.writeHead(response.status, headers);
      if (incoming.method === 'HEAD') { outgoing.end(); return; }
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      outgoing.end('服务暂时不可用');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3100);
  const host = process.env.HOST || '127.0.0.1';
  createPanelServer().listen(port, host, () => console.log('CFnew 独立面板已启动，端口 ' + port));
}
