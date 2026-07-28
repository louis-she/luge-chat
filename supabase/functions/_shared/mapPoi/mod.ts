import { createAmapProvider } from './amap.ts'
import type { MapPoiProvider, MapProviderId } from './types.ts'

export type {
  MapAroundQuery,
  MapPoi,
  MapPoiCategory,
  MapPoiProvider,
  MapProviderId,
  MapRegeoResult,
} from './types.ts'

/**
 * 当前地图 POI 提供方。
 * 环境变量 `GEO_MAP_PROVIDER`：amap（默认）| tianditu（尚未实现）。
 */
export function getMapPoiProvider(): MapPoiProvider | null {
  const raw = (Deno.env.get('GEO_MAP_PROVIDER') ?? 'amap').trim().toLowerCase()
  const id = (raw === 'tianditu' ? 'tianditu' : 'amap') as MapProviderId

  if (id === 'tianditu') {
    console.warn(
      '[mapPoi] GEO_MAP_PROVIDER=tianditu 尚未实现，回退 amap。见 docs/product/core-flows.md',
    )
  }

  return createAmapProvider()
}
