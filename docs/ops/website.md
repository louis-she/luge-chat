# 主站静态页（luge.chat）

备案用官方网站，源码在仓库 `website/`。

---

## 页面

| 路径 | 说明 |
|------|------|
| `/` | 备案主站 |
| `/app/` | App 下载落地页 |
| `/assets/icon-28.png` | Favicon（28×28） |
| `/assets/icon-108.png` | 页头 / App 页图标（108×108） |
| `/assets/logo.png` | 高清 Logo（1024×1024，备用） |

---

## 页面内容（主站）

- 公司信息：成都蛇小鼠科技有限公司
- 产品介绍：路鸽（自驾游 AI 语音导游）
- 联系方式：`contact@luge.chat`
- 页脚备案号占位（审核通过后替换为真实 ICP 号）

---

## 本地预览

```bash
cd website
python3 -m http.server 8080
# 打开 http://127.0.0.1:8080
```

---

## 部署到服务器

```bash
bash scripts/deploy-website.sh
```

脚本会：

1. 同步 `website/index.html`、`website/styles.css`、`website/app/index.html` 到 `~/supabase-project/volumes/www/luge.chat/`
2. 更新 Caddy 配置（`luge.chat` + `www.luge.chat` 静态站，`api.luge.chat` 保持 Supabase）
3. 重建 Caddy 容器

---

## DNS

| 记录 | 值 |
|------|-----|
| `luge.chat` A | 服务器公网 IP |
| `www.luge.chat` A 或 CNAME | 同上 / `luge.chat` |

HTTPS 由 Caddy 自动申请 Let's Encrypt 证书。

---

## 备案号更新

拿到 ICP 备案号后，编辑 `website/index.html` 页脚：

```html
<a href="https://beian.miit.gov.cn/" ...>蜀ICP备XXXXXXXX号-1</a>
```

改完重新执行 `bash scripts/deploy-website.sh`。
