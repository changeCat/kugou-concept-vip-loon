const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../signature-check.js'), 'utf8');
const key = 'kgcv.signature.v1';
function run(request, response, data = new Map(), argument) {
  const logs = [], notices = [], done = [];
  vm.runInNewContext(source, {
    $request: request, $response: response, $argument: argument,
    $persistentStore: { read: k => data.get(k), write: (v, k) => { data.set(k, v); return true; } },
    console: { log: v => logs.push(v) },
    $notification: { post: (...v) => notices.push(v) },
    $done: v => done.push(v),
    // No HTTP API is provided: a diagnostic must never send a request.
  });
  assert.equal(done.length, 1);
  assert.equal(JSON.stringify(done[0]), '{}');
  return { data, logs, notices };
}
function request(salt, extra = {}, literalPlus = false) {
  const params = { appid: '3114', clientver: '12491', token: 'PRIVATE+TOKEN==', userid: '12345678', mid: 'PRIVATE-MID', ...extra };
  const pairs = Object.keys(params).sort().map(k => `${k}=${params[k]}`);
  // The Web formula sorts whole key=value strings, including prefix keys.
  if (salt === 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt') pairs.sort();
  const signature = crypto.createHash('md5').update(salt + pairs.join('') + salt).digest('hex');
  let query = new URLSearchParams({ ...params, signature }).toString();
  if (literalPlus) query = query.replace('%2B', '+');
  return { method: 'GET', headers: {}, url: `https://gateway.kugou.com/youth/v1/activity/get_month_vip_record?${query}` };
}
const success = { status: 200, body: JSON.stringify({ status: 1, error_code: 0, data: { records: [] } }) };

test('matches all three known formulas locally and stores no raw credentials or response', () => {
  for (const [salt, label] of [
    ['LnT6xpN3khm36zse0QzvmgTZ3waWdRSA', 'Android Lite'],
    ['OIlwieks28dk2k092lksi2UIkp', 'Android 标准版'],
    ['NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt', 'Web'],
  ]) {
    const req = request(salt, { a: 'x', a0: 'y', 'PRIVATE-FIELD': 'PRIVATE-VALUE' });
    const captured = run(req, success);
    const saved = JSON.parse(captured.data.get(key));
    assert.match(saved.samples[0].matches.join(''), new RegExp(label));
    const report = run(undefined, undefined, captured.data);
    const output = JSON.stringify([Array.from(captured.data), report.logs, report.notices]);
    for (const secret of ['PRIVATE', '12345678', 'records', new URL(req.url).searchParams.get('signature')]) assert.equal(output.includes(secret), false);
    assert.equal(captured.notices.length, 0);
  }
});

test('detects literal plus encoding without changing original traffic', () => {
  const req = request('LnT6xpN3khm36zse0QzvmgTZ3waWdRSA', {}, true);
  const before = JSON.stringify(req);
  const result = run(req, success);
  const sample = JSON.parse(result.data.get(key)).samples[0];
  assert.deepEqual(sample.matches, ['Android Lite（加号保留）']);
  assert.equal(JSON.stringify(req), before);
});

test('unknown algorithm and failed business response are not trusted matches', () => {
  const result = run(request('UNKNOWN'), success);
  assert.match(JSON.parse(result.data.get(key)).samples[0].result, /未匹配公开算法/);
  const failed = run(request('LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'), {
    status: 200, body: JSON.stringify({ status: 0, error_code: 2006, msg: 'PRIVATE-ERROR' }),
  });
  assert.equal(JSON.parse(failed.data.get(key)).samples[0].matches.length, 0);
  assert.match(JSON.parse(failed.data.get(key)).samples[0].result, /未确认成功/);
});

test('rejects Android probes, POST requests and unrelated routes', () => {
  const req = request('UNKNOWN');
  for (const input of [
    { ...req, method: 'POST' },
    { ...req, url: req.url.replace('appid=3114', 'appid=3116') },
    { ...req, url: req.url.replace('/youth/', '/other/') },
  ]) assert.equal(run(input, success).data.has(key), false);
});

test('duplicate parameters are reported without inventing canonicalization', () => {
  const req = request('UNKNOWN');
  req.url += '&token=ANOTHER-PRIVATE-TOKEN';
  const result = run(req, success);
  assert.match(JSON.parse(result.data.get(key)).samples[0].result, /参数重复/);
  assert.equal(result.data.get(key).includes('PRIVATE'), false);
});

test('clear affects only summaries and empty report gives sampling instructions', () => {
  const data = new Map([['kgcv.auth.v1', 'PRIVATE-AUTH']]);
  run(request('UNKNOWN'), success, data);
  run(undefined, undefined, data, 'clear');
  assert.equal(data.get('kgcv.auth.v1'), 'PRIVATE-AUTH');
  assert.equal(JSON.parse(data.get(key)).samples.length, 0);
  assert.match(run(undefined, undefined, data).logs.join(''), /暂无样本/);
});
