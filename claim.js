/* global $httpClient, $persistentStore, $notification, $done */
(function () {
  "use strict";
  var AUTH_KEY = "kgcv.auth.v1";
  var STATE_KEY = "kgcv.claim.v1";
  var SALT = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA";
  var BASE_URL = "https://gateway.kugou.com";
  var APP_ID = "3116";
  var CLIENT_VERSION = "11440";
  var USER_AGENT = "Android15-1070-" + CLIENT_VERSION + "-46-0-ReportPlaySongToServerProtocol-wifi";

  function read(key) {
    try { return JSON.parse($persistentStore.read(key) || "null"); }
    catch (_) { return null; }
  }
  function write(key, value) {
    if (!$persistentStore.write(JSON.stringify(value), key)) throw new Error("本地状态保存失败");
  }
  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function notify(message) {
    $notification.post("酷狗概念版每日 VIP", todayLocal(), message);
  }

  // RFC 1321 MD5, used for KuGou Lite's Android request signature.
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

  function signedRequest(method, path, extra, auth) {
    var clienttime = String(Math.floor(Date.now() / 1000));
    var params = {
      dfid: auth.dfid, mid: auth.mid, uuid: "-", appid: APP_ID,
      clientver: CLIENT_VERSION, clienttime: clienttime,
      token: auth.token, userid: auth.userid
    };
    Object.keys(extra).forEach(function (key) { params[key] = String(extra[key]); });
    var toSign = Object.keys(params).sort().map(function (key) { return key + "=" + params[key]; }).join("");
    params.signature = md5(SALT + toSign + SALT);
    var query = Object.keys(params).map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
    }).join("&");
    var options = {
      url: BASE_URL + path + "?" + query,
      timeout: 15000,
      insecure: false,
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        dfid: auth.dfid, mid: auth.mid, clienttime: clienttime,
        "kg-rc": "1", "kg-thash": "5d816a0", "kg-rec": "1",
        "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F"
      }
    };
    return new Promise(function (resolve, reject) {
      $httpClient[method](options, function (error, response, data) {
        if (error || !response || Number(response.status) !== 200) { reject(new Error("网络或 HTTP 请求失败")); return; }
        try { resolve(JSON.parse(String(data))); }
        catch (_) { reject(new Error("酷狗返回了无法解析的数据")); }
      });
    });
  }
  function ok(value) { return value && Number(value.status) === 1 && Number(value.error_code || 0) === 0; }
  function code(value) {
    var n = Number(value && (value.error_code || value.errcode));
    return Number.isFinite(n) ? n : null;
  }
  function dateOf(item) {
    if (typeof item === "string") {
      var direct = item.match(/^\d{4}-\d{2}-\d{2}/);
      return direct ? direct[0] : null;
    }
    if (!item || typeof item !== "object") return null;
    var keys = ["receive_day", "receive_date", "claim_date", "day", "date", "receive_time", "claim_time"];
    for (var i = 0; i < keys.length; i++) {
      if (item[keys[i]] != null) {
        var found = String(item[keys[i]]).match(/^\d{4}-\d{2}-\d{2}/);
        if (found) return found[0];
      }
    }
    return null;
  }
  function recordState(value, today) {
    if (!ok(value)) return "unknown";
    var data = value.data;
    if (!data || typeof data !== "object") return "unknown";
    var arrays = [];
    var stack = [data];
    var examined = 0;
    while (stack.length && examined++ < 40) {
      var current = stack.pop();
      if (Array.isArray(current)) { arrays.push(current); continue; }
      if (!current || typeof current !== "object") continue;
      Object.keys(current).forEach(function (key) {
        if (Array.isArray(current[key])) {
          if (/^(list|lists|items|records|record_list|record_lists|vip_records|receive_days|days|month_records)$/i.test(key)) stack.push(current[key]);
        } else if (current[key] && typeof current[key] === "object") stack.push(current[key]);
      });
    }
    var dates = [];
    arrays.forEach(function (list) { list.forEach(function (item) { var date = dateOf(item); if (date) dates.push(date); }); });
    if (dates.indexOf(today) >= 0) return "claimed";
    if (dates.length > 0) return "unclaimed";
    var count = [data.claimed_days, data.total, data.count, data.vip_num].filter(function (v) { return v != null; });
    if (count.length && count.every(function (v) { return Number(v) === 0; })) return "unclaimed";
    if (arrays.length && arrays.every(function (list) { return list.length === 0; })) return "unclaimed";
    return "unknown";
  }

  async function run() {
    var auth = read(AUTH_KEY);
    if (!auth || !/^\d{1,20}$/.test(auth.userid || "") ||
        !/^[^\s;&]{8,512}$/.test(auth.token || "") ||
        !/^[A-Za-z0-9._~-]{6,128}$/.test(auth.mid || "") ||
        !/^[A-Za-z0-9._~-]{1,128}$/.test(auth.dfid || "")) {
      notify("尚无完整凭证。请在 Loon 启用 HTTPS 解密后打开已登录的酷狗概念版。");
      return;
    }
    var today = todayLocal();
    var state = read(STATE_KEY);
    if (state && state.userid === auth.userid && state.date === today && state.status === "confirmed") {
      notify("今天已确认领取，跳过重复请求。");
      return;
    }
    var record;
    try { record = await signedRequest("get", "/youth/v1/activity/get_month_vip_record", { latest_limit: "100" }, auth); }
    catch (_) { notify("月度领取记录查询失败，本次未发起领取。"); return; }
    var before = recordState(record, today);
    if (before === "claimed") {
      write(STATE_KEY, { userid: auth.userid, date: today, status: "confirmed" });
      notify("远端记录显示今天已领取。");
      return;
    }
    if (before === "unknown") {
      notify("无法确认今天是否已领取，本次未发起领取。记录接口错误码：" + String(code(record)));
      return;
    }
    if (state && state.userid === auth.userid && state.date === today && state.status === "uncertain") {
      notify("今天的领取请求结果曾不明确；远端尚未确认，不重复提交。");
      return;
    }
    // Persist before sending: a timeout or killed script must not trigger a second claim.
    write(STATE_KEY, { userid: auth.userid, date: today, status: "uncertain" });
    var claim;
    try { claim = await signedRequest("post", "/youth/v1/recharge/receive_vip_listen_song", { source_id: "90139" }, auth); }
    catch (_) { notify("领取请求结果不明确。下次仅核对远端记录，不会重复提交。"); return; }
    if (ok(claim)) {
      write(STATE_KEY, { userid: auth.userid, date: today, status: "confirmed" });
      notify("当天 VIP 领取请求成功。");
      return;
    }
    notify("领取未确认，错误码：" + String(code(claim)) + "。今天不会重复提交。");
  }
  run().catch(function (_) { notify("脚本执行异常，请查看 Loon 状态；今天不会自动重试领取。"); })
    .then(function () { $done(); });
}());
