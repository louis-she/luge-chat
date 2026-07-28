/** 测绘/地图 POI 提供方抽象：业务只依赖此形状，便于换高德 / 天地图 / 其他。 */

export type MapProviderId = 'amap' | 'tianditu'

/** 语义类别 → 各厂商自己映射 types/dataTypes */
export type MapPoiCategory = 'scenic' | 'geo_landmark' | 'ask_nearby'

export type MapPoi = {
  id: string | null
  name: string
  /** 原始类型串（厂商格式） */
  type: string
  address: string
  lat: number
  lng: number
  distance_m: number | null
  rating: number | null
}

export type MapRegeoResult = {
  /** 给人看的地址上下文（可多行） */
  text: string | null
  formatted_address: string | null
  /** 逆地理附带的附近 POI（若有） */
  pois: MapPoi[]
}

export type MapAroundQuery = {
  lat: number
  lng: number
  radiusM: number
  category: MapPoiCategory
  keyword?: string
  limit?: number
}

export interface MapPoiProvider {
  readonly id: MapProviderId
  around(query: MapAroundQuery): Promise<MapPoi[]>
  regeo(lat: number, lng: number): Promise<MapRegeoResult>
}
