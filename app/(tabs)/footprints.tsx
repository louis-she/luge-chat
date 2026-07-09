import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { loadSession } from '../../lib/auth'
import {
  fetchUserFootprints,
  footprintDialogRounds,
  footprintDisplayBody,
  footprintLastActiveAt,
  formatFootprintRoute,
  isFootprintFavorited,
  sortedVisits,
  type UserFootprint,
} from '../../lib/footprints'
import { colors, spacing } from '../../lib/theme'
import { FootprintsOverviewMap } from '../../components/FootprintsOverviewMap'

function FootprintCard({
  item,
  onPress,
}: {
  item: UserFootprint
  onPress: () => void
}) {
  const title = item.title.trim() || item.poi_name
  const body = footprintDisplayBody(item)
  const rounds = footprintDialogRounds(item)
  const visitCount = sortedVisits(item).length

  return (
    <Pressable
      style={({ pressed }) => [styles.storyCard, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <Text style={styles.storyRoute}>
        {formatFootprintRoute(footprintLastActiveAt(item))}
        {rounds > 1 ? ` · ${rounds} 轮对话` : ''}
        {visitCount > 1 ? ` · ${visitCount} 次到访` : ''}
      </Text>
      <Text style={styles.storyTitle}>
        {isFootprintFavorited(item) ? '收藏 · ' : ''}
        {title}
      </Text>
      <Text style={styles.storySummary} numberOfLines={3}>
        {body}
      </Text>
      <View style={styles.cardFooter}>
        <Text style={styles.replay}>查看详情</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.accent} />
      </View>
    </Pressable>
  )
}

export default function FootprintsScreen() {
  const router = useRouter()
  const [items, setItems] = useState<UserFootprint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'favorited'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const session = await loadSession()
      if (!session?.access_token) {
        setItems([])
        setError('登录后才会记录足迹')
        return
      }
      const data = await fetchUserFootprints(session.access_token)
      setItems(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const litCount = items.length
  const favoritedCount = items.filter(isFootprintFavorited).length
  const secretCount = items.reduce((n, f) => n + footprintDialogRounds(f), 0)
  const visibleItems =
    filter === 'favorited' ? items.filter(isFootprintFavorited) : items

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>足迹</Text>
        <Text style={styles.subtitle}>点亮足迹，重温路上的地理秘密</Text>

        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setFilter('all')}
            style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}
          >
            <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
              全部
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFilter('favorited')}
            style={[styles.filterChip, filter === 'favorited' && styles.filterChipActive]}
          >
            <Text
              style={[styles.filterText, filter === 'favorited' && styles.filterTextActive]}
            >
              收藏{favoritedCount > 0 ? ` (${favoritedCount})` : ''}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.mapTitle}>足迹地图</Text>
        <Text style={styles.mapMeta}>
          已点亮 {litCount} 个地点 · 收藏 {favoritedCount} 个 · {secretCount} 轮对话
        </Text>
        <Text style={styles.mapHint}>默认显示最近足迹的位置，你可以直接拖动地图查看别处</Text>
        <FootprintsOverviewMap
          items={items}
          onSelect={(item) => router.push(`/footprint/${item.id}`)}
        />

        <Text style={styles.section}>故事重温</Text>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={styles.loader} />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && visibleItems.length === 0 ? (
          <Text style={styles.empty}>
            {filter === 'favorited'
              ? '还没有收藏的足迹，在详情页点「收藏」即可加入'
              : '开启路鸽并提问，足迹会自动记录在这里'}
          </Text>
        ) : null}

        {visibleItems.map((item) => (
          <FootprintCard
            key={item.id}
            item={item}
            onPress={() => router.push(`/footprint/${item.id}`)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.lightBg },
  scroll: {
    padding: spacing.screen,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.lightText,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 14,
    color: colors.lightMuted,
    fontSize: 15,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.lightCard,
    borderWidth: 1,
    borderColor: '#e8edf4',
  },
  filterChipActive: {
    backgroundColor: 'rgba(96, 165, 250, 0.12)',
    borderColor: 'rgba(96, 165, 250, 0.45)',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.lightMuted,
  },
  filterTextActive: {
    color: colors.accent,
  },
  mapTitle: {
    color: colors.lightText,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  mapMeta: {
    color: colors.lightMuted,
    fontSize: 14,
  },
  mapHint: {
    marginTop: 8,
    marginBottom: 14,
    color: colors.lightMuted,
    fontSize: 12,
  },
  section: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.lightText,
    marginTop: 24,
    marginBottom: 12,
  },
  loader: { marginVertical: 24 },
  error: { color: '#dc2626', marginBottom: 12 },
  empty: { color: colors.lightMuted, lineHeight: 22 },
  storyCard: {
    backgroundColor: colors.lightCard,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e8edf4',
  },
  cardPressed: { opacity: 0.92 },
  storyRoute: {
    color: colors.lightMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  storyTitle: {
    color: colors.lightText,
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  storySummary: {
    color: colors.lightMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  cardFooter: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  replay: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
})
