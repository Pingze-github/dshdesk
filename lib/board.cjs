'use strict'

/**
 * Pure attention-board model shared by the browser bundle and the host tests.
 *
 * The board is derived, never authored. `dshdesk` deliberately has no write
 * path for a card's column: a session belongs to exactly one of
 * needs / running / review / done according to DSH's own status facts.
 */

const COLUMN_KEYS = ['needs', 'running', 'review', 'done']

const LABELS = {
  zh: {
    title: '现在有没有事需要我',
    subtitle: '会话状态实时推导 · 只读',
    needs: '需要你',
    running: '进行中',
    review: '验收',
    done: '完成',
    empty: '暂无',
    current: '当前',
    cardNeeds: '需要你',
    cardRunning: '进行中',
    cardReview: '待验收',
    cardDone: '已完成',
    approval: '待审批',
    planReview: '计划待审',
    question: '待回答',
    unknown: '需要你',
    total: '{count} 项',
    dotNeeds: '需要你 {count}',
    dotReview: '验收 {count}',
    board: '工作台',
    close: '关闭',
    pin: '钉成置顶小窗',
    pinUnavailable: '网页中不提供置顶窗',
    pinFailed: '置顶窗打开失败',
    notificationNeeds: '需要你 · DSH',
    notificationReview: '验收 · DSH',
    notificationBody: '《{title}》 · {project}',
    stale: '主窗 6 秒未同步，正在关闭…',
    waiting: '等待主窗同步…',
    opacity: '透明度',
    alwaysOnTop: '置顶',
    unpin: '取消置顶'
  },
  en: {
    title: 'Anything needing me right now?',
    subtitle: 'Derived live from session state · read-only',
    needs: 'Needs you',
    running: 'In progress',
    review: 'Review',
    done: 'Done',
    empty: 'Nothing here',
    current: 'Current',
    cardNeeds: 'Needs you',
    cardRunning: 'In progress',
    cardReview: 'To review',
    cardDone: 'Done',
    approval: 'Approval',
    planReview: 'Plan review',
    question: 'Question',
    unknown: 'Needs you',
    total: '{count} items',
    dotNeeds: 'Needs you {count}',
    dotReview: 'Review {count}',
    board: 'Workbench',
    close: 'Close',
    pin: 'Pin as always-on-top window',
    pinUnavailable: 'No always-on-top window in a browser',
    pinFailed: 'Could not open the pinned window',
    notificationNeeds: 'Needs you · DSH',
    notificationReview: 'Review · DSH',
    notificationBody: '"{title}" · {project}',
    stale: 'No main-window sync for 6 s; closing…',
    waiting: 'Waiting for the main window…',
    opacity: 'Opacity',
    alwaysOnTop: 'Always on top',
    unpin: 'Stop always on top'
  }
}

const DEFAULT_THEME = {
  dark: false,
  bg: '#ffffff',
  layer1: '#ffffff',
  layer2: '#f5f6f7',
  sidebar: '#f9fafb',
  labelPrimary: '#0f1115',
  labelSecondary: '#545557',
  labelTertiary: '#81858c',
  border: '#1a000000',
  accent: '#4176e6',
  amber: '#f59e0b',
  green: '#22c55e',
  idle: '#d4d4d4',
  red: '#ec1313'
}

const THEME_KEYS = Object.keys(DEFAULT_THEME).filter((key) => key !== 'dark')

