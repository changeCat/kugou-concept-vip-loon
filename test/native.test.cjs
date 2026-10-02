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
function run(file, { data = new Map(), request, response, argument, replies = [], onRequest } = {}) {
  const calls = [], logs = [], notices = [];
  let done;
  const finished = new Promise(resolve => { done = resolve; });
  const http = method => (options, callback) => {
    calls.push({ method, options });
    if (onRequest) onRequest(method, options);
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
  data.set('kgcv.auth.v1', JSON.stringify({ userid: '87654321', appid: '3114' }));
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

test('legacy caches from another or unidentified client do not block the verified Concept session', async () => {
  for (const appid of ['1005', '3116', '9999', '']) {
    const data = new Map(); await learn(data).finished; await learn(data, 'claim').finished;
    const before = data.get(nativeKey);
    data.set('kgcv.auth.v1', JSON.stringify({ userid: '87654321', appid, token: 'OTHER-PRIVATE-TOKEN' }));
    const result = run('claim.js', { data, replies: [{ body: { status: 1, data: { records: [] } } }, { body: { status: 1 } }] });
    await result.finished;
    assert.deepEqual(result.calls.map(c => c.method), ['GET', 'POST']);
    for (const call of result.calls) {
      const params = new URL(call.options.url).searchParams;
      assert.equal(params.get('userid'), identity.userid);
      assert.equal(params.get('token'), identity.token);
      assert.equal(params.get('appid'), '3114');
    }
    assert.equal(data.get(nativeKey), before);
  }
});

test('manual Web trial saves a configuration only after success, then cron can reuse it', async () => {
  const data = new Map(); await learn(data).finished;
  const result = run('claim.js', { data, argument: 'web_trial',
    replies: [{ body: { status: 1, data: { records: [] } } }, { body: { status: 1, error_code: 0 } }],
    onRequest(method) {
      if (method === 'POST') {
        assert.equal(JSON.parse(data.get(stateKey)).status, 'uncertain');
        assert.equal(JSON.parse(data.get(nativeKey)).claim, undefined);
      }
    }
  });
  await result.finished;
  assert.deepEqual(result.calls.map(c => c.method), ['GET', 'POST']);
  const post = result.calls[1].options;
  const params = Object.fromEntries(new URL(post.url).searchParams);
  const signature = params.signature; delete params.signature;
  assert.equal(signature, sign(params, post.body));
  for (const key of Object.keys(identity)) assert.equal(params[key], identity[key]);
  assert.equal(params.latest_limit, undefined);
  assert.equal(params.source_id, '90139');
  assert.equal(params.receive_day, today);
  assert.equal(post.body, '');
  assert.equal(post.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(JSON.parse(data.get(nativeKey)).claim.source, 'web_trial');
  assert.equal(JSON.parse(data.get(stateKey)).status, 'confirmed');
  assert.match(result.notices.at(-1)[2], /领取配置已保存/);
  assert.equal(JSON.stringify([result.logs, result.notices]).includes('PRIVATE'), false);

  // A later day's cron run updates the saved date and needs no experimental argument.
  data.set(stateKey, JSON.stringify({ userid: identity.userid, date: '2000-01-01', status: 'confirmed' }));
  const saved = JSON.parse(data.get(nativeKey));
  saved.claim.params.receive_day = '2000-01-01'; data.set(nativeKey, JSON.stringify(saved));
  const cron = run('claim.js', { data, replies: [{ body: { status: 1, data: { records: [] } } }, { body: { status: 1 } }] });
  await cron.finished;
  assert.deepEqual(cron.calls.map(c => c.method), ['GET', 'POST']);
  assert.equal(new URL(cron.calls[1].options.url).searchParams.get('receive_day'), today);
});

test('Web trial stops when today is claimed, record is unknown or query fails', async () => {
  for (const reply of [
    { body: { status: 1, data: { records: [{ receive_day: today }] } } },
    { body: { status: 1, data: { unknown: true } } },
    { body: { status: 0, error_code: 2006 } },
    { error: 'timeout' }
  ]) {
    const data = new Map(); await learn(data).finished;
    const result = run('claim.js', { data, argument: 'web_trial', replies: [reply] });
    await result.finished;
    assert.deepEqual(result.calls.map(c => c.method), ['GET']);
    assert.equal(JSON.parse(data.get(nativeKey)).claim, undefined);
  }
});

test('failed or timed out Web trial is not learned and cannot be submitted again that day', async () => {
  for (const reply of [{ error: 'timeout' }, { body: { status: 0, error_code: 2006, msg: 'err signature PRIVATE+TOKEN==' } }]) {
    const data = new Map(); await learn(data).finished;
    const result = run('claim.js', { data, argument: 'web_trial', replies: [{ body: { status: 1, data: { records: [] } } }, reply] });
    await result.finished;
    assert.deepEqual(result.calls.map(c => c.method), ['GET', 'POST']);
    assert.equal(JSON.parse(data.get(nativeKey)).claim, undefined);
    assert.equal(JSON.parse(data.get(stateKey)).status, 'uncertain');
    assert.equal(JSON.stringify([result.logs, result.notices]).includes('PRIVATE'), false);
    const again = run('claim.js', { data, argument: 'web_trial', replies: [{ body: { status: 1, data: { records: [] } } }] });
    await again.finished;
    assert.deepEqual(again.calls.map(c => c.method), ['GET']);
  }
});

test('Web trial requires learned Web parameters and cron never creates a candidate', async () => {
  const missing = run('claim.js', { argument: 'web_trial', data: new Map([['kgcv.auth.v1', JSON.stringify({ ...identity, appid: '3116' })]]) });
  await missing.finished; assert.equal(missing.calls.length, 0);
  for (const argument of [undefined, 'manual', 'query']) {
    const data = new Map(); await learn(data).finished;
    const result = run('claim.js', { data, argument, replies: [{ body: { status: 1, data: { records: [] } } }] });
    await result.finished;
    assert.deepEqual(result.calls.map(c => c.method), ['GET']);
    assert.equal(data.has(stateKey), false);
    assert.equal(JSON.parse(data.get(nativeKey)).claim, undefined);
  }
});

test('successful Web trial does not overwrite a changed session', async () => {
  const data = new Map(); await learn(data).finished;
  const result = run('claim.js', { data, argument: 'web_trial',
    replies: [{ body: { status: 1, data: { records: [] } } }, { body: { status: 1 } }],
    onRequest(method) {
      if (method === 'POST') {
        const newer = JSON.parse(data.get(nativeKey)); newer.identity.token = 'NEW-PRIVATE-TOKEN';
        data.set(nativeKey, JSON.stringify(newer));
      }
    }
  });
  await result.finished;
  assert.equal(JSON.parse(data.get(nativeKey)).identity.token, 'NEW-PRIVATE-TOKEN');
  assert.equal(JSON.parse(data.get(nativeKey)).claim, undefined);
  assert.match(result.notices.at(-1)[2], /会话已改变/);
});

test('overlapping queries see the pending mutation before submitting another claim', async () => {
  const data = new Map(); await learn(data).finished;
  const replies = () => [{ body: { status: 1, data: { records: [] } } }, { body: { status: 1 } }];
  const first = run('claim.js', { data, argument: 'web_trial', replies: replies() });
  const second = run('claim.js', { data, argument: 'web_trial', replies: replies() });
  await Promise.all([first.finished, second.finished]);
  assert.equal([...first.calls, ...second.calls].filter(c => c.method === 'POST').length, 1);
});

function startupRequest(changes = {}) {
  const params = { appid: identity.appid, userid: identity.userid, mid: identity.mid, token: 'NEW+PRIVATE-TOKEN==', ...changes };
  return { url: 'https://gateway.kugou.com/user/v1/info?' + new URLSearchParams(params), headers: {} };
}

test('ordinary App request refreshes token only after Web query succeeds and preserves claim template', async () => {
  const data = new Map(); await learn(data).finished; await learn(data, 'claim').finished;
  data.set(stateKey, JSON.stringify({ userid: identity.userid, date: today, status: 'uncertain' }));
  const stateBefore = data.get(stateKey);
  const oldNative = JSON.parse(data.get(nativeKey));
  const result = run('claim.js', { data, request: startupRequest(), argument: 'refresh',
    replies: [{ body: { status: 1, error_code: 0, data: { records: [] } } }],
    onRequest() { assert.equal(JSON.parse(data.get(nativeKey)).identity.token, identity.token); }
  });
  await result.finished;
  assert.deepEqual(result.calls.map(c => c.method), ['GET']);
  const params = Object.fromEntries(new URL(result.calls[0].options.url).searchParams);
  const signature = params.signature; delete params.signature;
  assert.equal(signature, sign(params));
  assert.equal(params.token, 'NEW+PRIVATE-TOKEN==');
  const saved = JSON.parse(data.get(nativeKey));
  for (const key of Object.keys(identity).filter(k => k !== 'token')) assert.equal(saved.identity[key], identity[key]);
  assert.equal(saved.record.params.token, params.token);
  assert.equal(saved.claim.params.token, params.token);
  assert.equal(saved.claim.algorithm, oldNative.claim.algorithm);
  assert.equal(saved.claim.body, oldNative.claim.body);
  assert.equal(data.get(stateKey), stateBefore);
  assert.equal(JSON.parse(data.get('kgcv.refresh.v1')).status, 'updated');
  assert.equal(result.notices.length, 1);
  assert.equal(JSON.stringify([result.notices, result.logs]).includes('PRIVATE'), false);
  const again = run('claim.js', { data, request: startupRequest(), argument: 'refresh' });
  await again.finished; assert.equal(again.calls.length, 0); assert.equal(again.notices.length, 0);
  // Query mode now uses the updated credential; refresh never grants a duplicate claim.
  const query = run('claim.js', { data, argument: 'query', replies: [{ body: { status: 1, data: { records: [] } } }] });
  await query.finished;
  assert.equal(new URL(query.calls[0].options.url).searchParams.get('token'), params.token);
});

test('refresh rejects unchanged tokens, other apps/accounts/devices, missing identity and script endpoints', async () => {
  const cases = [startupRequest({ token: identity.token }), startupRequest({ appid: '1005' }),
    startupRequest({ userid: '87654321' }), startupRequest({ mid: 'OTHER-DEVICE' }), startupRequest({ mid: '' }),
    startupRequest({ appid: '' }), startupRequest({ token: 'short' })];
  for (const endpoint of [recordPath, claimPath]) cases.push({ ...startupRequest(), url: startupRequest().url.replace('/user/v1/info', endpoint) });
  for (const request of cases) {
    const data = new Map(); await learn(data).finished; await learn(data, 'claim').finished;
    const before = data.get(nativeKey);
    const result = run('claim.js', { data, request, argument: 'refresh' }); await result.finished;
    assert.equal(result.calls.length, 0); assert.equal(data.get(nativeKey), before); assert.equal(result.notices.length, 0);
  }
});

test('refresh reads authorization fields and case-insensitive App and device headers', async () => {
  const data = new Map(); await learn(data).finished;
  const request = { url: 'https://gateway.kugou.com/user/v1/info', headers: {
    APPID: '3114', MID: identity.mid, Authorization: 'userid=' + identity.userid + '; token=NEW+PRIVATE-TOKEN=='
  } };
  const result = run('claim.js', { data, request, argument: 'refresh', replies: [{ body: { status: 1 } }] });
  await result.finished;
  assert.equal(JSON.parse(data.get(nativeKey)).identity.token, 'NEW+PRIVATE-TOKEN==');
});

test('failed refresh preserves working configuration and throttles startup bursts', async () => {
  for (const reply of [{ error: 'timeout' }, { body: { status: 0, error_code: 2006 } }]) {
    const data = new Map(); await learn(data).finished; await learn(data, 'claim').finished;
    const before = data.get(nativeKey);
    const result = run('claim.js', { data, request: startupRequest(), argument: 'refresh', replies: [reply] });
    const concurrent = run('claim.js', { data, request: startupRequest(), argument: 'refresh' });
    await Promise.all([result.finished, concurrent.finished]);
    assert.deepEqual(result.calls.map(c => c.method), ['GET']); assert.equal(concurrent.calls.length, 0);
    assert.equal(data.get(nativeKey), before); assert.equal(result.notices.length, 0);
    const again = run('claim.js', { data, request: startupRequest(), argument: 'refresh' });
    await again.finished; assert.equal(again.calls.length, 0);
  }
});

test('refresh cannot overwrite concurrent configuration changes', async () => {
  const data = new Map(); await learn(data).finished;
  let newer;
  const result = run('claim.js', { data, request: startupRequest(), argument: 'refresh', replies: [{ body: { status: 1 } }],
    onRequest() {
      newer = JSON.parse(data.get(nativeKey)); newer.identity.token = 'OTHER-PRIVATE-TOKEN';
      data.set(nativeKey, JSON.stringify(newer));
    }
  });
  await result.finished;
  assert.equal(data.get(nativeKey), JSON.stringify(newer));
  assert.equal(JSON.parse(data.get('kgcv.refresh.v1')).status, 'changed');
});
