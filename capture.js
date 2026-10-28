/* global $request, $response, $persistentStore, $notification, $done, console */
// Verify locally; only learn allowlisted VIP endpoints after a successful signed response.
(function () {
  "use strict";
  var NATIVE_KEY = "kgcv.native.v1";
  var PROFILES = [
    { name: "Android Lite", salt: "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA" },
    { name: "Android 标准版", salt: "OIlwieks28dk2k092lksi2UIkp" },
    { name: "Web", salt: "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt", web: true }
  ];
  function localDay() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
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
  function capture() {
    var url = String($request.url || "");
    var route = /^https:\/\/gateway\.kugou\.com(\/youth\/v1\/(?:activity\/get_month_vip_record|recharge\/receive_vip_listen_song))(?:\?([^#]*))?$/i.exec(url);
    var method = String($request.method).toUpperCase();
    if (!route || url.length > 8192 || ["GET", "POST"].indexOf(method) < 0) return;
    if (Number($response.status) !== 200 || typeof $response.body !== "string" || $response.body.length >= 262144) return;
    var response = JSON.parse($response.body);
    if (!response || Number(response.status) !== 1 || Number(response.error_code || 0) !== 0 || Number(response.errcode || 0) !== 0) return;
    var query = parse(route[2] || "", true);
    if (query.appid !== "3114") return;
    var signature = query.signature || header("signature");
    var body = method === "GET" ? "" : typeof $request.body === "string" ? $request.body : header("content-length") === "0" ? "" : null;
    if (!/^[a-f0-9]{32}$/i.test(signature || "") || body === null || body.length > 16384) return;
    for (var f = 0; f < 2; f++) {
      var params = parse(route[2] || "", f === 0);
      delete params.signature;
      for (var p = 0; p < PROFILES.length; p++) {
        var profile = PROFILES[p];
        var pairs = Object.keys(params).sort().map(function (key) { return key + "=" + params[key]; });
        if (profile.web) pairs.sort();
        if (md5(profile.salt + pairs.join("") + body + profile.salt) === signature.toLowerCase()) {
          var result = learn(route[1], method, params, body, profile.name);
          if (result) console.log(result);
          return;
        }
      }
    }
  }
  function learn(path, method, params, body, algorithm) {
    var kind = path === "/youth/v1/activity/get_month_vip_record" && method === "GET" ? "record" :
      path === "/youth/v1/recharge/receive_vip_listen_song" && method === "POST" ? "claim" : "";
    if (!kind) return "";
    var common = ["appid", "clientver", "token", "userid", "mid", "dfid", "uuid", "srcappid"];
    var allowed = common.concat(["clienttime"], kind === "record" ? ["latest_limit"] : ["source_id", "receive_day"]);
    if (Object.keys(params).some(function (k) { return allowed.indexOf(k) < 0; })) return "存在未适配字段，未保存配置";
    if (params.appid !== "3114" || !/^\d{1,8}$/.test(params.clientver || "") ||
        !/^[^\s;&]{8,512}$/.test(params.token || "") || !/^[1-9]\d{0,19}$/.test(params.userid || "") ||
        !/^[A-Za-z0-9._~-]{6,128}$/.test(params.mid || "") || !/^[A-Za-z0-9._~-]{1,128}$/.test(params.dfid || "") ||
        !/^[A-Za-z0-9._~-]{1,128}$/.test(params.uuid || "") || !/^\d{1,8}$/.test(params.srcappid || "") ||
        !/^(?:\d{10}|\d{13})$/.test(params.clienttime || "")) return "必要字段不完整，未保存配置";
    if (params.latest_limit != null && !/^[1-9]\d{0,2}$/.test(params.latest_limit)) return "记录条数未适配";
    if (params.source_id != null && !/^\d{1,12}$/.test(params.source_id)) return "领取来源未适配";
    if (params.receive_day != null && params.receive_day !== localDay()) return "仅支持当天领取，未保存配置";
    // A nonempty POST body must be a known JSON object, never an opaque dynamic payload.
    if (body) {
      var payload;
      try { payload = JSON.parse(body); } catch (_) { return "请求体格式未适配，未保存配置"; }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          Object.keys(payload).some(function (k) { return ["source_id", "receive_day"].indexOf(k) < 0; }) ||
          (payload.source_id != null && !/^\d{1,12}$/.test(String(payload.source_id))) ||
          (payload.receive_day != null && payload.receive_day !== localDay())) return "请求体字段未适配，未保存配置";
    }
    var identity = {};
    common.forEach(function (k) { identity[k] = params[k]; });
    var previous;
    try { previous = JSON.parse($persistentStore.read(NATIVE_KEY) || "null"); } catch (_) { previous = null; }
    if (!previous || JSON.stringify(previous.identity) !== JSON.stringify(identity)) previous = { version: 1, identity: identity };
    var savedParams = {};
    Object.keys(params).forEach(function (k) { if (k !== "clienttime") savedParams[k] = params[k]; });
    var headers = {};
    var ua = header("user-agent");
    if (ua && ua.length <= 1024 && !/[\r\n]/.test(ua)) headers["User-Agent"] = ua;
    var contentType = header("content-type");
    if (/^application\/(?:json|x-www-form-urlencoded)(?:;[^\r\n]*)?$/i.test(contentType)) headers["Content-Type"] = contentType;
    var hadConfig = !!previous[kind];
    previous[kind] = { method: method, path: path, algorithm: algorithm, params: savedParams, body: body,
      timeUnit: params.clienttime.length === 13 ? "ms" : "s", headers: headers, verifiedAt: new Date().toISOString() };
    if (!$persistentStore.write(JSON.stringify(previous), NATIVE_KEY)) return "配置保存失败";
    $persistentStore.write(JSON.stringify(identity), "kgcv.auth.v1");
    if (!hadConfig) $notification.post("酷狗概念版", "签到配置已保存", kind === "record" ? "月度记录查询配置已保存，请关闭配置捕获并手动领取 VIP。" : "当天领取配置已保存，仍需验证脚本请求。");
    return kind === "record" ? "月度查询配置已保存" : "当天领取配置已保存";
  }
  try {
    if (typeof $request !== "undefined" && $request && typeof $response !== "undefined" && $response) capture();
  } catch (_) {
    console.log("配置捕获未完成；未输出原始请求数据。");
  }
  $done({});
}());
