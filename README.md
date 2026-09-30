# 酷狗概念版每日 VIP · Loon

在已登录酷狗概念版的设备上，通过 Loon 捕获 App 请求中的登录凭证，再每天查询领取记录并领取当天概念版 VIP。无需扫码登录、服务器或公开的第三方 API。仅支持单账号；切换酷狗账号后，打开 App 重新捕获。

> 当前代码已通过本地模拟测试，尚未在真实酷狗账号和 Loon 设备上完成端到端验收。酷狗接口属于非公开接口，App 请求字段和活动资格会变化。

## 文件

| 文件 | 用途 |
| --- | --- |
| `kugou-concept-vip.plugin` | Loon 插件、动态 Cron 和 HTTPS 解密域名 |
| `capture.js` | 从酷狗请求的 Cookie、Authorization 或 URL 参数读取凭证，保存到 Loon 本地 |
| `claim.js` | 查询月度记录，确认未领后提交一次当天领取，并发出通知 |

使用 Loon 3.5.1 (983) 或更新版本。插件采用[新版 Script 语法](https://nsloon.app/docs/Script/script_v2/)；脚本使用 [Loon Script API](https://nsloon.app/docs/Script/script_api/)。

## 安装和首次验收

1. 在 Loon 的插件页面添加 `https://raw.githubusercontent.com/changeCat/kugou-concept-vip-loon/main/kugou-concept-vip.plugin`，并启用插件。也可以使用[插件导入 Scheme](https://nsloon.app/docs/Scheme/)。插件会自动下载两个脚本，无需单独导入。
2. 在 Loon 安装并信任 HTTPS 解密证书，确认插件的 `*.kugou.com` 域名已经参与 MitM。无需把证书或账号凭证写入仓库。
3. 保持 Loon 运行，打开已经登录的**酷狗概念版**，进入个人页面或 VIP 页面，等待“签到凭证已保存”通知。请求必须经过同一设备的 Loon；脚本只在同时取得有效 `token`、`userid` 和 `mid` 后保存。
4. 在 Loon 的脚本页面手动运行“手动核对并领取 VIP”，检查通知及酷狗 App 中当天的领取状态。首次执行可能直接领取当天权益；如果只想先验证抓取，请等当天已在 App 内领过后再手动执行。
5. 确认一次真实结果后，在插件参数中开启“启用自动领取”。默认 Cron 是设备本地时间每天 `01:10`，可以修改。启用前确认设备时区正确，且没有其他自动领取任务同时运行。

不需要每天重新获取 Cookie。打开酷狗 App 后，只要新请求携带了更新的 Token，捕获脚本就会覆盖本地凭证。若长期不打开 App 导致 Token 失效，需要再次打开 App；插件不会代替用户处理验证码。

## 领取规则

- 每次运行先请求 `/youth/v1/activity/get_month_vip_record`。已确认今天领取过时跳过。
- 仅在月度记录能够明确判断“今天未领取”时，对 `/youth/v1/recharge/receive_vip_listen_song` 发送一次 POST。只使用当天的默认领取流程，不传未来日期，不调用已失效的 `/youth/vip` 八次领取接口。
- 发出领取请求前先保存“结果待确认”状态。网络超时、业务失败或脚本中断后，当天后续运行只复查远端记录，不重复提交。
- 月度记录字段不认识、查询失败、凭证不完整时停止并通知。领取成功后保存当天成功状态。
- Token 和设备字段只保存在 Loon 的 `$persistentStore` 中；通知仅显示账号尾号或结果。不要公开 Loon 的脚本存储、抓包记录或包含凭证的配置。

## 验收时可能遇到的问题

| 现象 | 检查方式 |
| --- | --- |
| 打开 App 后没有“凭证已保存”通知 | 确认 Loon 正在处理该 App 的 HTTPS 请求、解密证书已信任、`*.kugou.com` 命中；App 如果没有在可见请求中同时发送必要字段，需要补充经过脱敏的请求字段名后调整捕获规则。 |
| “尚无完整凭证” | 手动打开概念版 App 并浏览个人或活动页面；目前必须从同一条请求或同一账号的已有记录得到 `mid`。 |
| “无法确认今天是否已领取” | 月度记录返回形状或错误码与脚本认识的格式不同。查看 Loon 运行状态；仅提供脱敏后的响应字段名和错误码来适配，勿贴 Token。 |
| “领取请求结果不明确” | 先到酷狗 App 查看权益。脚本为防止重复提交，不会在今天再次请求领取。 |
| 凭证保存了但接口仍拒绝 | 当前 Lite Android 参数配置与设备上的概念版登录态可能不兼容，需要结合脱敏后的错误码及实际请求参数校正，不应反复领取。 |

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
