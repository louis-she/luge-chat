import { useCallback, useEffect, useRef, useState } from 'react'
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
import { ensureScenicAroundLibrary } from './proactivePreview'
import { upsertScenicLibraryPois } from './scenicAroundCache'
import {
  loadSpokenPoiKeysToday,
  rememberProactiveSpoken,
} from './proactiveSpoken'
import {
  settingsToSpanConfig,
  scenicLibraryRadiusKm,
  type ProactiveGuideSettings,
} from './proactiveSettings'

type Options = {
  enabled: boolean
  coords: UserCoords | null
  busy: boolean
  settings: ProactiveGuideSettings
  runWhileThinking: (fn: () => Promise<void>) => Promise<boolean>
  onSpeak: (
    text: string,
    accessToken: string | null,
    meta?: {
      topicPoi?: string | null
      lat?: number | null
      lng?: number | null
    },
  ) => Promise<void>
  onQuotaRefresh: () => void
  onQuotaExhausted: (e: LugeChatQuotaError) => void
  /** 仅 __DEV__：地图 overlay（锚点 / 最近一次判定 POI） */
  onDevOverlay?: (state: ProactiveDevOverlay) => void
  /** 风景库有 upsert（主动讲补搜）后刷新黄点 */
  onScenicLibraryUpdated?: () => void
}

export type ProactiveForceResult =
  | { ok: true; spoken: boolean; skipReason?: string }
  | { ok: false; reason: string }

