import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { loadSession } from '../lib/auth'
import {
  fetchVisitMessages,
  formatVisitDateTime,
  sortedVisits,
  type FootprintMessage,
  type FootprintVisit,
  type UserFootprint,
} from '../lib/footprints'
import { colors } from '../lib/theme'

function VisitNode({
  visit,
  isFirst,
  isLast,
  expanded,
  messages,
  loading,
  onToggle,
  error,
}: {
  visit: FootprintVisit
  isFirst: boolean
  isLast: boolean
  expanded: boolean
  messages: FootprintMessage[] | null
  loading: boolean
  onToggle: () => void
  error: string | null
}) {
  const summary = visit.visit_summary.trim()
  const rounds = Math.floor(visit.message_count / 2)

  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        {!isFirst ? <View style={styles.lineTop} /> : null}
        <View style={[styles.dot, visit.status === 'active' && styles.dotActive]} />
        {!isLast ? <View style={styles.lineBottom} /> : null}
      </View>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.content, isLast && styles.contentLast, pressed && styles.contentPressed]}
      >
        <Text style={styles.time}>{formatVisitDateTime(visit.started_at)}</Text>
        <Text style={styles.summary}>{summary || '路鸽还在整理这次到访…'}</Text>
        <View style={styles.metaRow}>
          {rounds > 0 ? (
            <Text style={styles.meta}>{rounds} 轮对话</Text>
          ) : visit.status === 'active' ? (
            <Text style={styles.metaActive}>进行中</Text>
          ) : null}
          <Text style={styles.expandText}>{expanded ? '收起对话' : '展开完整对话'}</Text>
        </View>

        {expanded ? (
          <View style={styles.dialogWrap}>
            {loading ? <ActivityIndicator color={colors.accent} style={styles.dialogLoader} /> : null}
            {!loading && error ? <Text style={styles.dialogError}>{error}</Text> : null}
            {!loading && !error && messages?.length ? (
              messages.map((message) => (
                <View
                  key={message.id}
                  style={[
                    styles.bubble,
                    message.role === 'user' ? styles.userBubble : styles.assistantBubble,
                  ]}
                >
                  <Text style={styles.bubbleRole}>
                    {message.role === 'user' ? '你' : message.role === 'assistant' ? '路鸽' : '系统'}
                  </Text>
                  <Text style={styles.bubbleText}>{message.content.trim() || '（空白）'}</Text>
                </View>
              ))
            ) : null}
            {!loading && !error && messages && messages.length === 0 ? (
              <Text style={styles.dialogEmpty}>这次到访还没有保存完整对话</Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  )
}

export function VisitTimeline({ footprint }: { footprint: UserFootprint }) {
  const visits = sortedVisits(footprint)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [messageMap, setMessageMap] = useState<Record<string, FootprintMessage[] | undefined>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [errorMap, setErrorMap] = useState<Record<string, string | null>>({})
  if (!visits.length) {
    return <Text style={styles.empty}>暂无到访记录</Text>
  }

  async function toggleVisit(visitId: string) {
    if (expandedId === visitId) {
      setExpandedId(null)
      return
    }

    setExpandedId(visitId)
    if (messageMap[visitId]) return

    setLoadingId(visitId)
    setErrorMap((prev) => ({ ...prev, [visitId]: null }))
    try {
      const session = await loadSession()
      if (!session?.access_token) {
        throw new Error('请先登录后查看完整对话')
      }
      const messages = await fetchVisitMessages(session.access_token, visitId)
      setMessageMap((prev) => ({ ...prev, [visitId]: messages }))
    } catch (e) {
      setErrorMap((prev) => ({
        ...prev,
        [visitId]: e instanceof Error ? e.message : '加载完整对话失败',
      }))
    } finally {
      setLoadingId((current) => (current === visitId ? null : current))
    }
  }

  return (
    <View style={styles.list}>
      {visits.map((visit, index) => (
        <VisitNode
          key={visit.id}
          visit={visit}
          isFirst={index === 0}
          isLast={index === visits.length - 1}
          expanded={expandedId === visit.id}
          messages={messageMap[visit.id] ?? null}
          loading={loadingId === visit.id}
          error={errorMap[visit.id] ?? null}
          onToggle={() => void toggleVisit(visit.id)}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  list: {
    paddingTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  rail: {
    width: 24,
    alignItems: 'center',
  },
  lineTop: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: 14,
    backgroundColor: '#dbeafe',
  },
  lineBottom: {
    position: 'absolute',
    top: 20,
    bottom: 0,
    width: 2,
    backgroundColor: '#dbeafe',
  },
  dot: {
    marginTop: 12,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#dbeafe',
  },
  dotActive: {
    backgroundColor: '#34d399',
    borderColor: '#d1fae5',
  },
  content: {
    flex: 1,
    paddingBottom: 20,
    paddingLeft: 8,
  },
  contentPressed: {
    opacity: 0.92,
  },
  contentLast: {
    paddingBottom: 4,
  },
  time: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
    marginBottom: 4,
  },
  summary: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.lightText,
  },
  meta: {
    marginTop: 6,
    fontSize: 12,
    color: colors.lightMuted,
  },
  metaActive: {
    marginTop: 6,
    fontSize: 12,
    color: '#059669',
    fontWeight: '600',
  },
  metaRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  expandText: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '600',
  },
  dialogWrap: {
    marginTop: 12,
    gap: 8,
  },
  dialogLoader: {
    marginVertical: 8,
  },
  dialogError: {
    fontSize: 13,
    color: '#dc2626',
    lineHeight: 20,
  },
  dialogEmpty: {
    fontSize: 13,
    color: colors.lightMuted,
    lineHeight: 20,
  },
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '90%',
    backgroundColor: 'rgba(96, 165, 250, 0.12)',
    borderColor: 'rgba(96, 165, 250, 0.24)',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    maxWidth: '94%',
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  bubbleRole: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.lightMuted,
    marginBottom: 4,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.lightText,
  },
  empty: {
    color: colors.lightMuted,
    fontSize: 14,
    lineHeight: 20,
  },
})
