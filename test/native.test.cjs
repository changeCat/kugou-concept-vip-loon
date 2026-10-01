const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const project = path.resolve(__dirname, '..');
const nativeKey = 'kgcv.native.v1';
const stateKey = 'kgcv.claim.v1';
const recordPath = '/youth/v1/activity/get_month_vip_record';
const claimPath = '/youth/v1/recharge/receive_vip_listen_song';
const salt = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const identity = { appid: '3114', clientver: '12491', token: 'PRIVATE+TOKEN==', userid: '12345678', mid: 'PRIVATE-MID', dfid: 'PRIVATE-DFID', uuid: 'PRIVATE-UUID', srcappid: '2919' };
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function sign(params, body = '') {
  return crypto.createHash('md5').update(salt + Object.keys(params).map(k => `${k}=${params[k]}`).sort().join('') + body + salt).digest('hex');
}
function run(file, { data = new Map(), request, response, argument, replies = [] } = {}) {
  const calls = [], logs = [], notices = [];
  let done;
  const finished = new Promise(resolve => { done = resolve; });
  const http = method => (options, callback) => {
    calls.push({ method, options });
    const next = replies.shift();
    assert.ok(next, 'unexpected network request');
    queueMicrotask(() => callback(next.error, { status: 200 }, JSON.stringify(next.body)));
  };
  vm.runInNewContext(fs.readFileSync(path.join(project, file), 'utf8'), {
    $request: request, $response: response, $argument: argument,
    $persistentStore: { read: k => data.get(k), write: (v,k) => { data.set(k,v); return true; } },
    $httpClient: { get: http('GET'), post: http('POST') },
    $notification: { post: (...v) => notices.push(v) }, console: { log: v => logs.push(v) }, $done: done,
  });
  return { data, calls, logs, notices, finished };
}
function learn(data, kind = 'record', { extra = {}, body = '', status = 1, badSignature = false, person = identity, noBody = false } = {}) {
  const params = { ...person, clienttime: '1790820000', ...(kind === 'record' ? { latest_limit: '100' } : { source_id: '90139' }), ...extra };
  params.signature = badSignature ? '0'.repeat(32) : sign(params, body);
  return run('signature-check.js', {
    data,
    request: { method: kind === 'record' ? 'GET' : 'POST', headers: { 'User-Agent': 'iPhone-Test', 'Content-Type': 'application/json' },
      ...(noBody ? {} : { body }), url: 'https://gateway.kugou.com' + (kind === 'record' ? recordPath : claimPath) + '?' + new URLSearchParams(params) },
    response: { status: 200, body: JSON.stringify({ status, error_code: status === 1 ? 0 : 2006, data: {} }) },
  });
}
test('learned Web GET preserves full identity and re-signs a fresh query without claiming', async () => {
  const data = new Map();
  const capture = learn(data);
  await capture.finished;
  const native = JSON.parse(data.get(nativeKey));
  assert.deepEqual(native.identity, identity);
  assert.equal(native.record.algorithm, 'Web');
  assert.equal(native.record.params.signature, undefined);
  assert.equal(native.record.params.clienttime, undefined);
  const result = run('claim.js', { data, argument: 'query', replies: [{ body: { status: 1, data: { records: [] } } }] });
  await result.finished;
  assert.deepEqual(result.calls.map(c => c.method), ['GET']);
  const params = Object.fromEntries(new URL(result.calls[0].options.url).searchParams);
  const signature = params.signature; delete params.signature;
  for (const k of Object.keys(identity)) assert.equal(params[k], identity[k]);
  assert.equal(signature, sign(params));
  assert.notEqual(params.clienttime, '1790820000');
  assert.equal(result.calls[0].options.headers['User-Agent'], 'iPhone-Test');
  assert.equal(data.has(stateKey), false);
  assert.match(result.notices.at(-1)[2], /今天未领取/);
  const report = run('signature-check.js', { data });
  await report.finished;
  assert.equal(JSON.stringify([result.logs, result.notices, capture.logs, capture.notices, report.logs, report.notices]).includes('PRIVATE'), false);
});

