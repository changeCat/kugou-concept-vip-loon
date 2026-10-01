/* global $persistentStore, $notification, $done */
(function () {
  "use strict";
  function read(key) {
    try { return JSON.parse($persistentStore.read(key) || "null"); }
    catch (_) { return null; }
  }
  function flag(value) { return value ? "有" : "无"; }
  function sourceNumber(value) { return /^\d{1,8}$/.test(String(value || "")) ? String(value) : "未记录，需重新打开 App 捕获"; }

  var auth = read("kgcv.auth.v1");
  var native = read("kgcv.native.v1");
  var observation = read("kgcv.observe.v1");
  var lines = [];
  if (native && native.identity) {
    lines.push("App 已验签账号尾号 " + String(native.identity.userid || "").slice(-4) +
      "；月度查询配置 " + (native.record ? "已保存" : "未保存") + "；当天领取配置 " + (native.claim ? "已保存" : "未保存"));
  }
  if (auth && auth.userid && auth.token && auth.mid) {
    lines.push("已保存账号尾号 " + String(auth.userid).slice(-4));
    lines.push("已保存凭证来源 App ID " + sourceNumber(auth.appid) + "；clientver " + sourceNumber(auth.clientver));
  } else {
    lines.push("尚未保存完整凭证");
  }
  if (observation && observation.host) {
    var fields = observation.fields || {};
    var seen = observation.seen || {};
    var now = new Date();
    var today = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
    var dayLabel = observation.date === today ? "今日" : "上次记录日 " + observation.date;
    lines.push("最近命中 " + observation.host + "；App ID " + observation.appid + "；" + dayLabel);
    lines.push("最近请求字段：token " + flag(fields.token) + "、userid " + flag(fields.userid) + "、mid " + flag(fields.mid));
    lines.push("该日曾见字段：token " + flag(seen.token) + "、userid " + flag(seen.userid) + "、mid " + flag(seen.mid));
  } else {
    lines.push("尚未命中插件的 kugou.com 请求；检查 Loon 脚本、MitM、证书与请求记录。");
  }
  var message = lines.join("\n");
  console.log("酷狗捕获状态：" + lines.join("；"));
  $notification.post("酷狗概念版", "捕获状态检查", message);
  $done();
}());
