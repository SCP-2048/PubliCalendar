# 腾讯云 / 微信云开发版本

这一目录是与 `apps/api` 并行的国内版本后端。Cloudflare 与腾讯云版本使用独立数据库，因此邀请码不能跨版本使用。

## 首次配置

1. 在微信开发者工具中，以 AppID `wxf19a6538b1a4efd0` 开通云开发环境。
2. 使用环境 ID：`publicalendar-d6g6uxmuz4b418883`（已写入 `cloudbaserc.json` 与 `apps/client/.env.tencent`）。
3. 在 CloudBase 数据库控制台将以下集合的客户端读写权限设为 **仅云函数可读写**：
   - `schedules`
   - `schedule_date_ranges`
   - `participants`
   - `availability_ranges`
4. 为查询建立索引：
   - `schedules.code`
   - `schedules.expiresAt`
   - `schedule_date_ranges.scheduleId`
   - `participants.scheduleId`
   - `participants.scheduleId + tokenHash`
   - `availability_ranges.participantId`

集合会在首次成功调用云函数时自动创建。

## 构建与部署函数

本机若无全局 `pnpm`，用本地 CLI：

```powershell
cd apps\cloudbase
.\node_modules\.bin\tcb.CMD login --key
node .\scripts\build-function.mjs
.\node_modules\.bin\tcb.CMD fn deploy publicalendar -e publicalendar-d6g6uxmuz4b418883 --force --httpFn --yes
node .\scripts\create-collections.mjs
```

当前 HTTP API（已验证可创建活动）：

`https://publicalendar-d6g6uxmuz4b418883-1454834210.ap-shanghai.app.tcloudbase.com`

该地址已写入 `apps/client/.env.tencent` 的 `VITE_API_BASE_URL`。H5 与小程序均走 HTTP；小程序需把此域名加入 request 合法域名。

## 腾讯云前端构建

先复制 `apps/client/.env.tencent.example` 为 `.env.tencent`，填写真实配置：

```powershell
pnpm build:h5:tencent
pnpm build:mp-weixin:tencent
```

- H5 输出：`apps/client/dist/build/h5-tencent`
- 小程序输出：`apps/client/dist/build/mp-weixin-tencent`

CloudBase 静态托管发布 H5 后，默认域名适用于内测。无 ICP 备案时，不要将其当作正式面向公众的国内网站入口。
