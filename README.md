# PubliCalendar MVP

PubliCalendar 是一个无需注册的多人可用时间交集工具。创建者可以为活动添加多个不连续日期范围（整体跨度最长 100 年）并分享 8 位邀请码；参与者只能在这些日期内填写分钟级可用时段。服务端会合并重叠或相邻的活动日期范围，并先合并每个人的重叠时间，再计算所有已提交参与者的交集。

## 技术栈

- pnpm workspace monorepo
- `apps/client`：uni-app、Vue 3、TypeScript，可构建 H5 与微信小程序
- `apps/api`：Cloudflare Workers、Hono、D1
- `apps/cloudbase`：腾讯云 / 微信云开发函数与国内版本部署配置
- `packages/shared`：共享 Zod 校验、类型、区间 union/intersection 算法

## 两个部署版本

| 版本 | 面向用户 | 后端与数据 | 构建入口 |
| --- | --- | --- | --- |
| Cloudflare | 海外或可稳定访问 Cloudflare 的 Web 用户 | Worker + D1 | `pnpm deploy:cloudflare` |
| 腾讯云 / 微信云开发 | 中国大陆 Web 内测和微信小程序 | CloudBase 云函数 + 云数据库 | 见 `apps/cloudbase/README.md` |

两套后端数据库彼此独立，邀请码只能在创建它的版本内使用。

## 本地开发

需要 Node.js 20+。

### Windows 一键启动

双击项目根目录的 `start-local.cmd`。首次运行会自动安装依赖、初始化本地 D1 数据库，随后分别启动 API 和 Web 开发服务器，并在浏览器打开：

```text
http://127.0.0.1:5173
```

API 和 Web 会各自保留一个终端窗口；关闭这两个窗口即可停止本地网站。再次双击启动程序时，不会重复启动已经运行的服务。

### 手动启动

需要先安装 pnpm。

```powershell
pnpm install
pnpm --filter @publicalendar/api types
pnpm --filter @publicalendar/api exec wrangler d1 migrations apply publicalendar --local
pnpm dev:api
```

另开终端：

```powershell
pnpm dev:h5
```

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build:h5
pnpm build:mp-weixin
pnpm deploy:dry-run
```

## 部署前配置

1. 登录 Cloudflare：`pnpm --filter @publicalendar/api exec wrangler login`。
2. 创建 D1：`pnpm --filter @publicalendar/api exec wrangler d1 create publicalendar`，把返回的真实 `database_id` 加入 `apps/api/wrangler.jsonc` 的 D1 binding。
3. 应用远程迁移：`pnpm --filter @publicalendar/api exec wrangler d1 migrations apply publicalendar --remote`。
4. 运行 `pnpm run deploy:cloudflare`。该命令会先构建 H5，再由同一个 Worker 部署静态网站和 `/api/*` 接口；同域 Web 版本可将 `VITE_API_BASE_URL` 留空。
5. 构建小程序前，把 `VITE_API_BASE_URL` 设为 Worker 的完整 HTTPS 域名，在 `apps/client/src/manifest.json` 的 `mp-weixin.appid` 填写真实微信小程序 AppID，并在微信公众平台添加该域名为 request 合法域名。然后执行：

```powershell
$env:VITE_API_BASE_URL = "https://your-worker.workers.dev"
pnpm build:mp-weixin
```

用微信开发者工具导入 `apps/client/dist/build/mp-weixin`。

### 腾讯云 / 微信云开发版本

国内版本的云函数、数据库权限、环境变量与构建命令见 `apps/cloudbase/README.md`。小程序通过云函数调用，不依赖 `workers.dev`。

不要提交本地凭证。创建者和参与者 token 仅返回一次并保存在客户端本地；D1 只保存 SHA-256 摘要。日程至少保留到活动结束后 30 天，Cron 每日删除到期数据。

## API

- `POST /api/schedules`：以 `dateRanges` 创建日程；服务端重新校验并合并范围，同时保存整体 `startDate`/`endDate` 边界
- `GET /api/schedules/:code`：查询日程、合并后的 `dateRanges` 与参与者状态；迁移前旧数据会回退为整体边界范围
- `POST /api/schedules/:code/participants`：加入日程
- `GET /api/schedules/:code/availability`：Bearer 参与者 token，读取个人时间段
- `PUT /api/schedules/:code/availability`：Bearer 参与者 token，完整替换个人时间段
- `GET /api/schedules/:code/intersection`：读取交集，并返回已提交参与者的个人时段（供结果页时间轴）；有人尚未提交时不计算最终交集

`PUT availability` 会在服务端按活动时区检查每个时间段，任何落入日期范围空档的提交都会被拒绝。数据库迁移 `0002_schedule_date_ranges.sql` 新增活动日期子范围表；部署前请照常应用全部 D1 migrations。
