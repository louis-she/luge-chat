# 线上 Supabase（生产）

- **域名**：`https://api.luge.chat`
- **服务器**：`ssh luge@luge.chat`（免密）
- **部署路径**：`~/supabase-project`
- **反代**：Caddy 容器（80/443 → Kong 网关）

---

## 日常命令

在服务器上：

```bash
cd ~/supabase-project

sh run.sh status          # 容器健康状态
sh run.sh start           # 启动（up -d --wait）
sh run.sh stop            # 停止
sh run.sh restart         # 重启整套
sh run.sh restart kong    # 只重启某个服务
sh run.sh logs            # 全部日志
sh run.sh logs db         # 指定服务
sh run.sh secrets         # 查看 .env 里的密钥（勿外泄）
sh run.sh pull            # 拉取新镜像
```

---

## 更新 Supabase 版本

1. 备份数据（至少 `volumes/db/data`）
2. 从 [supabase/supabase](https://github.com/supabase/supabase) 同步 `docker/` 目录变更
3. `sh run.sh pull`
4. `sh run.sh recreate` 或按官方 changelog 逐步 recreate 单个服务
5. 验证 `sh run.sh status` 全部 healthy

详见官方：[Self-Hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)

---

## Edge Functions

| 函数 | 用途 |
|------|------|
| `sandbox-auth` | 开发沙盒（已弃用，可保留） |
| `wechat-auth` | 微信 OAuth 换票 + 用户注册/登录 |
| `luge-chat` | 主动讲解选点/写稿 + 黄点风景库预览（`mode=proactive` / `proactive_preview`） |
| `footprint-jobs` | 足迹 10min 总结 + 24h 归档（cron 调用） |

`luge-chat` 需在服务器 `.env` 配置 `DEEPSEEK_API_KEY`、`TIANDITU_KEY`，并在 `docker-compose.yml` 的 `functions` 服务中传入。

> **`TIANDITU_KEY` 必须是「服务端」类型 key**。天地图控制台默认发的是浏览器端 key，从机房 IP 调用会 403（`code 301012`），即便伪造 Referer 也不行 —— 本地开发机能通不代表线上能通。
>
> 2026-08-24 起高德已下线：POI 撞库走自建 PostGIS（`geo_landmarks_cache` + `geo_admin_areas`），逆地理走天地图。`AMAP_WEB_KEY` 已从 `.env` 与 `docker-compose.yml` 移除。

改环境变量后必须 **recreate** 而不是 restart，否则新变量不会注入容器：

```bash
ssh luge@luge.chat 'cd ~/supabase-project && sh run.sh recreate functions'
```

可选：`DEEPSEEK_JUDGE_MODEL` 覆盖主动讲解判定模型；未配置则回退到 `DEEPSEEK_MODEL`。

`footprint-jobs` 需配置 `FOOTPRINT_CRON_SECRET`，由 crontab 每 5 分钟 POST 触发。

```bash
# 从仓库同步到服务器
scp -r supabase/functions/luge-chat luge@luge.chat:~/supabase-project/volumes/functions/
ssh luge@luge.chat 'docker restart supabase-edge-functions'
```

`wechat-auth` 需在服务器 `.env` 配置 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`，并在 `docker-compose.yml` 的 `edge-functions` 服务中传入（见下方）。

沙盒登录 `sandbox-auth` 部署路径：`~/supabase-project/volumes/functions/sandbox-auth/`。

函数默认查 **`dev`** schema（`SANDBOX_DB_SCHEMA` 环境变量可改）。dev 库需有 `users` 表及沙盒种子数据，见 [database-migrations.md](./database-migrations.md#dev--public-双-schema线上)。

---

`.env` 关键项（已配置）：

```
SUPABASE_PUBLIC_URL=https://api.luge.chat
API_EXTERNAL_URL=https://api.luge.chat
PROXY_DOMAIN=api.luge.chat
PGRST_DB_SCHEMAS=public,storage,graphql_public,dev
```

`dev` schema 供开发客户端隔离数据；生产 App 使用 `public`（PostgREST `Accept-Profile: public`）。
改 `.env` 后 **recreate** REST（`sh run.sh recreate rest`）；仅 restart 不会刷新容器环境变量。

Caddy 自动申请 Let's Encrypt。DNS `api.luge.chat` 须指向服务器公网 IP。

查看 Caddy：

```bash
docker logs supabase-caddy --tail 100
```

---

## 数据库迁移（线上）

迁移 SQL 在仓库 `supabase/migrations/`，需**手动**应用到 Postgres。  
步骤见 [database-migrations.md](./database-migrations.md#推送到-public生产库)。

Postgres 连接（密码见 `sh run.sh secrets`）：

- 经 Pooler：`api.luge.chat:5432`（session）/ `:6543`（transaction）
- 容器内：`docker exec -it supabase-db psql -U postgres`

---

## 备份建议

| 数据 | 路径 / 方式 |
|------|-------------|
| Postgres 数据卷 | `~/supabase-project/volumes/db/data` |
| Storage 文件 | `~/supabase-project/volumes/storage` |
| 环境变量 | `~/supabase-project/.env`（含密钥，备份加密存放） |

定期 `tar` 或云盘快照；重大迁移前必备份。
