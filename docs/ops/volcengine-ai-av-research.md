# 火山「AI 音视频互动」能力调研（路鸽方案甲）

> 调研日期：2026-07-13  
> 目的：开工前对齐能力边界、计费、回调、记忆、SDK，避免边做边猜。  
> 官方入口：[产品简介](https://docs.volcengine.com/docs/6348/1310537) · [计费](https://docs.volcengine.com/docs/6348/2123214) · [Function Calling](https://docs.volcengine.com/docs/6348/1554654) · [任务状态回调](https://docs.volcengine.com/docs/6348/2165062) · [RN 集成示例](https://docs.volcengine.com/docs/6348/1455709)

**密钥**：`VOLC_RTC_APP_ID` / `VOLC_RTC_APP_KEY` 已写入服务器 `~/supabase-project/.env`（勿提交 git）。方舟 Endpoint / API Key 仍缺。

---

## 1. 产品是什么（先分清两个名字）

| 名称 | 含义 |
|------|------|
| **AI 音视频互动方案**（简介页主推，2.0） | 「一站式」：RTC + ASR + LLM + TTS 打包；**按互动 Token 统一计费**；少自己开一堆子产品 |
| **实时对话式 AI**（旁系/旧文档仍大量存在） | 同一家族，集成/计费拆得更细；许多 API 名（StartVoiceChat）两边共用 |

路鸽应对准 **AI 音视频互动方案**：客户端 RTC SDK 进房 → 服务端 `StartVoiceChat` 拉起智能体。

**和「实时对话式 AI」的差异（简介页表格要点）**

- **集成**：可直接用方舟 / 配套 ASR·TTS，不必逐个产品开通拼装  
- **计费**：按互动过程消耗的 **Token 总量**，而不是 LLM / ASR / TTS / RTC 拆四张账单（仍可能有声音复刻等增值项）

单价参考：[AI 音视频互动方案计费](https://docs.volcengine.com/docs/6348/2123214) → **¥12 / 百万 Tokens**（按量或资源包）。

---

## 2. 官方架构（简化）

```
客户端 App
  RTC Client SDK
  · 采麦 / 播对方音频
  · 3A、AI 降噪、VAD
        │ 音频流 +（可选）字幕通道
        ▼
火山实时传输网 (RTC)
        │
        ▼
AIGC-RTC 服务
  · 智能音视频处理（降噪 / VAD / 抽帧…）
  · ASR → 文本
  · LLM（Prompt / 记忆 / RAG / Function Call）
  · TTS（→ 音频回房间）
  · （可选）数字人 TTA、内容审核
```

**对我们**：买的是「听 + 说 + 打断 + 通话态」；「车在哪 / 足迹 / 配额」仍要靠 **Function Calling 或 CustomLLM** 接到 `api.luge.chat`。

---

## 3. 能力清单 × 路鸽要不要

### 3.1 核心必用（方案甲骨架）

| 能力 | 说明 | 路鸽用法 |
|------|------|----------|
| RTC 客户端 SDK | 进房、采麦、订阅 AI 音频 | 替换系统 ASR + HTTP TTS 主路径 |
| Start / Update / Stop VoiceChat | 启停智能体、打断、外部播报 | 启动路鸽 = Start；停止 = Stop |
| ASR + VAD + 降噪 | 流式识别、判停、车噪 | 消化路测 A1/C3 一部分 |
| TTS（流式） | 云端合成回灌房间 | 消化 B1/B2 分段跳变 |
| 智能打断 | 全双工插话 | 对齐豆包体验 |
| Function Calling | LLM 调你们函数（服务端或客户端） | `get_nearby_landmarks` 等 |
| System / Prompt | 导游人设、禁哈哈笑、禁 markdown | 收紧 B3/B4/C6 |
| 短期上下文 | `HistoryLength` 类轮次记忆 | 可替代自建 10 轮窗口（或并存） |

### 3.2 强烈建议用（计费与状态）

| 能力 | 说明 | 路鸽用法 |
|------|------|----------|
| **服务端回调 VoiceChat** | 任务开始/结束、用户说完、AI 说完、ASR/LLM/TTS 阶段、错误 | **按轮扣配额、写足迹、监控延迟** 比客户端自报靠谱 |
| 实时字幕 / 对话事件 | 识别文本、回复文本 | 足迹原文、Debug、UI 字幕（可选） |
| ExternalTextToSpeech | 不经用户问，直接播一段 | **主动讲解** |

回调配置要点（控制台）：

- 事件选 **VoiceChat**  
- URL 必须是公网 **http(s):// 域名**（`api.luge.chat/...` 合适）  
- HTTPS 要合法证书（你们已有）  
- 配置约 **1 分钟**生效；需校验签名密钥  

关键 `RunStage`（任务状态回调）：

| RunStage | 含义 | 路鸽可用来 |
|----------|------|------------|
| `taskStart` / `taskStop` | 任务起停 | 会话生命周期 |
| `beginAsking` | 用户开始说 | UI「在听」 |
| `asrFinish` | 用户说完（ASR 结束） | 可记用户句；**未必立刻扣费** |
| `answerFinish` | 智能体说完 | **推荐：成功一轮后再扣配额** |
| `asr` / `llm` / `tts` | 各阶段 | 耗时分析 |
| `preParamCheck` | 参数错误 | 告警 |

还有 `RoundID`（从 0 起）、`RoomId`、`TaskId`、`UserID`、`EventTime`。

**关于「计费用回调」**：  
合理。不要信客户端「我问了一次」。以 **`answerFinish`（或明确的一轮完成事件）+ RoundID 去重** 在服务端扣 `balance_asks`。失败轮、用户打断未答完是否扣费，产品上要定一条规则。

### 3.3 可选 / 以后再说

| 能力 | 建议 |
|------|------|
| 火山知识库 RAG | 地理「此刻周边」仍以 FC 为准；百科可后接 |
| 联网问答 Agent | 同左 |
| MCP | 工具多了再上；MVP 用 FC 声明几个函数够 |
| 长期记忆（Viking） | 跨天人设/偏好可后做；单次自驾用短期记忆即可 |
| 情绪识别与生成 | 非刚需 |
| 声纹 / 多人 | 车内多人可后验 |
| 视频 / 图片理解 | 非 MVP |
| 数字人 | 不做 |
| 内容审核 | 上架前再开 |

### 3.4 明确不做（同意你的判断）

| 能力 | 原因 |
|------|------|
| 云端录制 / 云录屏 | 隐私与成本，路鸽不需要 |
| 音色复刻（声音克隆） | 已有官方「佩奇猪」等；复刻另计费 |
| 白板 / 推流直播 | 无关 |
| SIP / 电话网关 | 无关 |

---

## 4. Function Calling（再确认）

- LLM **只决策**调哪个工具、参数是什么；**执行在你们代码**。  
- 两条路：  
  - **服务端回调 URL**：适合查库、高德、扣配额（推荐地理工具走这条）  
  - **客户端二进制消息**：适合读手机 GPS、改 UI（GPS 也可客户端拿到后带进服务端工具）  
- 改 Tools 配置通常要 **Stop 再 Start** 会话。  
- 建议模型：**非 thinking**，降延迟。  
- 工具草案（路鸽）：

```
get_nearby_landmarks(lat, lng, heading?)  → 现有缓存/高德
get_footprint_context(...)                → 足迹摘要
# 配额建议不放 FC，而放服务端回调 answerFinish
```

---

## 5. 记忆：短期 vs 长期

| 类型 | 机制 | 路鸽 |
|------|------|------|
| **短期** | 会话内轮次（如 HistoryLength ≈ 10～15） | **直接用**，可替换自研 `chatWindow` |
| **长期** | Viking 记忆库，跨会话 | 后置；与「足迹」产品重叠，别两套一起上 |

足迹仍是「到访过的 POI 档案」，不等于火山长期记忆；不要混成一个概念。

---

## 6. SDK / 集成路径（重要纠偏）

你给的 [1899868](https://docs.volcengine.com/docs/6348/1899868) 标题是 **「如何调用 OpenAPI」**（服务端签请求），**不是**客户端 SDK 安装页。

客户端应对：

| 层 | 文档 / 包 |
|----|-----------|
| RN SDK | npm `@volcengine/react-native-rtc`；文档示例见 [1455709](https://docs.volcengine.com/docs/6348/1455709) |
| 服务端 | OpenAPI：`StartVoiceChat` / `UpdateVoiceChat` / `StopVoiceChat` + Token |
| Expo | **必须 Dev Client / Release**，不能 Expo Go |

典型时序：

1. App 向 `api.luge.chat` 要 `roomId + userId + token`  
2. App：`createEngine` → `createRoom` → `joinRoom` → `startAudioCapture`（路鸽可 **不开摄像头**）  
3. 服务端：`StartVoiceChat`（ASR/LLM/TTS/Tools/Prompt）  
4. 控制台配好 **VoiceChat 回调** → `https://api.luge.chat/functions/v1/volc-voice-callback`  
5. 停止路鸽：`StopVoiceChat` + `leaveRoom`

---

## 7. 推荐落地图（修订后）

```
┌──────────────┐  RTC   ┌─────────────────────┐
│ 路鸽 App     │◄──────►│ 火山 AI 音视频互动     │
│ RN RTC SDK   │        │ ASR·LLM·TTS·打断     │
└──────┬───────┘        └──────────┬──────────┘
       │ 要 Token / Start           │ FC 调工具
       │                            │ 状态回调 answerFinish
       ▼                            ▼
┌─────────────────────────────────────────────┐
│              api.luge.chat                  │
│  volc-voice-chat   发 Token、Start/Stop     │
│  volc-voice-callback  校验签名、扣次、记轮次  │
│  FC handlers       周边 POI / 足迹上下文     │
│  （复用现有高德·足迹·配额表）                 │
└─────────────────────────────────────────────┘
```

**配额**：以回调 `answerFinish` + `RoundID` 去重扣次（可配置：打断未答完不扣）。  
**地理**：FC，不要指望火山 RAG 知道「车头前方新瓦村」。  
**主动讲解**：`UpdateVoiceChat` + `ExternalTextToSpeech`。  
**不做**：录制、复刻、数字人、MCP（首期）。

---

## 8. 任务表（调研后微调）

| ID | 内容 | 备注 |
|----|------|------|
| V0 | 密钥与控制台 | AppId/AppKey ✅；缺方舟 Endpoint；回调 URL 待配 |
| V0.5 | 本文档 + 架构对齐 | ✅ 本文件 |
| V1 | RN SDK + 真机进房（可先不 Start AI） | 只验证音频房间 |
| V2 | StartVoiceChat + 基础通话 | 无 FC |
| V2.5 | 服务端回调接通 | 打日志；再接到扣次 |
| V3 | FC `get_nearby_landmarks` | |
| V4 | 配额（回调）+ 足迹 | |
| V5 | 雷达页切换主路径 | 旧 ASR/TTS 做开关兜底 |
| V6 | 主动讲解 ExternalTTS | |
| V7 | 路测 | |

---

## 9. 开工前还缺什么（请你补）

1. **方舟 Endpoint ID**（及 API Key，若需要）— 建议非 thinking 模型  
2. 控制台是否已开通 **AI 音视频互动**（不仅是 RTC 空房间）  
3. 确认回调将指向：`https://api.luge.chat/functions/v1/...`（域名已具备）

---

## 10. 文档索引（常用）

| 主题 | 链接 |
|------|------|
| 产品简介 | https://docs.volcengine.com/docs/6348/1310537 |
| 方案计费 | https://docs.volcengine.com/docs/6348/2123214 |
| Function Calling | https://docs.volcengine.com/docs/6348/1554654 |
| 任务状态回调 | https://docs.volcengine.com/docs/6348/2165062 |
| RN 快速实现通话 | https://docs.volcengine.com/docs/6348/1455709 |
| OpenAPI 调用方式 | https://docs.volcengine.com/docs/6348/1899868 |
| 短期/长期记忆（目录） | 文档树「上下文管理」「接入记忆库」 |
