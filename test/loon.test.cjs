const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const project = path.resolve(__dirname, '..');
const authKey = 'kgcv.auth.v1';
const stateKey = 'kgcv.claim.v1';
const observeKey = 'kgcv.observe.v1';
const auth = { userid: '12345678', token: 'TOKEN-123456789', mid: 'MID123456', dfid: '-' };
const day = new Date();
const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

function execute(file, { initial = {}, request, replies = [] } = {}) {
  const data = new Map(Object.entries(initial));
  const notices = [];
  const logs = [];
  const calls = [];
  let done;
  const finished = new Promise(resolve => { done = resolve; });
  const client = method => (options, callback) => {
    calls.push({ method, options });
    const next = replies.shift();
    if (!next) throw new Error('Unexpected HTTP request');
    queueMicrotask(() => callback(next.error || null, { status: next.httpStatus || 200 }, JSON.stringify(next.body || {})));
  };
  vm.runInNewContext(fs.readFileSync(path.join(project, file), 'utf8'), {
    $request: request,
    $persistentStore: {
      read: key => data.get(key) || null,
      write: (value, key) => { data.set(key, value); return true; },
    },
    $notification: { post: (...args) => notices.push(args) },
    $httpClient: { get: client('GET'), post: client('POST') },
    $done: () => done(),
    console: { log: (...args) => logs.push(args.join(' ')) },
  }, { filename: file });
  return { finished, data, notices, calls, logs };
}

test('captures an authenticated request without copying unrelated headers', async () => {
  const result = execute('capture.js', {
    request: {
      url: 'https://gateway.kugou.com/youth/v1/activity/get_month_vip_record?mid=MID123456&dfid=-',
      headers: { Cookie: 'userid=12345678; token=TOKEN-123456789; other=private' },
    },
  });
  await result.finished;
  const saved = JSON.parse(result.data.get(authKey));
  assert.equal(saved.userid, auth.userid);
  assert.equal(saved.token, auth.token);
  assert.equal(saved.mid, auth.mid);
  assert.equal(saved.other, undefined);
  assert.equal(result.notices.length, 1);
});

test('accepts encoded token characters from the URL', async () => {
  const result = execute('capture.js', {
    request: {
      url: 'https://gateway.kugou.com/test?userid=12345678&token=TOKEN%2B123456%3D%3D&mid=MID123456',
      headers: {},
    },
  });
  await result.finished;
  assert.equal(JSON.parse(result.data.get(authKey)).token, 'TOKEN+123456==');
});

test('refreshes provenance for existing credentials without guessing a signing profile', async () => {
  const result = execute('capture.js', {
    initial: { [authKey]: JSON.stringify(auth) },
    request: {
      url: 'https://gateway.kugou.com/test?appid=3114&clientver=12345&userid=12345678&token=TOKEN-123456789&mid=MID123456',
      headers: {},
    },
  });
  await result.finished;
  const saved = JSON.parse(result.data.get(authKey));
  assert.equal(saved.appid, '3114');
  assert.equal(saved.clientver, '12345');
  const diagnosis = execute('diagnose.js', { initial: Object.fromEntries(result.data) });
  await diagnosis.finished;
  assert.match(diagnosis.logs.join(''), /已保存凭证来源 App ID 3114/);
});

test('does not reuse another app or token device fields for the same user', async () => {
  for (const query of ['appid=1005&token=TOKEN-123456789', 'appid=3114&token=DIFFERENT-TOKEN']) {
    const old = { ...auth, appid: '3114' };
    const result = execute('capture.js', {
      initial: { [authKey]: JSON.stringify(old) },
      request: { url: `https://gateway.kugou.com/test?userid=12345678&${query}`, headers: {} },
    });
    await result.finished;
    assert.deepEqual(JSON.parse(result.data.get(authKey)), old);
  }
});

test('record error 51002 logs useful redacted details and never claims', async () => {
  const credentials = { ...auth, appid: '3114', clientver: '12345' };
  const result = execute('claim.js', {
    initial: { [authKey]: JSON.stringify(credentials) },
    replies: [{ body: { status: 0, error_code: 51002,
      msg: `签名校验失败 token=${auth.token} userid=${auth.userid} mid=${auth.mid} https://gateway.kugou.com/?token=HIDDEN-TOKEN`,
    } }],
  });
  await result.finished;
  assert.deepEqual(result.calls.map(call => call.method), ['GET']);
  assert.equal(result.data.has(stateKey), false);
  const output = JSON.stringify([result.notices, result.logs]);
  assert.match(output, /51002/);
  assert.match(output, /签名校验失败/);
  assert.match(output, /凭证来源 appid=3114/);
  for (const secret of [auth.token, auth.userid, auth.mid, 'HIDDEN-TOKEN']) assert.equal(output.includes(secret), false);
});

