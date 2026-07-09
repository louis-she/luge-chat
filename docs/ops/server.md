# 服务器运维

- **主机**：腾讯云轻量，Ubuntu 24.04 LTS
- **SSH**：`ssh luge@luge.chat`（密钥免密）
- **sudo**：需要密码（见项目 `.cursor/rules/server-access.mdc`，勿提交到公开仓库）

---

## 登录与权限

```bash
ssh luge@luge.chat
sudo -v   # 验证 sudo（长时间操作前先执行）
```

`luge` 用户在 `sudo` 组。Docker 命令通常需 `sudo` 或已加入 `docker` 组。

---

## 系统重启

```bash
# 查看运行时间
uptime

# 计划重启（会断 SSH）
sudo reboot
```

**重启后需确认**：

```bash
ssh luge@luge.chat
docker ps                    # Docker 服务是否自启
cd ~/supabase-project && sh run.sh status
```

Docker 已 `systemctl enable docker` 时容器策略取决于 compose `restart:` 策略（一般为 `unless-stopped`）。

---

## Docker

```bash
docker ps -a
docker stats --no-stream
docker system df
```

**镜像加速**（已配置）：腾讯云 `mirror.ccs.tencentyun.com`。拉镜像失败时检查 `/etc/docker/daemon.json`。

---

## 内核 / 高并发调优（已做）

- `limits.conf`：文件描述符上限 **1048576**
- `sysctl`：TCP 缓冲区、TIME_WAIT 重用等

修改后：

```bash
sudo sysctl -p
# limits 需重新登录生效
```

---

## 防火墙与端口

对外主要端口：

| 端口 | 用途 |
|------|------|
| 22 | SSH |
| 80 / 443 | Caddy（HTTPS API + Studio） |
| 5432 / 6543 | Postgres Pooler（按需开放，生产建议限制 IP） |

```bash
sudo ufw status    # 若启用 ufw
ss -tlnp           # 监听端口
```

---

## 磁盘与内存

```bash
df -h
free -h
docker system prune -a   # 清理无用镜像（慎用，确认无未用数据）
```

当前机器约 **3.6GB RAM**，跑全套 Supabase 偏紧；勿随意 `config add logs` 等增内存服务。

---

## 日志排障

```bash
# Supabase 全套
cd ~/supabase-project && sh run.sh logs

# 系统
sudo journalctl -u docker -n 100 --no-pager
dmesg | tail
```

---

## 关联文档

- Supabase 生产：[supabase-production.md](./supabase-production.md)
- 数据库迁移：[database-migrations.md](./database-migrations.md)
