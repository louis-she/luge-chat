import { useEffect, useRef } from 'react'
import { loadSession } from './auth'
import type { UserCoords } from './location'
import { setProactivePoiContext } from './proactiveContext'
import {
  anchorAfterCheck,
  canProactiveSpeak,
  DEFAULT_PROACTIVE_SPAN,
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

type Options = {
  enabled: boolean
  coords: UserCoords | null
  busy: boolean
  runWhileThinking: (fn: () => Promise<void>) => Promise<void>
  onSpeak: (text: string, accessToken: string | null) => Promise<void>
  onQuotaRefresh: () => void
  onQuotaExhausted: (e: LugeChatQuotaError) => void
  /** 仅 __DEV__：地图 overlay（锚点 / 最近一次判定 POI） */
  onDevOverlay?: (state: ProactiveDevOverlay) => void
}

/**
 * 路鸽运行时：按「位移 + 时间」双门槛触发主动讲解查询。
 * - 查询：距上次锚点 ≥20km 且距上次查询 ≥10min（可 env 配置）
 * - 开口：距上次朗读 ≥15min（即使查询有结果也可能暂不开口）
 * - 同一景点按上海日历日去重，当天不重复讲
 */
export function useProactiveGuide({
  enabled,
  coords,
  busy,
  runWhileThinking,
  onSpeak,
  onQuotaRefresh,
  onQuotaExhausted,
  onDevOverlay,
}: Options) {
  const snapshotRef = useRef<ProactiveSpanSnapshot>({ anchor: null, lastSpeakAt: null })
  const checkingRef = useRef(false)
  const seededRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      snapshotRef.current = { anchor: null, lastSpeakAt: null }
      seededRef.current = false
      return
    }
    if (!coords || seededRef.current) return
    snapshotRef.current = {
      anchor: anchorAfterCheck(coords.latitude, coords.longitude, Date.now()),
      lastSpeakAt: snapshotRef.current.lastSpeakAt,
    }
    seededRef.current = true
    if (__DEV__) {
      console.log('[proactive] 锚点已建立，等待位移与时间条件')
    }
    onDevOverlay?.({
      anchor: { lat: coords.latitude, lng: coords.longitude },
      spanRadiusKm: DEFAULT_PROACTIVE_SPAN.minDistanceKm,
      lastEvent: null,
    })
  }, [enabled, coords, onDevOverlay])

  useEffect(() => {
    if (!enabled || !coords || busy || checkingRef.current) return

    const now = Date.now()
    const gate = evaluateProactiveCheck(
      now,
      coords.latitude,
      coords.longitude,
      snapshotRef.current,
    )
    if (gate.action === 'wait') return

    checkingRef.current = true
    const checkLat = coords.latitude
    const checkLng = coords.longitude

    void (async () => {
      try {
        snapshotRef.current = {
          ...snapshotRef.current,
          anchor: anchorAfterCheck(checkLat, checkLng, Date.now()),
        }
        onDevOverlay?.({
          anchor: { lat: checkLat, lng: checkLng },
          spanRadiusKm: DEFAULT_PROACTIVE_SPAN.minDistanceKm,
          lastEvent: null,
        })

        if (__DEV__) console.log('[proactive] 发起查询', gate.reason)

        await runWhileThinking(async () => {
          const session = await loadSession()
          const token = session?.access_token ?? null
          const spokenPoiKeys = await loadSpokenPoiKeysToday()
          const result = await proactiveLugeGuide(coords, token, {
            spokenPoiKeys,
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
                spanRadiusKm: DEFAULT_PROACTIVE_SPAN.minDistanceKm,
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
          if (!canProactiveSpeak(speakAt, snapshotRef.current)) {
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
              spanRadiusKm: DEFAULT_PROACTIVE_SPAN.minDistanceKm,
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
    runWhileThinking,
    onSpeak,
    onQuotaRefresh,
    onQuotaExhausted,
    onDevOverlay,
  ])
}
