# 数据库迁移（Schema Migrations）

迁移文件统一放在：

```
supabase/migrations/
```

命名规范：`YYYYMMDDHHMMSS_简短描述.sql`（按时间排序执行）。

---

## 日常流程

### 1. 新建迁移

在 `supabase/migrations/` 下直接新建 SQL 文件，例如：

```
supabase/migrations/20260617120000_add_xxx.sql
```

### 2. 在 dev schema 验证

开发环境连线上 `dev` schema，迁移先在 dev 上跑通再推 public：

```bash
# 示例：把 public 迁移改写为 dev 后执行
sed 's/public\./dev./g' supabase/migrations/20260617120000_add_xxx.sql \
  | ssh luge@luge.chat 'docker exec -i supabase-db psql -U supabase_admin -d postgres'
```

### 3. 验证

```bash
ssh luge@luge.chat 'docker exec supabase-db psql -U postgres -c "\dt dev.*"'
```

---

## 加字段

```sql
-- 示例：users 增加手机号
alter table public.users
  add column phone text;

create unique index users_phone_uidx on public.users (phone)
  where phone is not null;

comment on column public.users.phone is '可选绑定手机号';
```

**注意**：
- 新字段尽量 `nullable` 或带 `default`，避免线上已有数据迁移失败
- 先在 dev schema 验证，再推到 public，并记 [README 变更日志](./README.md)

---

## 减字段 / 删表

```sql
alter table public.users drop column if exists phone;
drop table if exists public.old_table cascade;
```

**线上**：先确认无代码引用，再迁移；重要表先备份。

---

## PostGIS 规范（铁律）

- 坐标用 `geography(Point, 4326)` 或 `geography(Geometry, 4326)`，**禁止 float 存经纬度**
- 空间列必须建 **GIST 索引**

---

## dev / public 双 Schema

| Schema | 用途 | 客户端 |
|--------|------|--------|
| `dev` | 开发联调 | Expo `__DEV__` 默认 |
| `public` | 生产数据 | Release 构建 |

**PostgREST 暴露**：`PGRST_DB_SCHEMAS` 须含 `dev`，改后 `sh run.sh recreate rest`。

**dev 迁移示例**：

```bash
sed 's/public\./dev./g' supabase/migrations/20260616180000_core_schema.sql \
  | ssh luge@luge.chat 'docker exec -i supabase-db psql -U supabase_admin -d postgres'

scp supabase/migrations/20260624120000_dev_schema_api.sql luge@luge.chat:~/
ssh luge@luge.chat 'docker exec -i supabase-db psql -U supabase_admin -d postgres \
  < ~/20260624120000_dev_schema_api.sql'

# 沙盒种子（dev）
sed 's/public\./dev./g' supabase/seed.sql \
  | ssh luge@luge.chat 'docker exec -i supabase-db psql -U supabase_admin -d postgres'
```

---

## 推送到 public（生产库）

```bash
scp supabase/migrations/xxx.sql luge@luge.chat:~/
ssh luge@luge.chat 'docker exec -i supabase-db psql -U postgres -d postgres < ~/xxx.sql'
```

`POSTGRES_PASSWORD` 见 `sh run.sh secrets`。

**上线前检查清单**：
- [ ] 已在 dev schema 验证
- [ ] 迁移幂等或确认只跑一次
- [ ] 已在 [README 变更日志](./README.md) 记录

---

## 回滚

手写反向 SQL 新迁移文件，或从备份恢复（生产慎用）。

---

## 当前表结构（摘要）

| 表 | 用途 |
|----|------|
| `users` | 用户、Apple/微信身份、VIP、余额分钟 |
| `call_sessions` | 通话流水、起终点 GPS、计费 |
| `dialog_messages` | 多轮对话、触发位置与航向 |
| `geo_landmarks_cache` | PostGIS 地理知识缓存（RAG） |

完整 DDL 见：`supabase/migrations/20260616180000_core_schema.sql`