test('a valid record template alone cannot authorize a POST', async () => {
  const data = new Map(); await learn(data).finished;
  const result = run('claim.js', { data, replies: [{ body: { status: 1, data: { records: [] } } }] });
  await result.finished;
  assert.equal(result.calls.length, 1);
  assert.equal(data.has(stateKey), false);
  assert.match(result.notices.at(-1)[2], /尚缺领取接口配置/);
});

test('only a verified POST template enables daily claim, including signed JSON body', async () => {
  const data = new Map(); await learn(data).finished;
  await learn(data, 'claim', { body: JSON.stringify({ source_id: 90139, receive_day: today }) }).finished;
  const native = JSON.parse(data.get(nativeKey));
  // Simulate tomorrow's run by making the saved day's body stale.
  native.claim.body = native.claim.body.replace(today, '2026-01-01');
  data.set(nativeKey, JSON.stringify(native));
  const result = run('claim.js', { data, replies: [{ body: { status: 1, data: { records: [] } } }, { body: { status: 1 } }] });
  await result.finished;
  assert.deepEqual(result.calls.map(c => c.method), ['GET','POST']);
  const post = result.calls[1].options;
  assert.equal(JSON.parse(post.body).receive_day, today);
  const params = Object.fromEntries(new URL(post.url).searchParams);
  const signature = params.signature; delete params.signature;
  assert.equal(signature, sign(params, post.body));
  assert.equal(JSON.parse(data.get(stateKey)).status, 'confirmed');
});

test('failed response, invalid signature, unknown fields and unavailable POST body never become templates', async () => {
  for (const options of [{ status: 0 }, { badSignature: true }, { extra: { unknown: 'value' } }, { noBody: true }]) {
    const data = new Map(); await learn(data).finished;
    await learn(data, 'claim', options).finished;
    assert.equal(JSON.parse(data.get(nativeKey)).claim, undefined);
  }
});

test('changing account/session invalidates the previous endpoint template', async () => {
  const data = new Map(); await learn(data).finished; await learn(data, 'claim').finished;
  await learn(data, 'record', { person: { ...identity, token: 'NEW-PRIVATE-TOKEN' } }).finished;
  assert.equal(JSON.parse(data.get(nativeKey)).claim, undefined);
});

test('query-only mode never claims even when both templates exist and today is unclaimed', async () => {
  const data = new Map(); await learn(data).finished; await learn(data, 'claim').finished;
  const result = run('claim.js', { data, argument: 'query', replies: [{ body: { status: 1, data: { records: [] } } }] });
  await result.finished;
  assert.deepEqual(result.calls.map(c => c.method), ['GET']);
  assert.equal(data.has(stateKey), false);
});

test('uncertain claim or different captured account prevents mutation', async () => {
  const data = new Map(); await learn(data).finished; await learn(data, 'claim').finished;
  data.set(stateKey, JSON.stringify({ userid: identity.userid, date: today, status: 'uncertain' }));
  const result = run('claim.js', { data, replies: [{ body: { status: 1, data: { records: [] } } }] });
  await result.finished;
  assert.equal(result.calls.length, 1);
  data.set('kgcv.auth.v1', JSON.stringify({ userid: '87654321' }));
  const other = run('claim.js', { data }); await other.finished;
  assert.equal(other.calls.length, 0);
  assert.match(other.notices.at(-1)[2], /不同账号/);
});

test('iOS credentials without learned parameters no longer use the failing Android probe', async () => {
  const data = new Map([['kgcv.auth.v1', JSON.stringify(identity)]]);
  const result = run('claim.js', { data, argument: 'manual' }); await result.finished;
  assert.equal(result.calls.length, 0);
  assert.match(result.notices.at(-1)[2], /不再尝试旧 Android 配置/);
});
