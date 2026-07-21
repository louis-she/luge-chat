/**
 * 火山 RN RTC 薄封装（路鸽音频-only）
 * 须 Dev Client / Release；Expo Go 不可用。
 */
import {
  AudioRoute,
  AudioScenarioType,
  ChannelProfile,
  RTCManager,
  type IEngine,
  type IRoom,
  type RTCRoomEventHandler,
  type RTCVideoEventHandler,
  type UserInfo,
} from '@volcengine/react-native-rtc'
import type { VolcRtcSession } from './volcVoiceChat'

export type VolcRtcJoinResult = {
  session: VolcRtcSession
  roomState: number
}

type StatusListener = (line: string) => void

function describeUser(userInfo: UserInfo | Record<string, unknown>): string {
  try {
    const anyInfo = userInfo as Record<string, unknown>
    const uid =
      (typeof anyInfo.userId === 'string' && anyInfo.userId) ||
      (typeof anyInfo.uid === 'string' && anyInfo.uid) ||
      (typeof (anyInfo as { getUserId?: () => string }).getUserId === 'function'
        ? (anyInfo as { getUserId: () => string }).getUserId()
        : '') ||
      '?'
    return String(uid)
  } catch {
    return '?'
  }
}

class VolcRtcClient {
  private manager = new RTCManager()
  private engine: IEngine | null = null
  private room: IRoom | null = null
  private session: VolcRtcSession | null = null
  private statusListeners = new Set<StatusListener>()

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private emit(line: string) {
    console.log('[volc-rtc]', line)
    for (const l of this.statusListeners) l(line)
  }

  get currentSession() {
    return this.session
  }

  get isInRoom() {
    return Boolean(this.room && this.session)
  }

  async joinAudioOnly(session: VolcRtcSession): Promise<VolcRtcJoinResult> {
    await this.leave()

    this.session = session
    this.emit(`createEngine appId=${session.app_id.slice(0, 8)}…`)
    this.engine = await this.manager.createRTCEngine({ appID: session.app_id })

    // 通话扬声器场景，避免媒体音量 / 听筒导致「没声」
    try {
      const scen = this.engine.setAudioScenario?.(
        AudioScenarioType.AUDIO_SCENARIO_HIGHQUALITY_CHAT,
      )
      this.emit(`setAudioScenario chat → ${scen}`)
    } catch (e) {
      this.emit(`setAudioScenario failed: ${String(e)}`)
    }
    try {
      const route = this.engine.setDefaultAudioRoute?.(
        AudioRoute.AUDIO_ROUTE_SPEAKERPHONE,
      )
      this.emit(`setDefaultAudioRoute speaker → ${route}`)
    } catch (e) {
      this.emit(`setDefaultAudioRoute failed: ${String(e)}`)
    }

    const videoHandlers: RTCVideoEventHandler = {
      onWarning: (warn) => this.emit(`engine warning: ${JSON.stringify(warn)}`),
      onError: (err) => this.emit(`engine error: ${JSON.stringify(err)}`),
      onAudioRouteChanged: (route) => this.emit(`audioRouteChanged → ${route}`),
    }
    this.engine.setRtcVideoEventHandler(videoHandlers)

    this.room = this.engine.createRTCRoom(session.room_id)
    if (!this.room) throw new Error('createRTCRoom returned null')

    const joined = new Promise<number>((resolve) => {
      const roomHandlers: RTCRoomEventHandler = {
        onRoomStateChanged: (
          _roomId: string,
          _uid: string,
          state: number,
          extraInfo: string,
        ) => {
          this.emit(`onRoomStateChanged state=${state} extra=${extraInfo}`)
          resolve(state)
        },
        onUserJoined: (userInfo) => {
          this.emit(`onUserJoined uid=${describeUser(userInfo as UserInfo)}`)
        },
        onUserLeave: (uid, reason) => {
          this.emit(`onUserLeave ${uid} reason=${reason}`)
        },
        onUserPublishStreamAudio: (roomId, uid, isPublish) => {
          this.emit(
            `onUserPublishStreamAudio uid=${uid} publish=${isPublish} room=${roomId}`,
          )
        },
      }
      this.room?.setRTCRoomEventHandler(roomHandlers)
    })

    this.emit(`joinRoom room=${session.room_id} user=${session.user_id}`)
    const code = this.room.joinRoom({
      token: session.token,
      userId: session.user_id,
      extras: {
        call_scene: 'LUGE_VOICE_CHAT',
      },
      roomConfigs: {
        profile: ChannelProfile.CHANNEL_PROFILE_CHAT,
        isAutoPublishAudio: true,
        isAutoPublishVideo: false,
        isAutoSubscribeAudio: true,
        isAutoSubscribeVideo: false,
      },
    })
    if (typeof code === 'number' && code !== 0) {
      throw new Error(`joinRoom returned ${code}`)
    }

    this.engine.startAudioCapture()
    this.emit('startAudioCapture')

    // 显式开麦推流（部分机型仅靠 autoPublish 不稳）
    try {
      const pub = this.room.publishStreamAudio?.(true)
      this.emit(`publishStreamAudio(true) → ${pub}`)
    } catch (e) {
      this.emit(`publishStreamAudio failed: ${String(e)}`)
    }

    const roomState = await Promise.race([
      joined,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error('joinRoom timeout 15s')), 15_000),
      ),
    ])

    if (roomState !== 0) {
      throw new Error(`进房失败 roomState=${roomState}`)
    }
    this.emit('进房成功（音频）')
    return { session, roomState }
  }

  setMicPublished(publish: boolean) {
    try {
      const pub = this.room?.publishStreamAudio?.(publish)
      this.emit(`publishStreamAudio(${publish}) → ${pub}`)
    } catch (e) {
      this.emit(`publishStreamAudio(${publish}) failed: ${String(e)}`)
    }
  }

  async leave() {
    try {
      this.room?.publishStreamAudio?.(false)
    } catch {
      /* ignore */
    }
    try {
      this.engine?.stopAudioCapture?.()
    } catch {
      /* ignore */
    }
    try {
      this.room?.leaveRoom()
    } catch {
      /* ignore */
    }
    try {
      this.room?.destroy()
    } catch {
      /* ignore */
    }
    this.room = null
    try {
      this.manager.destroyRTCEngine()
    } catch {
      /* ignore */
    }
    this.engine = null
    if (this.session) this.emit('已离房')
    this.session = null
  }
}

export const volcRtcClient = new VolcRtcClient()
