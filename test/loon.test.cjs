const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const project = path.resolve(__dirname, '..');
const authKey = 'kgcv.auth.v1';
const stateKey = 'kgcv.claim.v1';
const auth = { userid: '12345678', token: 'TOKEN-123456789', mid: 'MID123456', dfid: '-' };
const day = new Date();
const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

function execute(file, { initial = {}, request, replies = [] } = {}) {
  const data = new Map(Object.entries(initial));
  const notices = [];
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
    console,
  }, { filename: file });
  return { finished, data, notices, calls };
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
