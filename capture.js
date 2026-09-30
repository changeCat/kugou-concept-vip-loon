/* global $request, $persistentStore, $notification, $done */
// Only the minimum credentials needed by claim.js are stored; never log a request.
(function () {
  "use strict";
  var STORE_KEY = "kgcv.auth.v1";
  var url = $request && $request.url || "";
  if (!/^https:\/\/(?:[a-z0-9-]+\.)*kugou\.com\//i.test(url)) {
    $done({});
    return;
  }

  function header(name) {
    var headers = $request.headers || {};
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name.toLowerCase()) return String(headers[keys[i]]);
    }
    return "";
  }
  function pairs(value, formEncoded) {
    var result = {};
    String(value || "").split(/[;&]/).forEach(function (part) {
      var at = part.indexOf("=");
      if (at < 0) return;
      var key = part.slice(0, at).trim().toLowerCase();
      var val = part.slice(at + 1).trim();
      try { val = decodeURIComponent(formEncoded ? val.replace(/\+/g, "%20") : val); } catch (_) { /* retain raw */ }
      if (key && val) result[key] = val;
    });
    return result;
  }
  function readStore() {
    try { return JSON.parse($persistentStore.read(STORE_KEY) || "null") || {}; }
    catch (_) { return {}; }
  }
  var query = url.indexOf("?") < 0 ? {} : pairs(url.slice(url.indexOf("?") + 1), true);
  var cookie = pairs(header("cookie"), false);
  var authorization = pairs(header("authorization").replace(/^\s*(?:bearer|token)\s+/i, ""), false);
  var source = Object.assign({}, cookie, authorization, query);
  var token = source.token || source.clienttoken || "";
  var userid = source.userid || source.kugouid || "";
  if (!/^[^\s;&]{8,512}$/.test(token) || !/^\d{1,20}$/.test(userid) || userid === "0") {
    $done({});
    return;
  }

  var previous = readStore();
  var sameUser = previous.userid === userid;
  var mid = source.mid || source.kugou_api_mid || header("mid") || (sameUser && previous.mid) || "";
  var dfid = source.dfid || header("dfid") || (sameUser && previous.dfid) || "-";
  var device = {
    userid: userid,
    token: token,
    mid: mid,
    dfid: dfid,
    capturedAt: new Date().toISOString()
  };
  if (!/^[A-Za-z0-9._~-]{6,128}$/.test(mid) || !/^[A-Za-z0-9._~-]{1,128}$/.test(dfid)) {
    $done({});
    return;
  }
  if (sameUser && previous.token === token && previous.mid === mid && previous.dfid === dfid) {
    $done({});
    return;
  }
  if ($persistentStore.write(JSON.stringify(device), STORE_KEY)) {
    $notification.post("酷狗概念版", "签到凭证已保存", "账号尾号 " + userid.slice(-4) + "，可先手动运行领取脚本核对。");
  }
  $done({});
}());
