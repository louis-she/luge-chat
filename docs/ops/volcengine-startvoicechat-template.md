# StartVoiceChat 参考配置（路鸽智能体）

> 来源：控制台创建智能体后的官方示例（2025-06-01）  
> 保存日期：2026-07-14  
> AppId / Signature 等密钥见服务器 `.env`，勿提交真实密钥到 git。

## 调用

```
POST https://rtc.volcengineapi.com?Action=StartVoiceChat&Version=2025-06-01
```

需火山 OpenAPI V4 签名（AccessKey，与 RTC AppKey 不是同一套；服务端另需配置 AK/SK）。

## 请求体模板（无 Function Calling）

运行时由服务端填入真实 `AppId` / `RoomId` / `TaskId` / `TargetUserId` / `UserId`（智能体 ID）。

```json
{
  "AppId": "<VOLC_RTC_APP_ID>",
  "RoomId": "<与 RTC Token 一致>",
  "TaskId": "<本会话唯一任务 ID>",
  "Config": {
    "ASRConfig": {
      "Provider": "volcano",
      "ProviderParams": {
        "Mode": "bigmodel",
        "ApiResourceId": "volc.seedasr.sauc.duration",
        "StreamMode": 2,
        "VolcanoASRParameters": "{\"request\":{\"enable_nonstream\":true}}"
      },
      "VADConfig": {
        "SilenceTime": 600
      },
      "InterruptConfig": {
        "InterruptKeywords": [],
        "InterruptSpeechDuration": 0
      }
    },
    "LLMConfig": {
      "Mode": "ArkV3",
      "ModelName": "doubao-seed-2-0-lite-260215",
      "SystemMessages": [
        "你是「路鸽」，自驾场景下的语音导游。\n\n你会用到位置与周边地理信息（若已通过工具或上下文提供）；没有足够依据时要说清是推测，不要编造精确数据。\n\n回答要求：\n- 先直接回答用户问题，不要绕弯，不要刻意加旅途趣味点或套话；\n- 控制在约 150～280 字，用户明确要求更详细时可放宽；\n- 用户问左右前后等方位时，才使用「左前方」等表述；没问方位就不要主动纠结朝向。"
      ],
      "ThinkingType": "disabled",
      "VisionConfig": {},
      "HistoryLength": 10,
      "Temperature": 0.1,
      "TopP": 0,
      "MaxTokens": 1024
    },
    "TTSConfig": {
      "Provider": "volcano_bidirection",
      "ProviderParams": {
        "Credential": {
          "ResourceId": "seed-tts-1.0"
        },
        "VolcanoTTSParameters": "{\"req_params\":{\"speaker\":\"zh_female_peiqi_mars_bigtts\",\"audio_params\":{\"speech_rate\":0,\"loudness_rate\":0},\"additions\":{\"post_process\":{\"pitch\":0}}}}"
      }
    },
    "InterruptMode": 0,
    "SubtitleConfig": {
      "DisableRTSSubtitle": false,
      "SubtitleMode": 0
    },
    "FunctionCallingConfig": {},
    "WebSearchAgentConfig": {},
    "MemoryConfig": {},
    "MusicAgentConfig": {}
  },
  "AgentConfig": {
    "TargetUserId": ["<客户端进房 UserId>"],
    "UserId": "<智能体 Bot UserId，如 luge_guide>",
    "EnableConversationStateCallback": true,
    "ServerMessageURLForRTS": "https://api.luge.chat/functions/v1/volc-voice-callback",
    "ServerMessageSignatureForRTS": "<VOLC_VOICE_CALLBACK_SECRET>",
    "VoicePrint": {
      "MetaList": null,
      "VoicePrintList": null
    }
  }
}
```

## 字段解读（路鸽相关）

| 项 | 值 | 说明 |
|----|-----|------|
| ASR | bigmodel + StreamMode 2 + VAD 600ms | `enable_nonstream`；缺 StreamMode 曾导致 bad handshake |
| LLM | `doubao-seed-2-0-lite` + Thinking disabled | 人设：直接答、字数、方位；不加趣味点 |
| HistoryLength | 10 | 与先前「10 轮窗口」对齐 |
| TTS | `seed-tts-1.0` + `zh_female_peiqi_mars_bigtts` | 与当前控制台跑通配置一致；可再切回 2.0 uranus |
| InterruptMode | 0 | 开语音打断 |
| 回调 URL / Signature | 已配置 | 对应 `VOLC_VOICE_CALLBACK_SECRET` |

## Function Calling（V3，已上线）

`FunctionCallingConfig` 与 RTS 共用同一回调 URL；FC 外壳字段 `Type` / `Message` / `RoomID` / `TaskID`：

| Type | 处理 |
|------|------|
| `information` | 缓存 `tool_call_id` + `response_id` |
| `tool_calls` | `Message` 为 JSON **数组** → 查周边 → `UpdateVoiceChat` |

回传格式（路测已通）：

```json
{
  "Command": "function",
  "Message": "{\"ToolCallID\":\"call_xxx\",\"Content\":\"{...}\",\"response_id\":\"...\"}"
}
```

`LLMConfig.Tools` 见 `voiceChatConfig.ts` 的 `get_nearby_landmarks`；客户端 `action=location` 写 `voice_chat_session_loc`。

## 后续可选

1. 控制台模板与代码 TTS 2.0 uranus 对齐（非阻塞）  
2. V2.5 回调扣次、`answerFinish`  

## 客户端进房时注意

- `RoomId` 必须与生成 RTC Token 时一致  
- `TargetUserId` 必须是真人客户端的 `UserId`  
- `AgentConfig.UserId` 是 AI bot 在房间里的假用户 ID，别和真人撞名  
