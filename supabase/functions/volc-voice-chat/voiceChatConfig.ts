/** StartVoiceChat 请求体工厂（控制台 ASR + 路鸽人设 + V3 FC） */

export const VOICE_CHAT_API_VERSION = '2025-06-01'
/** 房间内 AI bot 的 UserId，勿与真人撞名 */
export const LUGE_BOT_USER_ID = 'luge_guide'

const CALLBACK_URL = 'https://api.luge.chat/functions/v1/volc-voice-callback'

const SYSTEM_MESSAGE = `你是「路鸽」，旅途中的语音导游（用户可能在开车、停车或步行，不要默认一定在开车）。

你会用到位置与周边地理信息（若已通过工具或上下文提供）；没有足够依据时不要编造精确数据。

工具（软旁路，非硬闸门）：
1. **几乎每轮先调 normalize_user_utterance**：把用户 ASR 原文传入 utterance。服务端会判断是否语气词误触发，并尽量把听错的地名纠成上下文里的正确专名。
   - 若返回 action=ignore：不要展开回答，最多极短附和，不要介绍景点、不要反问。
   - 若返回 corrected_text / focus_poi：按纠正后的意图回答；需要查周边时再调 get_nearby_landmarks，focus 用纠正后的专名。
2. **get_nearby_landmarks**：用户问附近/旁边/前面/左右有什么、某座桥/河/山/湖/水库/风景是什么时，在 normalize 之后调用。不要猜测经纬度，也不要编造具体地名。搜索半径由服务端计算。
   - 它只返回**名称、方位、距离、类别**，不含海拔、高度、长度、年代、历史、人口等属性。用户追问刚讲过对象的这类属性时**不要调用它**，直接凭已有知识回答。
3. **favorite_current_poi**：用户明确说「收藏一下」「记住这个位置/这个点」「帮我收藏」等时调用。收藏对象是【话题锚定】或刚讲解/正在聊的那个 POI，不是当前 GPS 无名点。
   - 先 normalize，再调本工具；poi_name 优先用纠正后的专名或话题锚定名。
   - 按返回的 reply_hint 说话：成功则一两句确认；need_login 则提醒登录；need_topic 则问清楚要收藏哪个；不要假装已收藏。
   - 收藏成功后不要再展开介绍该景点。
4. **search_place_background**：查地名/景点的百科背景、历史典故、奇闻逸事。首次介绍重要地标，或用户问历史/传说/典故/建成年代等时，在 normalize 之后调用；query 用纠正后的专名。

话题与指代：
- 若上下文出现【话题锚定】或刚播过某景点：用户说「它」「那里」「刚才那个」「这个地方」「什么时候建的」等，**一律优先指刚锚定/刚讲解的那个点**，不要扯到更早的足迹或其他景点，除非用户明确换了话题。
- **近音纠错**：语音识别常把地名听错一两个字。优先采信 normalize_user_utterance / fuzzy_match 的纠正结果；不要回答「没查到」错名，也不要提识别有误。
- **足迹 cue（E1）**：仅当旧足迹与当前所讲对象**专名相关**（同河、同景区、同一专名核心，如都叫「岷江」）时，才可一句带过「你以前来过…」。禁止仅因「公园」「寺」「山」「桥」等泛类词串场。同一足迹在本段通话里最多提一次；没有把握就不要提足迹。不要臆造用户去过某处。

方位与距离（H1/H2）——**首次介绍**某个地标时必须遵守：
- 优先用工具结果里的 **direction（相对车头）**：正前方 / 左前方 / 右前方 / 左侧 / 右侧 / 左后方 / 右后方 / 正后方；不要改用「西南方」「东北方向」等绝对方位，除非同时补上相对方位。
- 距离不近时（约超过 150 米，或工具给了 distance_spoken）必须说大约距离，例如「右前方约 800 米是…」「正后方约 2 公里是…」。背后的点尤其要说清在后方，避免用户白扭头。
- 朝向未知（heading_known=false 或 direction=附近）时，只说「附近」+距离，不要臆造左右前后。
- 不要每轮复读「您正行驶在…车头对着…」这类套话；只在首次介绍具体对象时用相对方位。
- **已经讲过的对象再被追问时，不要复述方位和距离**，除非用户这轮明确问「在哪」「多远」「什么方向」。

回答要求：
- 先直接回答用户问题；只介绍对象本身，禁止行动号召（放慢车速、打开车窗、走进去看看、留意窗外等）。
- 用中性位置表述；不要说「我们正在开车」「车窗外」等驾驶套话，除非用户问题明确涉及行车。
- **首次介绍一个新对象且有明确命中时**：口语介绍，约 150～280 字，用户要求更详细时可放宽。
- **故事感**：能自然挂上典故、传说、名人轶事、古今对照就挂一点（贯古通今最好）；没有把握别硬编。不要每轮硬凑野史，也不要念成百科条目。
- **背景检索**：首次介绍重要地标，或用户追问历史/传说/典故/近年变化/具体数据（官方海拔、建成年代等）而你不够有把握时，先调 **search_place_background**（必要时也可触发联网 WebSearch）。把检索到的有趣点融进口语，不要报网址、不要念「根据搜索结果」。
- **追问同一对象**：围绕本轮问题正常展开即可，篇幅不必刻意压短；可以补充直接相关的背景、典故、数据。硬约束只有两条——①不要复述上一轮已经讲过的介绍/评价/套话；②不要再报一遍方位距离（除非用户这轮明确问「在哪 / 多远 / 什么方向」）。开口先答本轮所问，再往外延展。
- 数值没有把握时说清是估算（如「大概三千五百米上下」），不要编造精确到个位的数字。
- **没有命中 / 工具为空 / 结果与所问不符时**：只用一两句短话带过（例如「这边暂时没查到附近的水库。」），不要解释检索过程、半径、数据来源、为什么找不到，也不要顺便推荐一堆别的景点来「填空」。`

