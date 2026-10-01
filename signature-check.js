/* global $request, $response, $argument, $persistentStore, $notification, $done, console */
// Compare public signature formulas locally. No network calls or credential snapshots.
(function () {
  "use strict";
  var KEY = "kgcv.signature.v1";
  var PROFILES = [
    { name: "Android Lite", salt: "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA" },
    { name: "Android 标准版", salt: "OIlwieks28dk2k092lksi2UIkp" },
    { name: "Web", salt: "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt", web: true }
  ];
  function read() {
    try { return JSON.parse($persistentStore.read(KEY) || "null") || { samples: [] }; }
    catch (_) { return { samples: [] }; }
  }
  function number(value) { return /^\d{1,8}$/.test(String(value || "")) ? String(value) : "未知"; }
  function header(name) {
    var headers = $request.headers || {};
    var key = Object.keys(headers).filter(function (k) { return k.toLowerCase() === name; })[0];
    return key ? String(headers[key]) : "";
  }
  function parse(query, form) {
    var result = Object.create(null);
    var parts = query.split("&");
    if (parts.length > 100) throw new Error("query");
    parts.forEach(function (part) {
      if (!part) return;
      var index = part.indexOf("=");
      var key = index < 0 ? part : part.slice(0, index);
      var value = index < 0 ? "" : part.slice(index + 1);
      key = decodeURIComponent(form ? key.replace(/\+/g, " ") : key);
      value = decodeURIComponent(form ? value.replace(/\+/g, " ") : value);
      if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error("duplicate");
      result[key] = value;
    });
    return result;
  }
  function md5(input) {
    var bytes = [];
    for (var p = 0; p < input.length; p++) {
      var cp = input.charCodeAt(p);
      if (cp >= 0xd800 && cp <= 0xdbff && p + 1 < input.length) {
        var next = input.charCodeAt(p + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + next - 0xdc00; p++; }
      }
      if (cp < 0x80) bytes.push(cp);
      else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    var bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var n = 0; n < 8; n++) bytes.push(Math.floor(bitLength / Math.pow(2, n * 8)) & 255);
    var shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    var h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for (var offset = 0; offset < bytes.length; offset += 64) {
      var words = [];
      for (var w = 0; w < 16; w++) {
        var at = offset + w * 4;
        words[w] = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);
      }
      var a = h[0], b = h[1], c = h[2], d = h[3];
      for (var i = 0; i < 64; i++) {
        var f, g, shift;
        if (i < 16) { f = (b & c) | (~b & d); g = i; shift = shifts[i % 4]; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; shift = shifts[4 + i % 4]; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; shift = shifts[8 + i % 4]; }
        else { f = c ^ (b | ~d); g = (7 * i) % 16; shift = shifts[12 + i % 4]; }
        var sum = (a + f + Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) + words[g]) >>> 0;
        var rotated = (sum << shift) | (sum >>> (32 - shift));
        a = d; d = c; c = b; b = (b + rotated) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0;
      h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0;
      h[3] = (h[3] + d) >>> 0;
    }
    return h.map(function (word) {
      var hex = "";
      for (var i = 0; i < 4; i++) hex += ("0" + ((word >>> (i * 8)) & 255).toString(16)).slice(-2);
      return hex;
    }).join("");
  }
  function inspect() {
    var url = String($request.url || "");
    var route = /^https:\/\/gateway\.kugou\.com(\/youth\/[^?#]*)(?:\?([^#]*))?$/i.exec(url);
    if (!route || url.length > 8192 || String($request.method).toUpperCase() !== "GET") return;
    var sample = { time: new Date().toISOString(), appid: "未知", clientver: "未知", signature: "未找到", result: "未校验", matches: [], fields: [] };
    // Only fixed route labels are stored; never persist arbitrary URL paths or parameter names.
    sample.endpoint = route[1] === "/youth/v1/activity/get_month_vip_record" ? "月度领取记录" : "其他 youth 活动接口";
    var response = null;
    try {
      if (typeof $response.body === "string" && $response.body.length < 262144) response = JSON.parse($response.body);
    } catch (_) { /* report unknown response, never print body */ }
    var success = Number($response.status) === 200 && response && Number(response.status) === 1 &&
      Number(response.error_code || 0) === 0 && Number(response.errcode || 0) === 0;
    sample.response = success ? "业务成功" : "业务未确认成功";
    sample.errorCode = response && /^\d{1,8}$/.test(String(response.error_code)) ? Number(response.error_code) : null;
    var query;
    try { query = parse(route[2] || "", true); }
    catch (_) {
      if (/(?:^|&)appid=3114(?:&|$)/.test(route[2] || "")) {
        sample.appid = "3114";
        sample.result = "参数重复或编码无法解析，跳过";
        save(sample);
      }
      return;
    }
    sample.appid = number(query.appid || header("appid"));
    sample.clientver = number(query.clientver || header("clientver"));
    // Exclude our Android probes and other client identities from native iOS evidence.
    if (sample.appid !== "3114") return;
    var fieldNames = ["appid", "clientver", "clienttime", "token", "userid", "mid", "dfid", "uuid", "plat", "platform", "srcappid", "signature", "sign", "key", "latest_limit"];
    sample.fields = fieldNames.filter(function (key) { return Object.prototype.hasOwnProperty.call(query, key); });
    sample.otherFieldCount = Object.keys(query).filter(function (key) { return fieldNames.indexOf(key) < 0; }).length;
    var signature = query.signature || header("signature");
    sample.signature = query.signature ? "URL 参数" : header("signature") ? "请求头" : "未找到";
    if (!/^[a-f0-9]{32}$/i.test(signature || "")) sample.result = "未找到可比较的 32 位 signature";
    else if (!success) sample.result = "App 响应未确认成功，不作为有效签名样本";
    else {
      [true, false].forEach(function (form) {
        var params = parse(route[2] || "", form);
        delete params.signature;
        PROFILES.forEach(function (profile) {
          var pairs = Object.keys(params).sort().map(function (key) { return key + "=" + params[key]; });
          if (profile.web) pairs.sort();
          if (md5(profile.salt + pairs.join("") + profile.salt) === signature.toLowerCase()) {
            var label = profile.name + (form ? "（加号作空格）" : "（加号保留）");
            sample.matches.push(label);
          }
        });
      });
      sample.result = sample.matches.length ? "已匹配公开算法（仅此 GET 样本）" : "未匹配公开算法（仅校验 URL 参数）";
    }
    save(sample);
  }
  function save(sample) {
    var data = read();
    var list = Array.isArray(data.samples) ? data.samples : [];
    // Keep up to four distinct outcomes so a later failed request cannot hide a successful sample.
    list = list.filter(function (old) {
      return old.endpoint !== sample.endpoint || old.appid !== sample.appid || old.result !== sample.result;
    });
    list.push(sample);
    $persistentStore.write(JSON.stringify({ samples: list.slice(-4) }), KEY);
  }
  function report() {
    var data = read();
    var lines = ["仅在手机本地比对，未发送接口请求，未领取。"];
    (data.samples || []).forEach(function (s) {
      lines.push(s.time + "；" + s.endpoint + "；appid=" + s.appid + "；clientver=" + s.clientver);
      lines.push(s.response + "；错误码=" + s.errorCode + "；signature位置=" + s.signature);
      lines.push("URL 字段：" + s.fields.join(", ") + "；其他字段数=" + (s.otherFieldCount || 0));
      lines.push(s.result + (s.matches.length ? "：" + s.matches.join("、") : ""));
    });
    if (!(data.samples || []).length) lines.push("暂无样本。开启临时签名诊断，只打开概念版 VIP/活动页面，再关闭开关。需命中 appid=3114 的 youth GET 请求；也请检查是否被其他响应脚本优先匹配。");
    lines.push("此结果不能单独证明已支持定时领取；不匹配也不能单独认定密钥不同。");
    var message = lines.join("\n");
    console.log(message);
    $notification.post("酷狗概念版", "App 签名本地核对", message);
  }
  try {
    if (typeof $request !== "undefined" && typeof $response !== "undefined") inspect();
    else if (typeof $argument !== "undefined" && $argument === "clear") {
      var cleared = $persistentStore.write(JSON.stringify({ samples: [] }), KEY);
      $notification.post("酷狗概念版", "签名诊断", cleared ? "已清除诊断摘要，账号凭证未变。" : "清除诊断摘要失败。");
    } else report();
  } catch (_) {
    // Do not echo exceptions: they can contain URL or response data.
    console.log("签名本地核对未完成；未输出原始请求数据。");
  }
  $done({});
}());
