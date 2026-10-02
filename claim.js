/* global $httpClient, $persistentStore, $notification, $done, $argument, console */
(function () {
  "use strict";
  var AUTH_KEY = "kgcv.auth.v1";
  var NATIVE_KEY = "kgcv.native.v1";
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
    console.log("酷狗每日 VIP：" + message);
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
  function ok(value) { return value && Number(value.status) === 1 && Number(value.error_code || 0) === 0 && Number(value.errcode || 0) === 0; }
  function code(value) {
    var raw = value && (value.error_code != null ? value.error_code : value.errcode);
    if (raw == null || raw === "") return null;
    var n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  function safeMessage(value, auth) {
    if (!value || typeof value !== "object") return "未提供错误说明";
    var raw = value.error_msg || value.errmsg || value.msg || value.message || value.error;
    if (typeof raw !== "string") return "未提供错误说明";
    // Error text can echo request parameters. Never print the raw response or URL.
    Object.keys(auth).forEach(function (key) {
      if (key === "appid" || key === "clientver" || key === "capturedAt") return;
      var secret = String(auth[key] || "");
      if (secret.length < 3) return;
      raw = raw.split(secret).join("[已隐藏]");
      raw = raw.split(encodeURIComponent(secret)).join("[已隐藏]");
    });
    return raw.replace(/https?:\/\/[^\s<>"']+/gi, "[链接已隐藏]")
      .replace(/\b(?:token|clienttoken|userid|kugouid|mid|dfid|cookie|authorization|signature)\b\s*[=:]\s*[^\s,;]+/gi, "[字段已隐藏]")
      .replace(/[A-Za-z0-9_%+./=~-]{24,}/g, "[长字段已隐藏]")
      .replace(/\d{5,}/g, "[数字已隐藏]")
      .replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 180) || "未提供错误说明";
  }
  function failureDetail(value, auth) {
    var status = value && value.status;
    var safeStatus = /^(?:0|1)$/.test(String(status)) ? String(status) : "未知";
    return "status=" + safeStatus + "，错误码=" + String(code(value)) + "，说明：" + safeMessage(value, auth);
  }
  function sourceNumber(value) { return /^\d{1,8}$/.test(String(value || "")) ? String(value) : "未记录"; }
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

  function nativeRequest(config, kind, identity, today) {
    var path = kind === "record" ? "/youth/v1/activity/get_month_vip_record" : "/youth/v1/recharge/receive_vip_listen_song";
    var method = kind === "record" ? "GET" : "POST";
    var salts = { Web: "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt", "Android Lite": SALT, "Android 标准版": "OIlwieks28dk2k092lksi2UIkp" };
    var salt = config && salts[config.algorithm];
    if (!config || config.path !== path || config.method !== method || !salt || !config.params ||
        !["s", "ms"].includes(config.timeUnit)) throw new Error("配置无效");
    var fields = ["appid", "clientver", "token", "userid", "mid", "dfid", "uuid", "srcappid"];
    if (fields.some(function (k) { return config.params[k] !== identity[k]; })) throw new Error("配置身份不同");
    var allowed = fields.concat(kind === "record" ? ["latest_limit"] : ["source_id", "receive_day"]);
    if (Object.keys(config.params).some(function (k) { return allowed.indexOf(k) < 0; })) throw new Error("配置字段无效");
    var params = Object.assign({}, config.params);
    params.clienttime = String(config.timeUnit === "ms" ? Date.now() : Math.floor(Date.now() / 1000));
    if (params.receive_day != null) params.receive_day = today;
    var body = config.body || "";
    if (kind === "record" && body) throw new Error("GET 请求体无效");
    if (body) {
      var payload = JSON.parse(body);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          Object.keys(payload).some(function (k) { return ["source_id", "receive_day"].indexOf(k) < 0; })) throw new Error("请求体字段无效");
      // Preserve the captured body byte-for-byte unless the explicit day needs changing.
      if (payload.receive_day != null) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.receive_day)) throw new Error("日期无效");
        body = body.replace(/("receive_day"\s*:\s*")\d{4}-\d{2}-\d{2}("\s*[,}])/, function (_, prefix, suffix) { return prefix + today + suffix; });
      }
    }
    var pairs = Object.keys(params).sort().map(function (k) { return k + "=" + params[k]; });
    if (config.algorithm === "Web") pairs.sort();
    params.signature = md5(salt + pairs.join("") + body + salt);
    var headers = {};
    ["User-Agent", "Content-Type"].forEach(function (k) { if (config.headers && config.headers[k]) headers[k] = config.headers[k]; });
    var options = { url: BASE_URL + path + "?" + Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&"), headers: headers, timeout: 15000, insecure: false };
    if (method === "POST") options.body = body;
    return new Promise(function (resolve, reject) {
      $httpClient[method.toLowerCase()](options, function (error, response, data) {
        if (error || !response || Number(response.status) !== 200) { reject(new Error("请求失败")); return; }
        try { resolve(JSON.parse(String(data))); } catch (_) { reject(new Error("响应格式无效")); }
      });
    });
  }
  async function runNative(native) {
    var auth = native.identity;
    if (!auth || auth.appid !== "3114" || !/^[1-9]\d{0,19}$/.test(auth.userid || "") ||
        !/^[^\s;&]{8,512}$/.test(auth.token || "") || !/^[A-Za-z0-9._~-]{6,128}$/.test(auth.mid || "") ||
        !/^[A-Za-z0-9._~-]{1,128}$/.test(auth.dfid || "") || !/^[A-Za-z0-9._~-]{1,128}$/.test(auth.uuid || "") ||
        !/^\d{1,8}$/.test(auth.srcappid || "") || !/^\d{1,8}$/.test(auth.clientver || "")) {
      notify("已保存的 App 接口配置不完整，请重新开启临时签名诊断并打开 VIP 记录页面。"); return;
    }
    if (!native.record) { notify("尚未保存月度查询配置，请开启临时签名诊断并打开 VIP 记录页面。"); return; }
    var current = read(AUTH_KEY);
    if (current && current.userid && current.userid !== auth.userid) {
      notify("普通捕获与已验签接口属于不同账号，请只打开目标账号的 VIP 记录页面重新学习接口。"); return;
    }
    var today = todayLocal();
    var queryOnly = typeof $argument !== "undefined" && $argument === "query";
    var webTrial = typeof $argument !== "undefined" && $argument === "web_trial";
    var state = read(STATE_KEY);
    if (!queryOnly && state && state.userid === auth.userid && state.date === today && state.status === "confirmed") {
      notify("今天已确认领取，跳过重复请求。"); return;
    }
    console.log("使用 App 已验签配置：月度查询=" + native.record.algorithm + "；appid=" + auth.appid + "；clientver=" + auth.clientver +
      "；uuid/srcappid 已保留；领取配置=" + (native.claim ? "已保存" : "尚未保存"));
    var record;
    try { record = await nativeRequest(native.record, "record", auth, today); }
    catch (_) { notify("App 配置的月度记录查询失败，本次未领取。"); return; }
    var before = recordState(record, today);
    if (before === "unknown") {
      notify(ok(record) ? "App 配置查询成功，但记录结构尚未识别，本次未领取。" : "App 配置查询被拒绝：" + failureDetail(record, auth)); return;
    }
    if (queryOnly) { notify("App 配置查询成功：" + (before === "claimed" ? "今天已领取" : "今天未领取") + "。本次仅查询。"); return; }
    if (before === "claimed") {
      write(STATE_KEY, { userid: auth.userid, date: today, status: "confirmed" }); notify("远端记录显示今天已领取。"); return;
    }
    // Re-read after the asynchronous query so overlapping runs see a pending claim.
    state = read(STATE_KEY);
    if (state && state.userid === auth.userid && state.date === today && state.status === "uncertain") {
      notify("今天的领取结果曾不明确，不重复提交。"); return;
    }
    if (state && state.userid === auth.userid && state.date === today && state.status === "confirmed") {
      notify("今天已确认领取，跳过重复请求。"); return;
    }
    var claimConfig = native.claim;
    var tryingWeb = !claimConfig && webTrial;
    if (tryingWeb) {
      if (native.record.algorithm !== "Web") {
        notify("测试 Web 领取需要已保存的 Web 月度查询配置，本次未领取。"); return;
      }
      // Compatibility trial, not a learned native App signature. Only persist on success.
      claimConfig = {
        method: "POST", path: "/youth/v1/recharge/receive_vip_listen_song", algorithm: "Web",
        params: Object.assign({}, auth, { source_id: "90139", receive_day: today }),
        body: "", timeUnit: native.record.timeUnit,
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, source: "web_trial"
      };
      if (native.record.headers && native.record.headers["User-Agent"]) claimConfig.headers["User-Agent"] = native.record.headers["User-Agent"];
      console.log("手动测试 Web 领取：查询已确认今天未领取；使用已保存的同一会话，仅提交一次。领取接口是否接受此签名尚待验证。");
    }
    if (!claimConfig) {
      notify("App 配置查询成功：今天未领取。尚缺领取接口配置，可手动运行“测试 Web 领取（当天一次）”验证；本次未提交领取。"); return;
    }
    write(STATE_KEY, { userid: auth.userid, date: today, status: "uncertain" });
    var result;
    try { result = await nativeRequest(claimConfig, "claim", auth, today); }
    catch (_) { notify("领取请求未确认。今天仅复查远端记录，不重复提交。"); return; }
    if (ok(result)) {
      write(STATE_KEY, { userid: auth.userid, date: today, status: "confirmed" });
      if (tryingWeb) {
        var latest = read(NATIVE_KEY);
        var fields = ["appid", "clientver", "token", "userid", "mid", "dfid", "uuid", "srcappid"];
        if (!latest || latest.version !== 1 || !latest.identity || fields.some(function (k) { return latest.identity[k] !== auth[k]; })) {
          notify("Web 领取请求成功，但本地会话已改变，未保存领取配置。请核对当前账号配置。"); return;
        }
        if (!latest.claim) {
          claimConfig.verifiedAt = new Date().toISOString();
          latest.claim = claimConfig;
          try { write(NATIVE_KEY, latest); }
          catch (_) { notify("Web 领取请求成功，但领取配置保存失败，暂不能开启自动领取。"); return; }
        }
        notify("Web 领取请求成功，领取配置已保存。可开启自动领取，之后每天使用此配置。"); return;
      }
      notify("当天 VIP 领取请求成功。");
    } else notify("领取未确认：" + failureDetail(result, auth) + "。今天不会重复提交。");
  }

  async function run() {
    var native = read(NATIVE_KEY);
    if (native && native.version === 1) { await runNative(native); return; }
    if (typeof $argument !== "undefined" && $argument === "web_trial") {
      notify("测试 Web 领取需要先保存 Web 月度查询配置；请开启临时签名诊断并打开 VIP 记录页面。"); return;
    }
    var auth = read(AUTH_KEY);
    if (!auth || !/^\d{1,20}$/.test(auth.userid || "") ||
        !/^[^\s;&]{8,512}$/.test(auth.token || "") ||
        !/^[A-Za-z0-9._~-]{6,128}$/.test(auth.mid || "") ||
        !/^[A-Za-z0-9._~-]{1,128}$/.test(auth.dfid || "")) {
      notify("尚无完整凭证。请在 Loon 启用 HTTPS 解密后打开已登录的酷狗概念版。");
      return;
    }
    var today = todayLocal();
    if (auth.appid === "3114") {
      notify("已确定月度查询使用 Web 签名。请开启临时签名诊断并打开 VIP 记录页面，保存实际 uuid/srcappid 后再运行；不再尝试旧 Android 配置。"); return;
    }
    var state = read(STATE_KEY);
    if (state && state.userid === auth.userid && state.date === today && state.status === "confirmed") {
      notify("今天已确认领取，跳过重复请求。");
      return;
    }
    var record;
    console.log("请求配置：Android Lite appid=" + APP_ID + "，clientver=" + CLIENT_VERSION +
      "；凭证来源 appid=" + sourceNumber(auth.appid) + "，clientver=" + sourceNumber(auth.clientver));
    try { record = await signedRequest("get", "/youth/v1/activity/get_month_vip_record", { latest_limit: "100" }, auth); }
    catch (_) { notify("月度领取记录查询失败，本次未发起领取。"); return; }
    var before = recordState(record, today);
    if (typeof $argument !== "undefined" && $argument === "query") {
      notify(before === "unknown" ? "记录查询未确认：" + failureDetail(record, auth) : "记录查询成功：" + (before === "claimed" ? "今天已领取" : "今天未领取") + "。本次仅查询。"); return;
    }
    if (before === "claimed") {
      write(STATE_KEY, { userid: auth.userid, date: today, status: "confirmed" });
      notify("远端记录显示今天已领取。");
      return;
    }
    if (before === "unknown") {
      notify("无法确认今天是否已领取，本次未发起领取。记录接口：" + failureDetail(record, auth));
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
    notify("领取未确认，" + failureDetail(claim, auth) + "。今天不会重复提交。");
  }
  run().catch(function (_) { notify("脚本执行异常，请查看 Loon 状态；今天不会自动重试领取。"); })
    .then(function () { $done(); });
}());