/** Detect a short locale tag. */
function normalizeLocale(value) {
  return String(value || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** Look up a label with `{placeholder}` interpolation. */
function labelFor(locale, key, params) {
  const dictionary = LABELS[normalizeLocale(locale)] || LABELS.zh
  const template = dictionary[key] ?? LABELS.zh[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] === undefined || params[name] === null ? '' : String(params[name])
  )
}

/** Return a complete label dictionary for one locale. */
function labelsFor(locale) {
  const dictionary = LABELS[normalizeLocale(locale)] || LABELS.zh
  return { ...dictionary }
}

/** Resolve a label function for the customer-facing snapshot. */
function translator(locale) {
  return (key, params) => labelFor(locale, key, params)
}

/** A path's last segment, accepting both POSIX and Windows separators. */
function basename(path) {
  const text = String(path || '').replace(/[\\/]+$/u, '')
  if (text === '') return ''
  const parts = text.split(/[\\/]+/u)
  return parts[parts.length - 1] || text
}

/** Cap a string and strip control characters that would corrupt a WPF run. */
function cleanText(value, maxLength) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`
}

/** Relative time for cards; recomputed by each surface against its own clock. */
function relativeTime(updatedAt, now, locale) {
  const then = Number(updatedAt)
  const current = Number(now)
  if (!Number.isFinite(then) || then <= 0 || !Number.isFinite(current)) {
    return labelFor(locale, 'empty')
  }
  const diff = Math.max(0, current - then)
  const minutes = Math.floor(diff / 60000)
  const zh = normalizeLocale(locale) === 'zh'
  if (minutes < 1) return zh ? '刚刚' : 'now'
  if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return zh ? `${days} 天前` : `${days}d ago`
  const date = new Date(then)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Resolve the project label from workspace membership, path, or cwd. */
function projectFor(summary, workspaces) {
  const list = Array.isArray(workspaces?.items) ? workspaces.items : []
  for (const workspace of list) {
    if (workspace && Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(summary.id)) {
      return cleanText(workspace.title || basename(workspace.path), 120)
    }
  }
  for (const workspace of list) {
    if (workspace && summary.cwd && workspace.path && summary.cwd === workspace.path) {
      return cleanText(workspace.title || basename(workspace.path), 120)
    }
  }
  return cleanText(basename(summary.cwd) || '—', 120)
}

/** Pending interactions are all "needs you"; the label names the domain. */
function pendingLabel(status, t) {
  const kind = status?.pendingInteraction?.kind
  if (kind === 'approval') return t('approval')
  if (kind === 'plan-review') return t('planReview')
  if (kind === 'question') return t('question')
  return t('unknown')
}

/** Determine a session's single board column. */
function classify(summary, status) {
  if (status?.pendingInteraction) return 'needs'
  const running = status?.running === undefined ? summary?.running === true : status.running === true
  if (running) return 'running'
  if (status?.completionUnread === true) return 'review'
  return 'done'
}

/** Stable comparator: current first, then recent activity, then title. */
function compareCards(left, right) {
  if (left.current !== right.current) return left.current ? -1 : 1
  if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt
  return left.title.localeCompare(right.title)
}

/**
 * Derive the entire board.
 *
 * @param {object} input
 * @param {{ids?: string[], byId?: Record<string, object>}} input.sessions
 * @param {Map<string, object>|Record<string, object>} input.statuses
 * @param {{items?: object[], archivedSessionIds?: string[]}} input.workspaces
 * @param {string|undefined} input.currentSessionId
 * @param {'zh'|'en'|string} input.locale
 * @param {number} input.now
 * @returns {object} board snapshot (without theme)
 */
function deriveBoard(input = {}) {
  const locale = normalizeLocale(input.locale)
  const t = translator(locale)
  const sessions = input.sessions || {}
  const byId = sessions.byId || {}
  const ids = Array.isArray(sessions.ids) ? sessions.ids : Object.keys(byId)
  const statuses = input.statuses instanceof Map ? input.statuses : new Map(Object.entries(input.statuses || {}))
  const workspaces = input.workspaces || { items: [], archivedSessionIds: [] }
  const archived = new Set(Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds : [])
  const currentSessionId = typeof input.currentSessionId === 'string' ? input.currentSessionId : undefined
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now()
  const columns = { needs: [], running: [], review: [], done: [] }

  for (const id of ids) {
    const summary = byId[id]
    if (!summary || summary.blank === true) continue
    if (summary.origin === 'subagent' || summary.parentId) continue
    if (archived.has(id)) continue
    const status = statuses.get(id)
    const column = classify(summary, status)
    const current = id === currentSessionId
    const title = cleanText(summary.displayTitle || summary.title || basename(summary.cwd) || id, 300)
    const updatedAt = Number(summary.updatedAt) || 0
    const pendingKind = status?.pendingInteraction?.kind
    let badge
    if (column === 'needs') badge = pendingLabel(status, t)
    else if (column === 'running') badge = t('cardRunning')
    else if (column === 'review') badge = t('cardReview')
    else badge = t('cardDone')
    columns[column].push({
      id,
      title,
      project: projectFor(summary, workspaces),
      updatedAt,
      relative: relativeTime(updatedAt, now, locale),
      column,
      badge,
      current,
      pendingKind: typeof pendingKind === 'string' ? cleanText(pendingKind, 40) : null
    })
  }

  for (const key of COLUMN_KEYS) columns[key].sort(compareCards)
  const counts = {
    needs: columns.needs.length,
    running: columns.running.length,
    review: columns.review.length,
    done: columns.done.length
  }
  counts.total = counts.needs + counts.running + counts.review + counts.done

  return {
    generatedAt: now,
    locale,
    currentSessionId: currentSessionId || null,
    columns,
    counts,
    labels: labelsFor(locale)
  }
}

/** All card ids across the two attention columns. */
function attentionIds(board) {
  const output = new Set()
  for (const key of ['needs', 'review']) {
    for (const card of board?.columns?.[key] || []) output.add(card.id)
  }
  return output
}

/**
 * Cards that newly entered the attention queue.
 *
 * A session moving between needs and review is not a new entry: the user has
 * already been told it needs attention.
 */
function newAttentionCards(previous, next) {
  if (!previous) return []
  const before = attentionIds(previous)
  const fresh = []
  for (const key of ['needs', 'review']) {
    for (const card of next?.columns?.[key] || []) {
      if (!before.has(card.id)) fresh.push({ ...card, column: key })
    }
  }
  return fresh
}

/** Validate one card from the browser (host and WPF share this contract). */
function sanitizeCard(value) {
  if (!value || typeof value !== 'object') return null
  const id = cleanText(value.id, 200)
  if (!id) return null
  const column = COLUMN_KEYS.includes(value.column) ? value.column : 'done'
  const updatedAt = Number(value.updatedAt)
  return {
    id,
    title: cleanText(value.title, 300) || id,
    project: cleanText(value.project, 120) || '—',
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
    relative: cleanText(value.relative, 60),
    column,
    badge: cleanText(value.badge, 60),
    current: value.current === true,
    pendingKind: value.pendingKind ? cleanText(value.pendingKind, 40) : null
  }
}

/** Clamp one colour token to a CSS hex string the WPF brush parser accepts. */
function sanitizeColor(value, fallback) {
  const text = String(value || '').trim()
  if (/^#[0-9a-f]{3}$/iu.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase()
  }
  if (/^#[0-9a-f]{6}$/iu.test(text)) return text.toLowerCase()
  if (/^#[0-9a-f]{8}$/iu.test(text)) return text.toLowerCase()
  return fallback
}

/** Resolve every theme token to a safe hex value. */
function sanitizeTheme(value) {
  const source = value && typeof value === 'object' ? value : {}
  const theme = { dark: source.dark === true }
  for (const key of THEME_KEYS) theme[key] = sanitizeColor(source[key], DEFAULT_THEME[key])
  return theme
}

/**
 * Validate a snapshot accepted over HTTP. Message caps keep a malicious or
 * broken renderer from making the native window allocate unbounded UI.
 */
function sanitizeSnapshot(value, maxCards = 200) {
  const source = value && typeof value === 'object' ? value : {}
  const columns = {}
  let total = 0
  for (const key of COLUMN_KEYS) {
    const input = Array.isArray(source.columns?.[key]) ? source.columns[key] : []
    const cards = []
    for (const raw of input.slice(0, maxCards)) {
      const card = sanitizeCard(raw)
      if (!card) continue
      card.column = key
      cards.push(card)
      total += 1
      if (total >= maxCards) break
    }
    columns[key] = cards.sort(compareCards)
  }
  const counts = {
    needs: columns.needs.length,
    running: columns.running.length,
    review: columns.review.length,
    done: columns.done.length
  }
  counts.total = counts.needs + counts.running + counts.review + counts.done
  const locale = normalizeLocale(source.locale)
  const generatedAt = Number(source.generatedAt)
  return {
    generatedAt: Number.isFinite(generatedAt) && generatedAt > 0 ? generatedAt : Date.now(),
    locale,
    currentSessionId: source.currentSessionId ? cleanText(source.currentSessionId, 200) : null,
    columns,
    counts,
    labels: labelsFor(locale),
    theme: sanitizeTheme(source.theme)
  }
}

module.exports = {
  COLUMN_KEYS,
  DEFAULT_THEME,
  LABELS,
  attentionIds,
  basename,
  classify,
  cleanText,
  compareCards,
  deriveBoard,
  labelFor,
  labelsFor,
  newAttentionCards,
  normalizeLocale,
  projectFor,
  relativeTime,
  sanitizeCard,
  sanitizeColor,
  sanitizeSnapshot,
  sanitizeTheme,
  translator
}
