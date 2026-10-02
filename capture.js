/* global $request, $persistentStore, $notification, $done */
// Store only required credentials and a separate field-presence summary; never log request data.
(function () {
  "use strict";
  var STORE_KEY = "kgcv.auth.v1";
  var OBSERVE_KEY = "kgcv.observe.v1";
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
  function readStore(key) {
    try { return JSON.parse($persistentStore.read(key) || "null") || {}; }
    catch (_) { return {}; }
  }
  var query = url.indexOf("?") < 0 ? {} : pairs(url.slice(url.indexOf("?") + 1), true);
  var cookie = pairs(header("cookie"), false);
  var authorization = pairs(header("authorization").replace(/^\s*(?:bearer|token)\s+/i, ""), false);
  var source = Object.assign({}, cookie, authorization, query);
  var token = source.token || source.clienttoken || "";
  var userid = source.userid || source.kugouid || "";
  var requestMid = source.mid || source.kugou_api_mid || header("mid") || "";
  var requestDfid = source.dfid || header("dfid") || "";
  var requestAppid = source.appid || header("appid") || "";
  var requestClientver = source.clientver || header("clientver") || "";
  var match = /^https:\/\/([^/]+)/i.exec(url);
  var now = new Date();
  var date = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
  var previousObservation = readStore(OBSERVE_KEY);
  var sameDay = previousObservation.date === date;
  var fields = {
    token: /^[^\s;&]{8,512}$/.test(token),
    userid: /^\d{1,20}$/.test(userid) && userid !== "0",
    mid: /^[A-Za-z0-9._~-]{6,128}$/.test(requestMid)
  };
  var appid = /^\d{1,8}$/.test(String(requestAppid)) ? String(requestAppid) : "未知";
  var observation = {
    date: date,
    lastSeenAt: now.toISOString(),
    host: match ? match[1].toLowerCase() : "",
    appid: appid,
    fields: fields,
    seen: {
      token: fields.token || (sameDay && previousObservation.seen && previousObservation.seen.token) || false,
      userid: fields.userid || (sameDay && previousObservation.seen && previousObservation.seen.userid) || false,
      mid: fields.mid || (sameDay && previousObservation.seen && previousObservation.seen.mid) || false
    }
  };
  var changed = !sameDay || previousObservation.host !== observation.host ||
    previousObservation.appid !== appid ||
    JSON.stringify(previousObservation.fields) !== JSON.stringify(fields) ||
    JSON.stringify(previousObservation.seen) !== JSON.stringify(observation.seen);
  if (changed || now.getTime() - Date.parse(previousObservation.lastSeenAt || 0) > 30000) {
    $persistentStore.write(JSON.stringify(observation), OBSERVE_KEY);
  }
  // Shared KuGou domains also carry other clients' sessions. Unknown provenance
  // is diagnostic evidence only; it must never replace Concept credentials.
  if (appid !== "3114" || !fields.token || !fields.userid) {
    $done({});
    return;
  }

  var previous = readStore(STORE_KEY);
  var sameUser = previous.userid === userid;
  // Sharing a userid does not make credentials from different apps interchangeable.
  var sameSession = sameUser && previous.token === token &&
    (appid === "未知" || !previous.appid || previous.appid === appid) &&
    (!requestMid || previous.mid === requestMid);
  var mid = requestMid || (sameSession && previous.mid) || "";
  var dfid = requestDfid || (sameSession && previous.dfid) || "-";
  var savedAppid = appid !== "未知" ? appid : (sameSession && previous.appid) || "";
  var clientver = /^\d{1,8}$/.test(requestClientver) ? requestClientver : (sameSession && previous.clientver) || "";
  var device = {
    userid: userid,
    token: token,
    mid: mid,
    dfid: dfid,
    appid: savedAppid,
    clientver: clientver,
    capturedAt: new Date().toISOString()
  };
  if (!/^[A-Za-z0-9._~-]{6,128}$/.test(mid) || !/^[A-Za-z0-9._~-]{1,128}$/.test(dfid)) {
    $done({});
    return;
  }
  if (sameUser && previous.token === token && previous.mid === mid && previous.dfid === dfid &&
      previous.appid === savedAppid && previous.clientver === clientver) {
    $done({});
    return;
  }
  if ($persistentStore.write(JSON.stringify(device), STORE_KEY)) {
    $notification.post("酷狗概念版", "签到凭证已保存", "账号尾号 " + userid.slice(-4) + "，可先手动运行领取脚本核对。");
  }
  $done({});
}());
