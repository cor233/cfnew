import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSubscriptionEngine } from '../engine.mjs';
import { normalizeWorker } from '../server.mjs';

const uuid = '351c9981-04b6-4103-aa4b-864aa9c91469';
const otherUuid = '67f889ca-63fc-4aee-9454-6a33cf4c9466';
const fixture = { yx: '104.16.1.1:443#测试,104.16.1.2:80#明文,[2606:4700::1111]:8443#六版', epi: 'yes', epd: 'no', egi: 'no', ena: 'no', ev: 'yes', et: 'yes', ex: 'yes', kvEnabled: true };
const source = await readFile(new URL('../../明文源吗', import.meta.url), 'utf8');
const module = await import('data:text/javascript;base64,' + Buffer.from(source.replace("import { connect as 连接 } from 'cloudflare:sockets';", 'const 连接 = () => { throw new Error("测试中不应建立连接"); };')).toString('base64'));
const worker = module.default;
function memoryKV(config = {}) {
  const values = new Map([['c', JSON.stringify(config)]]);
  return { get: async (key, type) => type === 'json' ? JSON.parse(values.get(key) || 'null') : values.get(key), put: async (key, value) => values.set(key, value) };
}
const req = (path, init) => new Request('https://worker.example' + path, init);

test('Worker 首页和订阅路径没有页面或订阅生成', async () => {
  assert.equal(await (await worker.fetch(req('/'))).text(), 'hello');
  assert.equal((await worker.fetch(req('/' + uuid + '/sub'), { u: uuid })).status, 404);
  assert.ok(!source.includes('<html') && !source.includes('function 处理订阅请求') && !source.includes('function 生成值值数据对象'));
});

test('UUID 配置接口严格鉴权，并返回环境变量与 KV 的有效配置', async () => {
  const env = { u: uuid, s: 'http://proxy.example:8080', ET: 'yes', c: memoryKV({ qj: 'only', d: '/custom/nested' }) };
  assert.equal((await worker.fetch(req('/wrong/api/config'), env)).status, 404);
  assert.equal((await worker.fetch(req('/api/config'), env)).status, 404);
  assert.equal((await worker.fetch(req('/wrong/api/config', { method: 'POST', body: '{"qj":"no"}' }), env)).status, 404);
  const response = await worker.fetch(req('/' + uuid + '/api/config'), env);
  const config = await response.json();
  assert.equal(config.s, env.s); assert.equal(config.et, 'yes'); assert.equal(config.qj, 'only'); assert.equal(config.kvEnabled, true);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal((await worker.fetch(req('/custom/nested/api/config'), env)).status, 200);
});

test('配置保存、清空、非法输入以及优选地址增删均按真实 API 执行', async () => {
  const env = { u: uuid, c: memoryKV({ ae: 'yes', yx: '104.16.1.1:443#旧值' }) };
  let response = await worker.fetch(req('/' + uuid + '/api/config', { method: 'POST', body: '{"qj":"only","et":"yes"}' }), env);
  assert.equal((await response.json()).success, true);
  assert.equal((await (await worker.fetch(req('/' + uuid + '/api/config'), env)).json()).qj, 'only');
  response = await worker.fetch(req('/' + uuid + '/api/config', { method: 'POST', body: '{"qj":""}' }), env);
  assert.equal((await response.json()).config.qj, '');
  assert.equal((await worker.fetch(req('/' + uuid + '/api/config', { method: 'POST', body: '{"__proto__":{}}' }), env)).status, 400);
  response = await worker.fetch(req('/' + uuid + '/api/preferred-ips', { method: 'POST', body: '{"ip":"104.16.1.2","port":8443,"name":"新增"}' }), env);
  assert.equal((await response.json()).added, 1);
  response = await worker.fetch(req('/' + uuid + '/api/preferred-ips', { method: 'DELETE', body: '{"ip":"104.16.1.2","port":8443}' }), env);
  assert.equal((await response.json()).success, true);
});

test('未绑定 KV 可生成订阅所需配置，但保存明确失败', async () => {
  const env = { U: uuid, YX: '104.16.1.1:443', ET: 'yes' };
  const config = await (await worker.fetch(req('/' + uuid + '/api/config'), env)).json();
  assert.equal(config.kvEnabled, false); assert.equal(config.yx, env.YX);
  assert.equal((await worker.fetch(req('/' + uuid + '/api/config', { method: 'POST', body: '{}' }), env)).status, 503);
});

test('并发 Worker 与订阅实例不会串用 UUID、KV 或域名', async () => {
  const results = await Promise.all([uuid, otherUuid].map(async (id, index) => {
    const config = await (await worker.fetch(req('/' + id + '/api/config'), { u: id, c: memoryKV({ yx: '104.16.1.' + (index + 1) + ':443' }) })).json();
    const engine = createSubscriptionEngine(config, id);
    return atob(await (await engine.subscribe(new Request('https://worker' + index + '.example/' + id + '/sub'))).text());
  }));
  assert.ok(results[0].includes(uuid) && !results[0].includes(otherUuid));
  assert.ok(results[1].includes(otherUuid) && !results[1].includes(uuid));
  assert.ok(results[0].includes('worker0.example') && !results[0].includes('worker1.example'));
});

test('所有主分支客户端格式都生成真实节点，保留 TLS、路径和三种协议', async () => {
  for (const target of ['base64', 'v2ray', 'clash', 'stash', 'surge', 'loon', 'quanx', 'singbox']) {
    const engine = createSubscriptionEngine({ ...fixture, d: '/my/path' }, uuid);
    const response = await engine.subscribe(new Request('https://worker.example/' + uuid + '/sub?target=' + target));
    assert.equal(response.status, 200, target);
    let body = await response.text();
    if (['base64', 'v2ray'].includes(target)) body = atob(body);
    assert.ok(body.includes('worker.example'), target);
    assert.ok(body.includes('104.16.1.1'), target);
    if (target === 'singbox') JSON.parse(body);
    if (target === 'base64') { assert.ok(body.includes('vless://') && body.includes('trojan://') && body.includes('xhttp')); assert.equal(new URL(body.split('\n')[0]).searchParams.get('path'), '/?ed=2048'); }
  }
});

test('主分支家宽开关保留，关闭时返回 403', async () => {
  const engine = createSubscriptionEngine({ ...fixture, jk: 'no' }, uuid);
  assert.equal((await engine.subscribe(new Request('https://worker.example/sub?target=vg'))).status, 403);
});

test('独立页面的订阅和 API 地址分离，脚本无语法错误', async () => {
  const engine = createSubscriptionEngine(fixture, uuid);
  const html = await (await engine.render(new Request('https://worker.example/' + uuid))).text();
  assert.ok(html.includes('window.CFNEW.subUrl') && html.includes('window.CFNEW.apiBase'));
  for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Function(script);
});

test('连接参数拒绝非 HTTPS、用户信息和带路径地址', () => {
  assert.equal(normalizeWorker('worker.example'), 'https://worker.example');
  for (const value of ['http://worker.example', 'https://user:pass@worker.example', 'https://worker.example/path', 'https://worker.example?token=one']) assert.throws(() => normalizeWorker(value));
});
