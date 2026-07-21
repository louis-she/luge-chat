# 方案甲：火山 RTC 对话 + Function Calling

> 状态：V0 基本齐全（RTC AppId/AppKey + 回调 URL/Signature 已配；智能体示例已保存）。  
> 完整能力调研：→ [volcengine-ai-av-research.md](./volcengine-ai-av-research.md)  
> StartVoiceChat 模板：→ [volcengine-startvoicechat-template.md](./volcengine-startvoicechat-template.md)

## 目标架构

```
┌─────────────────────┐     RTC 房间      ┌──────────────────────────┐
│  路鸽 App (RN SDK)  │◄────────────────►│ 火山 AI 音视频互动         │
│  进房 / 采麦 / 听播报 │                   │ ASR · LLM · TTS · 打断    │
└─────────────────────┘                   └────────────┬─────────────┘
                       FC + 状态回调（answerFinish 扣次） │
                                                       ▼
                                              ┌────────────────────┐
                                              │ api.luge.chat      │
                                              │ · Token / StartChat│
                                              │ · get_nearby_…     │
                                              │ · footprint/quota  │
                                              └────────────────────┘
```

## 任务（与 TODO / 调研文档同步）

| ID | 内容 | 依赖 |
|----|------|------|
| V0 | RTC AppId/AppKey；回调签名；OpenAPI AK/SK；智能体配置 | ✅ |
| V0.5 | 能力调研文档 | ✅ |
| V1 | `@volcengine/react-native-rtc` + Dev Client 真机 | SDK + spike 页已就绪；须真机构建验收 |
| V2 | Token + StartVoiceChat 无 FC | ✅ 真机对话通 |
| V2.5 | VoiceChat 服务端回调 | 🟡 日志；扣次未接 |
| V3 | FC `get_nearby_landmarks` | ✅ spike + GPS + 回调回传 |
| V4 | 回调扣配额 + 足迹 | V2.5 + V3 |
| V5 | 替换雷达页语音主干 | 🟡 真机 RTC 已接；模拟器仍 legacy；主动讲解仍 HTTP |
| V6 | 主动讲解 ExternalTextToSpeech | V5 |
| V7 | 路测验收 | V5+ |

## 服务器环境变量

```bash
VOLC_RTC_APP_ID=                 # ✅
VOLC_RTC_APP_KEY=                # ✅（生成进房 Token）
VOLC_VOICE_CALLBACK_SECRET=      # ✅
VOLC_OPENAPI_ACCESS_KEY_ID=      # ✅（StartVoiceChat 签名）
VOLC_OPENAPI_SECRET_KEY=         # ✅
# 模型在 StartVoiceChat 里用 ModelName=doubao-seed-2-0-lite-260215，未必再要 Endpoint
```

## 控制台已定配置摘要

- 回调：`https://api.luge.chat/functions/v1/volc-voice-callback`
- 模型：`doubao-seed-2-0-lite`，Thinking 关闭，HistoryLength=10
- TTS：佩奇 `zh_female_peiqi_uranus_bigtts` + `seed-tts-2.0`（与 App 默认一致）
- ASR：bigmodel，SilenceTime 600ms
- InterruptMode=0（可打断）

## 明确不做

云端录制、音色复刻、数字人、白板、首期 MCP / 火山长期记忆（Viking）。
