# 路鸽 (Luge) 运维手册

本目录记录日常运维操作：**数据库迁移、Supabase 启停、服务器部署、排障**。  
每次做 schema 变更、上线部署、服务器配置调整时，**同步更新对应章节并在 [变更日志](#变更日志) 记一笔**。

---

## 目录

| 文档 | 内容 |
|------|------|
| [../product/core-flows.md](../product/core-flows.md) | **真机核心流程**（问路 / 主动讲解，产品+技术） |
| [database-migrations.md](./database-migrations.md) | 加字段、减字段、PostGIS 迁移、推线上 |
| [supabase-production.md](./supabase-production.md) | 线上 Docker 自建 Supabase（`api.luge.chat`） |
| [server.md](./server.md) | SSH、sudo、重启、Docker、内核调优 |
| [expo-app.md](./expo-app.md) | Expo 客户端开发与真机联调 |
| [website.md](./website.md) | 主站静态页（luge.chat 备案） |

---

## 环境一览

| 环境 | Supabase API | DB Schema | 迁移目录 | 说明 |
|------|--------------|-----------|----------|------|
| 开发 | `https://api.luge.chat` | `dev` | `supabase/migrations/` | Expo `__DEV__` 默认 |
| 生产 | `https://api.luge.chat` | `public` | 同上（手动应用到 PG） | Release 构建 |

**密钥**：`ssh luge@luge.chat` 后 `cd ~/supabase-project && sh run.sh secrets`。勿提交 git。

---

## 常用速查

```bash
# 线上：看 Supabase 容器状态
ssh luge@luge.chat 'cd ~/supabase-project && sh run.sh status'

# 线上：重启整套 Supabase
ssh luge@luge.chat 'cd ~/supabase-project && sh run.sh restart'

# 主站静态页部署
bash scripts/deploy-website.sh
```

---

## 变更日志

> 新记录写在最上面。

### 2026-06-24 — 移除本地 Supabase

- 停止并删除 `luge-local` Docker 容器与数据卷
- 删除 `luge-local/` 目录；迁移 / Functions / seed 迁至仓库根 `supabase/`
- 开发环境统一连线上 `api.luge.chat`（`dev` schema）

### 2026-06-24 — dev / public 双 Schema

- **客户端**：`lib/config.ts` 开发默认 `dev` schema，Release 默认 `public`
- **线上 PostgREST**：`PGRST_DB_SCHEMAS` 增加 `dev`
- **迁移**：`20260624120000_dev_schema_api.sql`

### 2026-06-16 — 沙盒登录（sandbox-auth）

- **Edge Function**：`supabase/functions/sandbox-auth`
- **种子数据**：`supabase/seed.sql`（3 个沙盒用户）

### 2026-06-16 — 核心表结构初版

- **迁移文件**：`supabase/migrations/20260616180000_core_schema.sql`
