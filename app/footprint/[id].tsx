import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { FootprintMap } from '../../components/FootprintMap'
import { VisitTimeline } from '../../components/VisitTimeline'
import { loadSession } from '../../lib/auth'
import {
  fetchFootprintById,
  footprintDialogRounds,
  footprintPoiTypeLabel,
  formatCoordinates,
  formatFootprintRoute,
  footprintLastActiveAt,
  isFootprintFavorited,
  setFootprintFavorite,
  setFootprintTitle,
  sortedVisits,
  type UserFootprint,
} from '../../lib/footprints'
import { colors, spacing } from '../../lib/theme'

export default function FootprintDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [item, setItem] = useState<UserFootprint | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [titleBusy, setTitleBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) {
      setError('足迹不存在')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const session = await loadSession()
      if (!session?.access_token) {
        setError('请先登录')
        return
      }
      const data = await fetchFootprintById(session.access_token, id)
      if (!data) {
        setError('足迹不存在或已被删除')
        return
      }
      setItem(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const title = item ? item.title.trim() || item.poi_name : ''
  const description = item
    ? item.summary.trim() ||
      sortedVisits(item)
        .map((v) => v.visit_summary.trim())
        .filter(Boolean)
        .join('\n\n') ||
      '路鸽还在整理这段回忆…'
    : ''
  const rounds = item ? footprintDialogRounds(item) : 0
  const visitCount = item?.visits.length ?? 0
  const favorited = item ? isFootprintFavorited(item) : false

  const toggleFavorite = useCallback(async () => {
    if (!item || favoriteBusy) return
    setFavoriteBusy(true)
    try {
      const session = await loadSession()
      if (!session?.access_token) {
        setError('请先登录')
        return
      }
      const next = !favorited
      const favoritedAt = await setFootprintFavorite(session.access_token, item.id, next)
      setItem({ ...item, favorited_at: favoritedAt })
    } catch (e) {
      setError(e instanceof Error ? e.message : '收藏失败')
    } finally {
      setFavoriteBusy(false)
    }
  }, [item, favorited, favoriteBusy])

  const startEditTitle = useCallback(() => {
    if (!item) return
    setTitleDraft(item.title.trim() || item.poi_name)
    setEditingTitle(true)
  }, [item])

  const cancelEditTitle = useCallback(() => {
    setEditingTitle(false)
    setTitleDraft('')
  }, [])

  const saveTitle = useCallback(async () => {
    if (!item || titleBusy) return
    const next = titleDraft.trim()
    if (!next) {
      setError('标题不能为空')
      return
    }
    setTitleBusy(true)
    setError(null)
    try {
      const session = await loadSession()
      if (!session?.access_token) {
        setError('请先登录')
        return
      }
      const saved = await setFootprintTitle(session.access_token, item.id, next)
      setItem({ ...item, title: saved })
      setEditingTitle(false)
      setTitleDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存标题失败')
    } finally {
      setTitleBusy(false)
    }
  }, [item, titleBusy, titleDraft])

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && styles.backPressed]}
          accessibilityLabel="返回"
        >
          <Ionicons name="chevron-back" size={24} color={colors.lightText} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          足迹详情
        </Text>
        <Pressable
          onPress={() => void toggleFavorite()}
          disabled={!item || favoriteBusy}
          style={({ pressed }) => [
            styles.favoriteBtn,
            pressed && styles.favoritePressed,
            favorited && styles.favoriteBtnActive,
          ]}
          accessibilityLabel={favorited ? '取消收藏' : '收藏'}
        >
          <Text style={[styles.favoriteBtnText, favorited && styles.favoriteBtnTextActive]}>
            {favorited ? '已收藏' : '收藏'}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {item ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.meta}>
            {formatFootprintRoute(footprintLastActiveAt(item))}
            {rounds > 0 ? ` · ${rounds} 轮对话` : ''}
            {visitCount > 1 ? ` · ${visitCount} 次到访` : ''}
          </Text>
          {editingTitle ? (
            <View style={styles.titleEditBox}>
              <TextInput
                value={titleDraft}
                onChangeText={setTitleDraft}
                placeholder="足迹标题"
                placeholderTextColor={colors.lightMuted}
                style={styles.titleInput}
                maxLength={80}
                autoFocus
                editable={!titleBusy}
              />
              <View style={styles.titleEditActions}>
                <Pressable
                  onPress={cancelEditTitle}
                  disabled={titleBusy}
                  style={({ pressed }) => [styles.titleEditBtn, pressed && styles.titleEditPressed]}
                >
                  <Text style={styles.titleEditBtnTextMuted}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={() => void saveTitle()}
                  disabled={titleBusy}
                  style={({ pressed }) => [
                    styles.titleEditBtn,
                    styles.titleEditBtnPrimary,
                    pressed && styles.titleEditPressed,
                  ]}
                >
                  {titleBusy ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.titleEditBtnTextPrimary}>保存</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.titleRow}>
              <Text style={styles.title}>{title}</Text>
              <Pressable
                onPress={startEditTitle}
                style={({ pressed }) => [styles.editTitleBtn, pressed && styles.titleEditPressed]}
              >
                <Text style={styles.editTitleText}>改标题</Text>
              </Pressable>
            </View>
          )}
          <Text style={styles.poi}>
            {footprintPoiTypeLabel(item.poi_type)} · {item.poi_name}
          </Text>

          <Text style={styles.sectionLabel}>描述</Text>
          <Text style={styles.description}>{description}</Text>

          {item.lat != null && item.lng != null ? (
            <>
              <Text style={styles.sectionLabel}>位置</Text>
              <FootprintMap
                latitude={item.lat}
                longitude={item.lng}
                label={formatCoordinates(item.lat, item.lng)}
              />
            </>
          ) : (
            <View style={styles.noMap}>
              <Text style={styles.noMapText}>暂无坐标信息</Text>
            </View>
          )}

          <Text style={styles.sectionLabel}>到访记录</Text>
          <VisitTimeline footprint={item} />
        </ScrollView>
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.lightBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screen - 4,
    paddingBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  backPressed: {
    opacity: 0.7,
    backgroundColor: 'rgba(17, 24, 39, 0.06)',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: colors.lightText,
  },
  favoriteBtn: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e8edf4',
    backgroundColor: colors.lightCard,
    alignItems: 'center',
  },
  favoriteBtnActive: {
    borderColor: 'rgba(96, 165, 250, 0.45)',
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
  },
  favoritePressed: {
    opacity: 0.88,
  },
  favoriteBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.lightMuted,
  },
  favoriteBtnTextActive: {
    color: colors.accent,
  },
  loader: {
    marginTop: 40,
  },
  error: {
    marginHorizontal: spacing.screen,
    marginTop: 16,
    color: '#dc2626',
    fontSize: 14,
  },
  scroll: {
    paddingHorizontal: spacing.screen,
    paddingBottom: 32,
  },
  meta: {
    color: colors.lightMuted,
    fontSize: 12,
    marginBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  title: {
    flex: 1,
    fontSize: 26,
    fontWeight: '700',
    color: colors.lightText,
  },
  editTitleBtn: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e8edf4',
    backgroundColor: colors.lightCard,
  },
  editTitleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  titleEditBox: {
    marginBottom: 6,
    gap: 10,
  },
  titleInput: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    backgroundColor: colors.lightCard,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '600',
    color: colors.lightText,
  },
  titleEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  titleEditBtn: {
    minWidth: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e8edf4',
    backgroundColor: colors.lightCard,
    alignItems: 'center',
  },
  titleEditBtnPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  titleEditPressed: {
    opacity: 0.88,
  },
  titleEditBtnTextMuted: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.lightMuted,
  },
  titleEditBtnTextPrimary: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  poi: {
    fontSize: 14,
    color: colors.lightMuted,
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.lightMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 8,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.lightText,
    marginBottom: 16,
  },
  noMap: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e8edf4',
    backgroundColor: colors.lightCard,
    padding: 20,
    marginBottom: 16,
  },
  noMapText: {
    color: colors.lightMuted,
    fontSize: 14,
    textAlign: 'center',
  },
})
