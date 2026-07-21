/** StartVoiceChat 请求体工厂（控制台 ASR + 路鸽人设 + V3 FC） */

export const VOICE_CHAT_API_VERSION = '2025-06-01'
/** 房间内 AI bot 的 UserId，勿与真人撞名 */
export const LUGE_BOT_USER_ID = 'luge_guide'

const CALLBACK_URL = 'https://api.luge.chat/functions/v1/volc-voice-callback'

const SYSTEM_MESSAGE = `你是「路鸽」，自驾场景下的语音导游。

你会用到位置与周边地理信息（若已通过工具或上下文提供）；没有足够依据时要说清是推测，不要编造精确数据。

工具：当用户问附近/旁边/前面/左右有什么、某座桥/河/山/风景是什么时，先调用 get_nearby_landmarks，再根据工具结果回答。不要猜测经纬度，也不要编造具体地名。

回答要求：
- 先直接回答用户问题，不要绕弯，不要刻意加旅途趣味点或套话；
- 控制在约 150～280 字，用户明确要求更详细时可放宽；
- 用户问左右前后等方位时，才使用「左前方」等表述；没问方位就不要主动纠结朝向。`

/** OpenAI 风格 Tools，挂在 LLMConfig */
export const LUGE_VOICE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_nearby_landmarks',
      description:
        '查询用户当前 GPS 周边的地理地标（风景、河流、桥梁、城镇、山脉等）。用户问附近/旁边/前面有什么、某地标是什么时必须调用。经纬度由服务端会话位置提供，无需也不应猜测坐标。',
      parameters: {
        type: 'object',
        properties: {
          radius_m: {
            type: 'number',
            description: '搜索半径（米），默认 3000，最大 8000',
          },
          focus: {
            type: 'string',
            description: '可选关注点，如「河」「桥」「山」「风景」',
          },
        },
        additionalProperties: false,
      },
    },
  },
]

/** 与火山控制台 StartVoiceChat 对齐，并挂 V3 Function Calling */
export function buildStartVoiceChatBody(opts: {
  appId: string
  roomId: string
  taskId: string
  targetUserId: string
  callbackSecret: string
}) {
  return {
    AppId: opts.appId,
    RoomId: opts.roomId,
    TaskId: opts.taskId,
    Config: {
      ASRConfig: {
        Provider: 'volcano',
        ProviderParams: {
          Mode: 'bigmodel',
          ApiResourceId: 'volc.seedasr.sauc.duration',
          StreamMode: 2,
          VolcanoASRParameters: '{"request":{"enable_nonstream":true}}',
        },
        VADConfig: {
          SilenceTime: 600,
        },
        InterruptConfig: {
          InterruptKeywords: [],
          InterruptSpeechDuration: 0,
        },
      },
      LLMConfig: {
        Mode: 'ArkV3',
        ModelName: 'doubao-seed-2-0-lite-260215',
        SystemMessages: [SYSTEM_MESSAGE],
        ThinkingType: 'disabled',
        VisionConfig: {},
        HistoryLength: 10,
        Temperature: 0.1,
        TopP: 0,
        MaxTokens: 1024,
        Tools: LUGE_VOICE_TOOLS,
      },
      TTSConfig: {
        Provider: 'volcano_bidirection',
        ProviderParams: {
          Credential: {
            ResourceId: 'seed-tts-1.0',
          },
          VolcanoTTSParameters:
            '{"req_params":{"speaker":"zh_female_peiqi_mars_bigtts","audio_params":{"speech_rate":0,"loudness_rate":0},"additions":{"post_process":{"pitch":0}}}}',
        },
      },
      InterruptMode: 0,
      SubtitleConfig: {
        DisableRTSSubtitle: false,
        SubtitleMode: 0,
      },
      FunctionCallingConfig: {
        ServerMessageUrl: CALLBACK_URL,
        ServerMessageSignature: opts.callbackSecret,
      },
      WebSearchAgentConfig: {},
      MemoryConfig: {},
      MusicAgentConfig: {},
    },
    AgentConfig: {
      TargetUserId: [opts.targetUserId],
      UserId: LUGE_BOT_USER_ID,
      WelcomeMessage: '你好，我是路鸽。有想了解的路边风景，随时问我。',
      EnableConversationStateCallback: true,
      ServerMessageURLForRTS: CALLBACK_URL,
      ServerMessageSignatureForRTS: opts.callbackSecret,
      VoicePrint: {
        MetaList: null,
        VoicePrintList: null,
      },
    },
  }
}
