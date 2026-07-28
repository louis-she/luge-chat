import { useEffect, useRef } from 'react'
import { loadSession } from './auth'
import type { UserCoords } from './location'
import { setProactivePoiContext } from './proactiveContext'
import {
  anchorAfterCheck,
  canProactiveSpeak,
  evaluateProactiveCheck,
  type ProactiveSpanSnapshot,
} from './proactiveSpan'
import type { ProactiveDevOverlay } from './proactiveMapDev'
import {
  LugeChatQuotaError,
  proactiveLugeGuide,
} from './lugeChat'
import {
  loadSpokenPoiKeysToday,
  rememberProactiveSpoken,
} from './proactiveSpoken'
import {
  settingsToSpanConfig,
  type ProactiveGuideSettings,
} from './proactiveSettings'

type Options = {
  enabled: boolean
  coords: UserCoords | null
  busy: boolean
  settings: ProactiveGuideSettings
  runWhileThinking: (fn: () => Promise<void>) => Promise<void>
  onSpeak: (text: string, accessToken: string | null) => Promise<void>
  onQuotaRefresh: () => void
  onQuotaExhausted: (e: LugeChatQuotaError) => void
  /** 仅 __DEV__：地图 overlay（锚点 / 最近一次判定 POI） */
  onDevOverlay?: (state: ProactiveDevOverlay) => void
}

/**
 * 路鸽运行时：按「位移 + 时间」双门槛触发主动讲解查询。
 * 门槛数字来自「我的 → 高级设置」（SecureStore），改完立即生效。
 */
export function useProactiveGuide({
  enabled,
  coords,
  busy,
  settings,
  runWhileThinking,
  onSpeak,
  onQuotaRefresh,
  onQuotaExhausted,
  onDevOverlay,
}: Options) {
  const snapshotRef = useRef<ProactiveSpanSnapshot>({ anchor: null, lastSpeakAt: null })
  const checkingRef = useRef(false)
  const seededRef = useRef(false)
  const span = settingsToSpanConfig(settings)
  const spanRef = useRef(span)
  spanRef.current = span
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    if (!enabled) {
      snapshotRef.current = { anchor: null, lastSpeakAt: null }
      seededRef.current = false
      return
    }
    // anchorNonce 变化 → 强制重锚
    seededRef.current = false
  }, [enabled, settings.anchorNonce])

  useEffect(() => {
    if (!enabled) return
    if (!coords || seededRef.current) return
    snapshotRef.current = {
      anchor: anchorAfterCheck(coords.latitude, coords.longitude, Date.now()),
      lastSpeakAt: snapshotRef.current.lastSpeakAt,
    }
    seededRef.current = true
    if (__DEV__) {
      console.log('[proactive] 锚点已建立', {
        km: spanRef.current.minDistanceKm,
        checkMin: settingsRef.current.minCheckIntervalMin,
        speakMin: settingsRef.current.minSpeakIntervalMin,
      })
    }
    onDevOverlay?.({
      anchor: { lat: coords.latitude, lng: coords.longitude },
      spanRadiusKm: spanRef.current.minDistanceKm,
      lastEvent: null,
    })
  }, [enabled, coords, settings.anchorNonce, onDevOverlay])

  useEffect(() => {
    if (!enabled || !coords || busy || checkingRef.current) return

    const now = Date.now()
    const gate = evaluateProactiveCheck(
      now,
      coords.latitude,
      coords.longitude,
      snapshotRef.current,
      spanRef.current,
    )
    if (gate.action === 'wait') return

    checkingRef.current = true
    const checkLat = coords.latitude
    const checkLng = coords.longitude
    const cfg = settingsRef.current

    void (async () => {
      try {
        snapshotRef.current = {
          ...snapshotRef.current,
          anchor: anchorAfterCheck(checkLat, checkLng, Date.now()),
        }
        onDevOverlay?.({
          anchor: { lat: checkLat, lng: checkLng },
          spanRadiusKm: spanRef.current.minDistanceKm,
          lastEvent: null,
        })

        if (__DEV__) console.log('[proactive] 发起查询', gate.reason)

        await runWhileThinking(async () => {
          const session = await loadSession()
          const token = session?.access_token ?? null
          const spokenPoiKeys = await loadSpokenPoiKeysToday()
          const result = await proactiveLugeGuide(coords, token, {
            spokenPoiKeys,
            speakLength: cfg.speakLength,
            scenicRadiusKm: cfg.scenicRadiusKm,
          })

          if (result.skipped || !result.answer?.trim()) {
            if (__DEV__) {
              console.log('[proactive] 跳过讲解', result.skip_reason ?? '无内容')
            }
            const hit = result.map_hit
            if (hit?.lat != null && hit?.lng != null) {
              onDevOverlay?.({
                anchor: {
                  lat: snapshotRef.current.anchor?.lat ?? checkLat,
                  lng: snapshotRef.current.anchor?.lng ?? checkLng,
                },
                spanRadiusKm: spanRef.current.minDistanceKm,
                lastEvent: {
                  lat: hit.lat,
                  lng: hit.lng,
                  name: hit.name,
                  status: 'skipped',
                  reason: result.skip_reason ?? undefined,
                },
              })
            }
            return
          }

          const speakAt = Date.now()
          if (!canProactiveSpeak(speakAt, snapshotRef.current, spanRef.current)) {
            if (__DEV__) console.log('[proactive] 有内容但处于开口冷却期')
            return
          }

          await onSpeak(result.answer.trim(), token)
          if (result.map_hit?.name && result.map_hit.lat != null && result.map_hit.lng != null) {
            await rememberProactiveSpoken({
              name: result.map_hit.name,
              amapPoiId: result.map_hit.amap_poi_id,
            })
            setProactivePoiContext({
              poi_name: result.map_hit.name,
              amap_poi_id: result.map_hit.amap_poi_id ?? null,
              lat: result.map_hit.lat,
              lng: result.map_hit.lng,
              category: result.map_hit.category,
            })
            onDevOverlay?.({
              anchor: {
                lat: snapshotRef.current.anchor?.lat ?? checkLat,
                lng: snapshotRef.current.anchor?.lng ?? checkLng,
              },
              spanRadiusKm: spanRef.current.minDistanceKm,
              lastEvent: {
                lat: result.map_hit.lat,
                lng: result.map_hit.lng,
                name: result.map_hit.name,
                status: 'spoken',
              },
            })
          }
          snapshotRef.current = {
            ...snapshotRef.current,
            lastSpeakAt: Date.now(),
          }
          if (result.quota) onQuotaRefresh()
        })
      } catch (e) {
        if (e instanceof LugeChatQuotaError) {
          onQuotaExhausted(e)
          return
        }
        if (__DEV__) console.warn('[proactive]', e)
      } finally {
        checkingRef.current = false
      }
    })()
  }, [
    enabled,
    coords,
    coords?.latitude,
    coords?.longitude,
    busy,
    settings.minDistanceKm,
    settings.minCheckIntervalMin,
    settings.minSpeakIntervalMin,
    settings.speakLength,
    settings.scenicRadiusKm,
    runWhileThinking,
    onSpeak,
    onQuotaRefresh,
    onQuotaExhausted,
    onDevOverlay,
  ])
}
