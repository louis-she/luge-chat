# Expo 客户端运维

项目根目录为 Expo App（`lugechat`），后端接 Supabase。

---

## 本地开发

```bash
# 项目根目录
npm install
npm start          # 默认 LAN 模式（127.0.0.1:8081 可访问）
npm run start:ios  # 推荐：临时关 Clash 系统代理 + 清缓存启动，再开模拟器
```

**不要用 `expo start --localhost`**：在 macOS 上 Metro 可能只监听 IPv6 `::1`，模拟器访问 `127.0.0.1` 会失败，经 Clash 代理后显示为 **502**。

### Clash / 系统代理排障（502）

若模拟器仍报 `http response error 502`：

1. **优先用** `npm run start:ios`（自动临时关闭 Wi-Fi 系统代理，退出后恢复）
2. Clash 开启「绕过私有地址 / LAN」：`127.0.0.1`、`192.168.0.0/16`
3. 或开发时手动关闭 Clash「设置为系统代理」
4. 清缓存：`npm run start:clean`

---

### 页面结构（Expo Router）

```
app/
  login.tsx              # 微信登录
  (tabs)/
    index.tsx            # Tab1 雷达主控
    footprints.tsx         # Tab2 轨迹历史
    profile.tsx            # Tab3 个人中心
```


环境变量（`.env.local`，勿提交密钥；模板见项目根 `.env.example`）：

```bash
# 开发：连线上 dev schema（默认行为，__DEV__ 自动选 dev）
EXPO_PUBLIC_SUPABASE_URL=https://api.luge.chat
EXPO_PUBLIC_SUPABASE_ANON_KEY=<sh run.sh secrets 中的 ANON_KEY>
# EXPO_PUBLIC_SUPABASE_DB_SCHEMA=dev   # 可省略，__DEV__ 默认 dev

# 生产构建（EAS / release）：public schema
# EXPO_PUBLIC_SUPABASE_DB_SCHEMA=public
```

线上密钥：`ssh luge@luge.chat` → `cd ~/supabase-project && sh run.sh secrets`

---

## 登录（微信 / Apple）

原生登录依赖 **Development Build**（**Expo Go 不可用**），且 **必须真机**：

```bash
npx expo prebuild --platform ios
# 推荐：Xcode 打开 ios/app.xcworkspace → 选你的 iPhone → Run
# 或：npm run build:ios:device
# 另开终端：npm run start:dev
```

限制（本机 Xcode 26 + Apple Silicon）：

1. `npx expo run:ios` 常失败：CoreDevice 列不出模拟器 UDID  
2. **微信 SDK**（`WechatOpenSDK`）的 arm64 是真机切片，**无法链到模拟器** → 含微信的 Dev Build 不能装模拟器  

模拟器请继续用 Expo Go + 沙盒登录测问路/次数；Apple / 微信登录用真机。

### 微信

| 项 | 值 |
|----|-----|
| AppID | `wx670d93537c72d57a`（`EXPO_PUBLIC_WECHAT_APP_ID`） |
| iOS Bundle ID | `com.shexiaoshu.lugechat` |
| Android 包名 | `com.shexiaoshu.lugechat` |
| Universal Link | `https://luge.chat/app/` |

1. **微信开放平台**：移动应用 → 配置 iOS Universal Links 为 `https://luge.chat/app/`
2. **Apple Developer**：Team ID `9UJ72U7F8J`，AASA 已配置为 `9UJ72U7F8J.com.shexiaoshu.lugechat`；改动后执行 `bash scripts/deploy-website.sh`
3. **服务端**：`wechat-auth` Edge Function，`WECHAT_APP_SECRET` 仅存服务器 `.env`（勿提交 git）

流程：App 调起微信授权 → 拿 `code` → `POST /functions/v1/wechat-auth` → 后端换 OpenID 并签发 JWT。

### Apple

| 项 | 值 |
|----|-----|
| Team ID | `9UJ72U7F8J` |
| Bundle ID | `com.shexiaoshu.lugechat` |
| Capability | Sign In with Apple（App ID 已勾选） |

1. **Apple Developer**：Identifiers → App ID 勾选 Sign In with Apple
2. **客户端**：`expo-apple-authentication`，`app.json` 中 `ios.usesAppleSignIn: true`
3. **服务端**：`apple-auth` Edge Function，校验 Apple `identityToken`（audience = Bundle ID），按 `apple_user_id` 建用户并发放注册礼包

流程：系统 Apple 登录 → 拿 `identityToken` → `POST /functions/v1/apple-auth` → 后端验签并签发 JWT。模拟器需登录 Apple ID；真机需用带签名的 Dev Build。

---

## 真机路测

- 真机不能连 `127.0.0.1`（Metro 在 Mac 上）
- 后端已用 `https://api.luge.chat`，真机可直接连（需 `.env.local` 配好 anon key）
- 若 Metro 本身需穿透，可用 **LocalTunnel** 或 **cpolar** 映射 HTTPS 临时域名

### 模拟器定位总在旧金山？

iOS 模拟器默认坐标在加州。开发模式下 App 会**自动识别**旧金山坐标并替换为成都测试点（锦江附近，便于测「前方的河」）。

| 变量 | 说明 |
|------|------|
| `EXPO_PUBLIC_DEV_LAT/LNG/HEADING` | 开发 mock 坐标与朝向（默认成都） |
| `EXPO_PUBLIC_DEV_USE_REAL_GPS=1` | 强制使用模拟器原始 GPS |
| `EXPO_PUBLIC_DEV_USE_MOCK_LOCATION=1` | 强制始终 mock（真机也可用） |

也可在模拟器菜单 **Features → Location → Custom Location** 手动设国内坐标。

### 地理问答（luge-chat）

路鸽启动后，开发环境顶部有「问路鸽」输入框；点左下鸽子可发送示例河问句。流程：高德周边 POI + 逆地理（国内主路径）→ Overpass 兜底 → DeepSeek 总结 → 气泡 + TTS。

**足迹**：登录后每次问答会经 LLM 判断是否记入足迹（30km 内候选匹配 / 新建 POI）。10 分钟无新消息自动总结；24 小时无活动归档 visit。足迹 Tab 可查看。

`DEEPSEEK_API_KEY` / `AMAP_WEB_KEY` 仅存服务器 Edge Function 环境变量，勿写入客户端。

定时归档（服务器 crontab，每 5 分钟）：

```bash
curl -s -X POST https://api.luge.chat/functions/v1/footprint-jobs \
  -H "x-cron-secret: <FOOTPRINT_CRON_SECRET>"
```

---

## 构建与上架（待补充）

| 平台 | 命令 / 说明 |
|------|-------------|
| iOS | EAS Build + App Store Connect |
| Android | EAS Build + 各商店 / 酷安 |

> 上架流程确定后在本文件补充，并记入 [README 变更日志](./README.md)。

---

## 关联

- 线上 Supabase：[supabase-production.md](./supabase-production.md)
- 数据库迁移：[database-migrations.md](./database-migrations.md)
