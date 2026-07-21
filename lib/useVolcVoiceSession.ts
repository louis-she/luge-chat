import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSession } from './auth'
import { ensureLocationPermission, peekUserCoords, readUserCoords } from './location'
import { getSpeechRecognitionModule } from './speechRecognition'
import { volcRtcClient } from './volcRtcClient'
import {
  createVolcRtcSession,
  reportVolcVoiceLocation,
  speakExternalVolcVoice,
  startVolcVoiceChat,
  stopVolcVoiceChat,
  VolcVoiceQuotaError,
  type VolcRtcSession,
} from './volcVoiceChat'
import type { QuotaExhaustedPayload } from './quota'

export type VolcJoinResult =
  | { ok: true }
  | { ok: false; message: string }
  | { ok: false; quota: QuotaExhaustedPayload }

/** 与 FC 会话坐标同步间隔 */
export const GPS_REPORT_INTERVAL_MS = 3_000

export function useVolcVoiceSession() {
  const [busy, setBusy] = useState(false)
  const [inCall, setInCall] = useState(false)
  const sessionRef = useRef<VolcRtcSession | null>(null)
  const taskIdRef = useRef<string | null>(null)
  const locTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopLocLoop = useCallback(() => {
    if (locTimerRef.current) {
      clearInterval(locTimerRef.current)
      locTimerRef.current = null
    }
  }, [])

  const accessTokenRef = useRef<string | null>(null)

  const refreshAccessToken = useCallback(async () => {
    const session = await loadSession()
    accessTokenRef.current = session?.access_token ?? null
    return accessTokenRef.current
  }, [])

  const pushLocationOnce = useCallback(async (s: VolcRtcSession, taskId: string) => {
    const ok = await ensureLocationPermission()
    if (!ok) return
    const coords = peekUserCoords() ?? (await readUserCoords())
    await reportVolcVoiceLocation({
      roomId: s.room_id,
      taskId,
      userId: s.user_id,
      lat: coords.latitude,
      lng: coords.longitude,
      heading: coords.heading,
      accessToken: accessTokenRef.current,
    })
  }, [])

  const startLocLoop = useCallback(
    (s: VolcRtcSession, taskId: string) => {
      stopLocLoop()
      void pushLocationOnce(s, taskId).catch((e) => {
        if (__DEV__) console.warn('[volc gps]', e)
      })
      locTimerRef.current = setInterval(() => {
        void pushLocationOnce(s, taskId).catch(() => {})
      }, GPS_REPORT_INTERVAL_MS)
    },
    [pushLocationOnce, stopLocLoop],
  )

  const leave = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      stopLocLoop()
      const t = taskIdRef.current
      const s = sessionRef.current
      if (t && s) {
        await stopVolcVoiceChat({
          roomId: s.room_id,
          taskId: t,
          accessToken: accessTokenRef.current,
        })
      }
      await volcRtcClient.leave()
    } catch (e) {
      if (__DEV__) console.warn('[volc leave]', e)
    } finally {
      sessionRef.current = null
      taskIdRef.current = null
      setInCall(false)
      setBusy(false)
    }
  }, [busy, stopLocLoop])

  /** 进房 + StartVoiceChat */
  const join = useCallback(async (): Promise<VolcJoinResult> => {
    if (busy || inCall) return { ok: false, message: '正在连接中，请稍候' }
    setBusy(true)
    try {
      const mod = getSpeechRecognitionModule()
      if (mod?.requestPermissionsAsync) {
        const perm = await mod.requestPermissionsAsync()
        if (!perm.granted) {
          return { ok: false, message: '需要麦克风权限才能开始路鸽通话' }
        }
      }

      const accessToken = await refreshAccessToken()

      const s = await createVolcRtcSession({ accessToken })
      sessionRef.current = s
      await volcRtcClient.joinAudioOnly(s)

      const task = await startVolcVoiceChat({
        roomId: s.room_id,
        userId: s.user_id,
        accessToken,
      })
      taskIdRef.current = task.task_id
      startLocLoop(s, task.task_id)
      setInCall(true)
      return { ok: true }
    } catch (e) {
      stopLocLoop()
      try {
        await volcRtcClient.leave()
      } catch {
        /* ignore */
      }
      sessionRef.current = null
      taskIdRef.current = null
      setInCall(false)
      if (e instanceof VolcVoiceQuotaError) {
        return { ok: false, quota: e.payload }
      }
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('timeout')) return { ok: false, message: '连接超时，请检查网络后重试' }
      if (msg.includes('进房')) return { ok: false, message: '进房失败，请稍后再试' }
      return { ok: false, message: msg || '无法启动语音通话' }
    } finally {
      setBusy(false)
    }
  }, [busy, inCall, startLocLoop, stopLocLoop, refreshAccessToken])

  const setMicEnabled = useCallback((enabled: boolean) => {
    try {
      volcRtcClient.setMicPublished(enabled)
    } catch (e) {
      if (__DEV__) console.warn('[volc mic]', e)
    }
  }, [])

  const speakExternal = useCallback(async (text: string): Promise<boolean> => {
    const t = text.trim()
    const s = sessionRef.current
    const taskId = taskIdRef.current
    if (!t || !s || !taskId || !inCall) return false
    try {
      await speakExternalVolcVoice({
        roomId: s.room_id,
        taskId,
        text: t,
        interruptMode: 2,
        accessToken: accessTokenRef.current,
      })
      return true
    } catch (e) {
      if (__DEV__) console.warn('[volc proactive tts]', e)
      return false
    }
  }, [inCall])

  useEffect(() => {
    return () => {
      stopLocLoop()
      void (async () => {
        const t = taskIdRef.current
        const s = sessionRef.current
        if (t && s) await stopVolcVoiceChat({ roomId: s.room_id, taskId: t })
        await volcRtcClient.leave()
      })()
    }
  }, [stopLocLoop])

  return {
    busy,
    inCall,
    join,
    leave,
    setMicEnabled,
    speakExternal,
  }
}
