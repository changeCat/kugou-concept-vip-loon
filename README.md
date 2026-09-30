# 酷狗概念版每日 VIP · Loon

在已登录酷狗概念版的设备上，通过 Loon 捕获 App 请求中的登录凭证，再每天查询领取记录并领取当天概念版 VIP。无需扫码登录、服务器或公开的第三方 API。仅支持单账号；切换酷狗账号后，打开 App 重新捕获。

> 当前凭证捕获已在真实 Loon 设备上验证；领取尚未完成端到端验收。实机月度记录查询曾返回 `51002`，具体原因待接口错误说明确认。酷狗接口属于非公开接口，App 请求字段和活动资格会变化。

## 文件

| 文件 | 用途 |
| --- | --- |
| `kugou-concept-vip.plugin` | Loon 插件、动态 Cron 和 HTTPS 解密域名 |
| `capture.js` | 从酷狗请求的 Cookie、Authorization 或 URL 参数读取凭证，保存到 Loon 本地 |
| `claim.js` | 查询月度记录，确认未领后提交一次当天领取，并发出通知 |
| `diagnose.js` | 手动检查请求是否命中及必要字段是否出现，不显示凭证值 |

使用 Loon 3.5.1 (983) 或更新版本。插件采用[新版 Script 语法](https://nsloon.app/docs/Script/script_v2/)；脚本使用 [Loon Script API](https://nsloon.app/docs/Script/script_api/)。

## 安装和首次验收

1. 在 Loon 的插件页面添加 `https://raw.githubusercontent.com/changeCat/kugou-concept-vip-loon/main/kugou-concept-vip.plugin`，并启用插件。也可以使用[插件导入 Scheme](https://nsloon.app/docs/Scheme/)。插件会自动下载脚本，无需单独导入。
2. 在 Loon 安装并信任 HTTPS 解密证书，确认插件的 `*.kugou.com` 域名已经参与 MitM。无需把证书或账号凭证写入仓库。
3. 先退出普通酷狗和酷狗畅听版，保持 Loon 运行及插件的“启用凭证捕获”开启，只打开已经登录的**酷狗概念版**，进入个人页面或 VIP 页面。随后手动运行 Loon 脚本“检查酷狗捕获状态”：它会显示最近命中的域名、请求中的 App ID 和必要字段是否出现，不显示字段值。当前规则只匹配 `gateway.kugou.com` 上 URL、Cookie 或 Authorization 含登录字段的请求；脚本只在取得有效 `token`、`userid` 和 `mid` 后保存。
4. 在 Loon 的脚本页面手动运行“手动核对并领取 VIP”，检查通知及酷狗 App 中当天的领取状态。首次执行可能直接领取当天权益；如果只想先验证抓取，请等当天已在 App 内领过后再手动执行。
5. 确认一次真实结果后，在插件参数中开启“启用自动领取”。默认 Cron 是设备本地时间每天 `01:10`，可以修改。启用前确认设备时区正确，且没有其他自动领取任务同时运行。

不需要每天重新获取 Cookie。打开酷狗 App 后，只要新请求携带了更新的 Token，捕获脚本就会覆盖本地凭证。若长期不打开 App 导致 Token 失效，需要再次打开 App；插件不会代替用户处理验证码。

进入 App 会发起多条请求，因此可能出现多条“酷狗凭证捕获”运行记录。记录数不等于保存次数，也不等于领取次数。保存凭证后可关闭“启用凭证捕获”，这不会删除凭证或关闭定时领取，但也不会继续更新 Token；需要刷新凭证时再开启。

## 领取规则

- 每次运行先请求 `/youth/v1/activity/get_month_vip_record`。已确认今天领取过时跳过。
- 仅在月度记录能够明确判断“今天未领取”时，对 `/youth/v1/recharge/receive_vip_listen_song` 发送一次 POST。只使用当天的默认领取流程，不传未来日期，不调用已失效的 `/youth/vip` 八次领取接口。
- 发出领取请求前先保存“结果待确认”状态。网络超时、业务失败或脚本中断后，当天后续运行只复查远端记录，不重复提交。
- 月度记录字段不认识、查询失败、凭证不完整时停止并通知。领取成功后保存当天成功状态。
- Token 和设备字段只保存在 Loon 的 `$persistentStore` 中；通知仅显示账号尾号或结果。不要公开 Loon 的脚本存储、抓包记录或包含凭证的配置。

## 验收时可能遇到的问题

| 现象 | 检查方式 |
| --- | --- |
| 打开 App 后没有“凭证已保存”通知 | 运行“检查酷狗捕获状态”。若没有命中请求，确认 Loon 正在处理概念版的 HTTPS 请求、脚本与 MitM 已启用、证书已信任；若已命中但字段不全，请只提供诊断通知中的域名、App ID 与字段有无，不要发送 Token、Cookie 或完整 URL。 |
| 手动运行“检查酷狗捕获状态”也没有通知 | 查看 Loon 的脚本运行日志。若脚本未运行，检查插件是否已更新并启用、脚本开关是否打开；若有日志但没有通知，检查 Loon 的系统通知权限。 |
| “尚无完整凭证” | 手动打开概念版 App 并浏览个人或活动页面；目前必须从同一条请求或同一账号的已有记录得到 `mid`。 |
| “无法确认今天是否已领取” | 月度记录返回形状或错误码与脚本认识的格式不同。查看 Loon 运行状态；仅提供脱敏后的响应字段名和错误码来适配，勿贴 Token。 |
| 记录接口返回 `51002` | 更新插件及远程脚本后，从插件的“手动核对并领取 VIP”入口运行一次。若保存来源为 `3114` 且含 clientver，脚本会追加一次只读参数对照：仅替换 appid/clientver，保留原签名算法、User-Agent 和设备字段，再查询月度记录。提供包含“只读参数对照”的日志即可。无论对照成功或失败都不领取、不修改领取状态；Cron 不做对照。错误码含义仍未确认。 |
| “领取请求结果不明确” | 先到酷狗 App 查看权益。脚本为防止重复提交，不会在今天再次请求领取。 |
| 凭证保存了但接口仍拒绝 | 当前 Lite Android 参数配置与设备上的概念版登录态可能不兼容，需要结合脱敏后的错误码及实际请求参数校正，不应反复领取。 |

捕获诊断中的“最近命中 App ID”属于最近一条请求；“已保存凭证来源 App ID”才与保存的凭证对应。旧凭证没有来源信息，更新脚本并重新打开 App 后补齐。领取请求仍使用参考项目的 Android Lite `appid=3116`，不会仅根据捕获到 `3114` 就假定两者共用签名规则。不同 App ID 或 Token 的请求不再借用旧设备字段拼接凭证。

只读参数对照是一项有限实验，不等于完整 iOS 请求适配。如果两套参数都返回 `51002`，不能据此断言 Token 已失效；还需核对 App 原始请求的签名协议、设备参数和登录态。不要反复运行相同实验。

通知关闭时，可在脚本日志查看领取结果；同时检查 Loon 内的脚本通知开关和系统通知权限。日志不输出完整响应、请求 URL、Token 或 Cookie。

## 本地测试

在项目根目录执行：

```powershell
node --test test/loon.test.cjs
```

测试使用模拟的 Loon API 和酷狗响应，验证凭证提取、签名、重复领取保护。它不会请求酷狗服务，也不能替代真实设备验收。

## 参考

- [EchoVIP-Headless](https://github.com/moos1110/EchoVIP-Headless)：固定设备身份、月度记录复核和不明确结果处理。
- [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)：Lite 领取和月度记录接口、Android 签名参数。接口代码为 MIT 许可；本项目只根据公开协议实现所需的最小脚本。
- [kgcheckin](https://github.com/develop202/kgcheckin)：酷狗签到的历史实现。其旧 `/youth/vip` 领取接口现已在 KuGouMusicApi 文档中标为不可用。
- [贴吧 Loon 签到插件](https://github.com/blackmatrix7/ios_rule_script/blob/master/script/tieba/tieba_signin.lnplugin)：请求捕获 + Cron + MitM 的插件结构。