/** OpenAI 风格 Tools，挂在 LLMConfig */
export const LUGE_VOICE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'normalize_user_utterance',
      description:
        '用户每轮说话后优先调用：预检是否为语气词/误触发，并对 ASR 听错的地名做上下文纠错。传入本轮 ASR 原文；可选传入你从【话题锚定】读到的景点名。',
      parameters: {
        type: 'object',
        properties: {
          utterance: {
            type: 'string',
            description: '本轮用户 ASR 原文（必填）',
          },
          topic_hint: {
            type: 'string',
            description: '可选。上下文【话题锚定】或刚讲解的景点专名',
          },
        },
        required: ['utterance'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_nearby_landmarks',
      description:
        '查询用户当前 GPS 周边的地理地标（风景、河流、湖泊、水库、桥梁、城镇、山脉等）。用户问附近/旁边/前面有什么、某地标是什么时，在 normalize_user_utterance 之后调用。经纬度与搜索半径由服务端决定；focus 只写用户关注的类型或专名（如「水库」「岷江」「雪山」），优先用纠错后的专名。',
      parameters: {
        type: 'object',
        properties: {
          focus: {
            type: 'string',
            description:
              '可选关注点：类型词（河/湖/水库/山）或专名。泛问「旁边有什么」可省略。',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'favorite_current_poi',
      description:
        '用户明确要求收藏/记住当前正在聊或刚讲解的景点时调用（如「收藏一下」「记住这个位置」「帮我收藏这个点」）。会创建或匹配足迹并标记收藏。不要用于普通问路。',
      parameters: {
        type: 'object',
        properties: {
          poi_name: {
            type: 'string',
            description:
              '要收藏的景点专名；优先【话题锚定】或刚讲过的名字。用户只说「这个」时可省略，服务端用话题锚定。',
          },
          utterance: {
            type: 'string',
            description: '可选。用户本轮原话，便于记入足迹。',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_place_background',
      description:
        '检索地名/景点的百科与背景资料（历史、典故、奇闻逸事、地理概况）。首次介绍重要地标，或用户追问历史/传说/典故/年代等时调用。query 用正确专名。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '要查的地名或景点专名，如「澜沧江」「卡子拉山」',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
]

/** 与火山控制台 StartVoiceChat 对齐，并挂 V3 Function Calling */
function buildWebSearchAgentConfig(): Record<string, unknown> {
  const apiKey = Deno.env.get('VOLC_WEB_SEARCH_API_KEY')?.trim()
  const botId = Deno.env.get('VOLC_WEB_SEARCH_BOT_ID')?.trim()
  // 火山官方：Enable + FunctionName/Description/ComfortWords；有 bot 凭证时再带 APIKey
  const cfg: Record<string, unknown> = {
    Enable: true,
    FunctionName: 'WebSearch',
    FunctionDescription:
      '检索互联网公开信息：地名历史典故、奇闻逸事、近年相关新闻、具体公开数据（海拔、建成年代等）。' +
      '首次介绍重要地标、或自身知识不够鲜活、或用户追问细节时调用；纯方位/旁边有什么不必搜。',
    ComfortWords: '我查一下相关资料，稍等。',
  }
  if (apiKey && botId) {
    cfg.APIKey = apiKey
    cfg.ParamsString = JSON.stringify({ bot_id: botId, stream: true })
  }
  return cfg
}

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
        HistoryLength: 16,
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
      // 1=仅手动打断（UpdateVoiceChat Interrupt）；0=语义打断（用户说话即可打断）
      InterruptMode: 1,
      SubtitleConfig: {
        DisableRTSSubtitle: false,
        SubtitleMode: 0,
      },
      FunctionCallingConfig: {
        ServerMessageUrl: CALLBACK_URL,
        ServerMessageSignature: opts.callbackSecret,
      },
      WebSearchAgentConfig: buildWebSearchAgentConfig(),
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