/**
 * 路鸽运行时：
 * 1) 搜索门槛（位移 + 距上次查询时间）→ 才打主动讲解 API
 * 2) 开口门槛（距上次播报时间）→ 才 TTS
 * 两套独立；搜索通过不等于一定会播。
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
  onScenicLibraryUpdated,
}: Options) {
  const snapshotRef = useRef<ProactiveSpanSnapshot>({
    anchor: null,
    lastSpeakAt: null,
  })
  const checkingRef = useRef(false)
  const seededRef = useRef(false)
  const forcePendingRef = useRef(false)
  const forcePoiRef = useRef<{
    name: string
    lat: number
    lng: number
    type?: string
  } | null>(null)
  const [forceNonce, setForceNonce] = useState(0)
  const [wakeNonce, setWakeNonce] = useState(0)
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const forceWaitersRef = useRef<Array<(r: ProactiveForceResult) => void>>([])
  const [gateHint, setGateHint] = useState('尚未建立锚点')
  const span = settingsToSpanConfig(settings)
  const spanRef = useRef(span)
  spanRef.current = span
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const busyRef = useRef(busy)
  busyRef.current = busy
  const coordsRef = useRef(coords)
  coordsRef.current = coords

  const resolveForceWaiters = useCallback((result: ProactiveForceResult) => {
    const waiters = forceWaitersRef.current
    forceWaitersRef.current = []
    for (const w of waiters) w(result)
  }, [])

  const clearWakeTimer = useCallback(() => {
    if (wakeTimerRef.current) {
      clearTimeout(wakeTimerRef.current)
      wakeTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      snapshotRef.current = { anchor: null, lastSpeakAt: null }
      seededRef.current = false
      setGateHint('主动讲解未启用或通话未就绪')
      return
    }
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
    setGateHint(
      `锚点已建 · 搜索门槛 ${spanRef.current.minDistanceKm}km / ${settingsRef.current.minCheckIntervalMin}分 · 开口冷却 ${settingsRef.current.minSpeakIntervalMin}分`,
    )
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
    const forced = forcePendingRef.current
    const forcedPoi = forcePoiRef.current
    if (forced) {
      forcePendingRef.current = false
      forcePoiRef.current = null
    }

    if (!enabled || !coords || checkingRef.current) {
      if (forced) {
        resolveForceWaiters({
          ok: false,
          reason: !enabled
            ? '主动讲解未启用或通话未就绪'
            : !coords
              ? '还没有定位'
              : '上一轮还在跑',
        })
      }
      return
    }
    if (!forced && busy) {
      setGateHint('正忙（思考/播报中），稍后重试搜索')
      return
    }

    const now = Date.now()
    if (!forced) {
      const gate = evaluateProactiveCheck(
        now,
        coords.latitude,
        coords.longitude,
        snapshotRef.current,
        spanRef.current,
      )
      if (gate.action === 'wait') {
        setGateHint(`等待搜索：${gate.reason}`)
        // 仅差时间门槛时：到点主动再评一次（不依赖 GPS 抖动）
        const anchor = snapshotRef.current.anchor
        if (anchor) {
          const remainMs =
            spanRef.current.minCheckIntervalMs - (now - anchor.checkedAt)
          if (remainMs > 50 && remainMs < spanRef.current.minCheckIntervalMs) {
            clearWakeTimer()
            wakeTimerRef.current = setTimeout(() => {
              wakeTimerRef.current = null
              setWakeNonce((n) => n + 1)
            }, remainMs + 30)
          }
        }
        return
      }
      setGateHint(`搜索门槛通过：${gate.reason}`)
    }

    clearWakeTimer()
    checkingRef.current = true
    const checkLat = coords.latitude
    const checkLng = coords.longitude
    const cfg = settingsRef.current

    void (async () => {
      let forceResult: ProactiveForceResult = {
        ok: true,
        spoken: false,
        skipReason: '未知',
      }
      try {
        if (__DEV__) {
          console.log(
            '[proactive] 准备查询',
            forcedPoi
              ? `Dev 指定「${forcedPoi.name}」`
              : forced
                ? 'Dev 强制'
                : '门槛通过',
          )
        }

        const ran = await runWhileThinking(async () => {
          // 锚点仅在真正开始干活时前移，避免 runWhileThinking 空跑白烧位移
          snapshotRef.current = {
            ...snapshotRef.current,
            anchor: anchorAfterCheck(checkLat, checkLng, Date.now()),
          }
          onDevOverlay?.({
            anchor: { lat: checkLat, lng: checkLng },
            spanRadiusKm: spanRef.current.minDistanceKm,
            lastEvent: null,
          })

          const session = await loadSession()
          const token = session?.access_token ?? null
          const spokenPoiKeys = forcedPoi ? [] : await loadSpokenPoiKeysToday()
          const libRadiusKm = scenicLibraryRadiusKm(cfg)
          const lib = await ensureScenicAroundLibrary(coords, {
            accessToken: token,
            scenicRadiusKm: libRadiusKm,
          })
          const result = await proactiveLugeGuide(coords, token, {
            spokenPoiKeys,
            speakLength: cfg.speakLength,
            scenicRadiusKm: libRadiusKm,
            geoRadiusPrefs: cfg.geoRadius,
            cachedScenicCandidates: lib.pois.map((p) => ({
              name: p.name,
              lat: p.lat,
              lng: p.lng,
              distance_m: p.distance_m,
              type: p.type,
              amap_poi_id: p.amap_poi_id ?? null,
            })),
            forcePoi: forcedPoi,
          })

          const upsertRows = result.scenic_library_upsert
          if (Array.isArray(upsertRows) && upsertRows.length > 0) {
            upsertScenicLibraryPois(
              upsertRows.map((p) => ({
                name: p.name,
                lat: p.lat,
                lng: p.lng,
                distance_m: p.distance_m ?? null,
                type: p.type,
                amap_poi_id: p.amap_poi_id ?? null,
              })),
              {
                centerLat: checkLat,
                centerLng: checkLng,
                radiusKm: libRadiusKm,
              },
            )
            onScenicLibraryUpdated?.()
          } else if (
            result.map_hit?.name &&
            result.map_hit.lat != null &&
            result.map_hit.lng != null
          ) {
            upsertScenicLibraryPois(
              [
                {
                  name: result.map_hit.name,
                  lat: result.map_hit.lat,
                  lng: result.map_hit.lng,
                  distance_m: result.map_hit.distance_m ?? null,
                  type: result.map_hit.category,
                  amap_poi_id: result.map_hit.amap_poi_id ?? null,
                },
              ],
              {
                centerLat: checkLat,
                centerLng: checkLng,
                radiusKm: libRadiusKm,
              },
            )
            onScenicLibraryUpdated?.()
          }

          if (result.skipped || !result.answer?.trim()) {
            if (__DEV__) {
              console.log('[proactive] 跳过讲解', result.skip_reason ?? '无内容')
            }
            setGateHint(
              `已搜索但未播：${result.skip_reason ?? '模型跳过/无内容'}`,
            )
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
            forceResult = {
              ok: true,
              spoken: false,
              skipReason: result.skip_reason ?? '模型决定不开口 / 无内容',
            }
            return
          }

          const speakAt = Date.now()
          if (
            !forced &&
            !canProactiveSpeak(speakAt, snapshotRef.current, spanRef.current)
          ) {
            if (__DEV__) console.log('[proactive] 有内容但处于开口冷却期')
            setGateHint(
              `已搜到可讲内容，但开口冷却中（${settingsRef.current.minSpeakIntervalMin} 分）`,
            )
            forceResult = {
              ok: true,
              spoken: false,
              skipReason: '开口冷却中（强制触发会绕过）',
            }
            return
          }

          await onSpeak(result.answer.trim(), token, {
            topicPoi: result.map_hit?.name ?? null,
            lat: result.map_hit?.lat ?? null,
            lng: result.map_hit?.lng ?? null,
          })
          if (
            result.map_hit?.name &&
            result.map_hit.lat != null &&
            result.map_hit.lng != null
          ) {
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
          setGateHint(
            `已播报${result.map_hit?.name ? `「${result.map_hit.name}」` : ''}`,
          )
          forceResult = { ok: true, spoken: true }
        })

        if (!ran) {
          setGateHint('搜索被跳过：会话正忙（未消耗位移锚点）')
          forceResult = {
            ok: false,
            reason: '会话正忙，请稍后再试',
          }
        }
      } catch (e) {
        if (e instanceof LugeChatQuotaError) {
          onQuotaExhausted(e)
          forceResult = { ok: false, reason: '今日次数用完' }
          setGateHint('次数用完')
          return
        }
        if (__DEV__) console.warn('[proactive]', e)
        forceResult = {
          ok: false,
          reason: e instanceof Error ? e.message : '请求失败',
        }
        setGateHint(`搜索失败：${forceResult.reason}`)
      } finally {
        checkingRef.current = false
        if (forced) resolveForceWaiters(forceResult)
      }
    })()
  }, [
    enabled,
    coords,
    coords?.latitude,
    coords?.longitude,
    busy,
    forceNonce,
    wakeNonce,
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
    onScenicLibraryUpdated,
    resolveForceWaiters,
    clearWakeTimer,
  ])

  useEffect(() => () => clearWakeTimer(), [clearWakeTimer])

  const forceTrigger = useCallback((): Promise<ProactiveForceResult> => {
    if (!__DEV__) {
      return Promise.resolve({ ok: false, reason: '仅开发模式可用' })
    }
    if (!enabledRef.current) {
      return Promise.resolve({
        ok: false,
        reason: '主动讲解未启用，或通话/会话尚未就绪',
      })
    }
    if (!coordsRef.current) {
      return Promise.resolve({ ok: false, reason: '还没有定位' })
    }
    if (checkingRef.current || forcePendingRef.current) {
      return Promise.resolve({ ok: false, reason: '上一轮还在跑，稍等' })
    }
    return new Promise((resolve) => {
      forceWaitersRef.current = [resolve]
      forcePoiRef.current = null
      forcePendingRef.current = true
      setForceNonce((n) => n + 1)
    })
  }, [])

  const forceSpeakPoi = useCallback(
    (poi: {
      name: string
      lat: number
      lng: number
      type?: string
    }): Promise<ProactiveForceResult> => {
      if (!__DEV__) {
        return Promise.resolve({ ok: false, reason: '仅开发模式可用' })
      }
      if (!enabledRef.current) {
        return Promise.resolve({
          ok: false,
          reason: '主动讲解未启用，或通话/会话尚未就绪',
        })
      }
      if (!coordsRef.current) {
        return Promise.resolve({ ok: false, reason: '还没有定位' })
      }
      if (checkingRef.current || forcePendingRef.current) {
        return Promise.resolve({ ok: false, reason: '上一轮还在跑，稍等' })
      }
      const name = poi.name.trim()
      if (!name || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) {
        return Promise.resolve({ ok: false, reason: 'POI 无效' })
      }
      return new Promise((resolve) => {
        forceWaitersRef.current = [resolve]
        forcePoiRef.current = {
          name,
          lat: poi.lat,
          lng: poi.lng,
          type: poi.type,
        }
        forcePendingRef.current = true
        setForceNonce((n) => n + 1)
      })
    },
    [],
  )

  return { forceTrigger, forceSpeakPoi, gateHint }
}