test('missing business error code is reported as unknown rather than zero', async () => {
  const result = execute('claim.js', {
    initial: { [authKey]: JSON.stringify(auth) },
    replies: [{ body: { status: 0 } }],
  });
  await result.finished;
  assert.match(result.logs.join(''), /错误码=null/);
  assert.equal(result.calls.length, 1);
});

test('diagnoses a matched request with missing mid without exposing credentials', async () => {
  const result = execute('capture.js', {
    request: {
      url: 'https://gateway.kugou.com/test?appid=3116&userid=12345678&token=TOKEN-123456789',
      headers: {},
    },
  });
  await result.finished;
  assert.equal(result.data.has(authKey), false);
  const observation = JSON.parse(result.data.get(observeKey));
  assert.equal(observation.host, 'gateway.kugou.com');
  assert.equal(observation.appid, '3116');
  assert.equal(observation.fields.token, true);
  assert.equal(observation.fields.mid, false);
  assert.equal(JSON.stringify(observation).includes('TOKEN-123456789'), false);

  const diagnosis = execute('diagnose.js', { initial: Object.fromEntries(result.data) });
  await diagnosis.finished;
  assert.match(diagnosis.notices[0][2], /mid 无/);
  assert.equal(diagnosis.logs.join('').includes('TOKEN-123456789'), false);
});

test('diagnoses when no KuGou request has reached the capture script', async () => {
  const diagnosis = execute('diagnose.js');
  await diagnosis.finished;
  assert.match(diagnosis.notices[0][2], /尚未命中插件的 kugou\.com 请求/);
});

test('checks remote record, signs both requests, and claims once', async () => {
  const result = execute('claim.js', {
    initial: { [authKey]: JSON.stringify(auth) },
    replies: [
      { body: { status: 1, error_code: 0, data: { records: [{ receive_day: '2026-01-01' }] } } },
      { body: { status: 1, error_code: 0, data: { ad_vip_num: 1 } } },
    ],
  });
  await result.finished;
  assert.deepEqual(result.calls.map(call => call.method), ['GET', 'POST']);
  for (const call of result.calls) {
    const url = new URL(call.options.url);
    const params = Object.fromEntries(url.searchParams);
    const signature = params.signature;
    delete params.signature;
    const text = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('');
    const salt = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
    assert.equal(signature, crypto.createHash('md5').update(salt + text + salt).digest('hex'));
    assert.equal(call.options.insecure, false);
  }
  assert.equal(JSON.parse(result.data.get(stateKey)).status, 'confirmed');
});

test('skips claim when today is present in remote record', async () => {
  const result = execute('claim.js', {
    initial: { [authKey]: JSON.stringify(auth) },
    replies: [{ body: { status: 1, error_code: 0, data: { list: [{ receive_day: today }] } } }],
  });
  await result.finished;
  assert.equal(result.calls.length, 1);
  assert.equal(JSON.parse(result.data.get(stateKey)).status, 'confirmed');
});

test('an uncertain earlier claim is never automatically repeated', async () => {
  const result = execute('claim.js', {
    initial: {
      [authKey]: JSON.stringify(auth),
      [stateKey]: JSON.stringify({ userid: auth.userid, date: today, status: 'uncertain' }),
    },
    replies: [{ body: { status: 1, error_code: 0, data: { list: [] } } }],
  });
  await result.finished;
  assert.equal(result.calls.length, 1);
  assert.match(result.notices[0][2], /不重复提交/);
});

test('does not claim when a changed record shape cannot prove today is unclaimed', async () => {
  const result = execute('claim.js', {
    initial: { [authKey]: JSON.stringify(auth) },
    replies: [{ body: { status: 1, error_code: 0, data: { tips: [], claimed_days: 3 } } }],
  });
  await result.finished;
  assert.equal(result.calls.length, 1);
  assert.equal(result.data.has(stateKey), false);
  assert.match(result.notices[0][2], /无法确认/);
});
