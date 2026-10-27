import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const board = require('../lib/board.cjs')

const NOW = Date.parse('2026-10-26T12:00:00Z')

function fixture(overrides = {}) {
  const sessions = {
    ids: ['needs', 'running', 'review', 'done', 'blank', 'sub', 'archived', 'other'],
    byId: {
      needs: {
        id: 'needs',
        displayTitle: '审批一个发布',
        cwd: '/mnt/f/DSH/dshdesk',
        updatedAt: NOW - 60_000,
        blank: false,
        running: true
      },
      running: {
        id: 'running',
        displayTitle: '写完看板',
        cwd: '/mnt/f/DSH/dshdesk',
        updatedAt: NOW - 120_000,
        blank: false,
        running: true
      },
      review: {
        id: 'review',
        displayTitle: '验收置顶窗',
        cwd: '/mnt/f/DSH/linfev',
        updatedAt: NOW - 180_000,
        blank: false,
        running: false
      },
      done: {
        id: 'done',
        displayTitle: '旧会话',
        cwd: '/mnt/f/DSH/zhiwu',
        updatedAt: NOW - 3_600_000,
        blank: false,
        running: false
      },
      blank: { id: 'blank', blank: true, updatedAt: NOW, running: false },
      sub: { id: 'sub', displayTitle: '子代理', parentId: 'done', origin: 'subagent', updatedAt: NOW, running: true },
      archived: { id: 'archived', displayTitle: '已归档', updatedAt: NOW, running: false },
      other: { id: 'other', displayTitle: '另一个项目', cwd: 'C:\\work\\alpha', updatedAt: NOW - 5_000, running: false }
    }
  }
  const statuses = new Map([
    ['needs', { running: true, pendingInteraction: { kind: 'approval' }, completionUnread: false }],
    ['running', { running: true, pendingInteraction: undefined, completionUnread: false }],
    ['review', { running: false, pendingInteraction: undefined, completionUnread: true }],
    ['done', { running: false, pendingInteraction: undefined, completionUnread: false }],
    ['other', { running: false, pendingInteraction: undefined, completionUnread: false }]
  ])
  const workspaces = {
    items: [
      { workspaceId: 'w1', title: 'dshdesk 项目', path: '/mnt/f/DSH/dshdesk', sessionIds: ['needs', 'running'] },
      { workspaceId: 'w2', title: '林扉', path: '/mnt/f/DSH/linfev', sessionIds: ['review'] }
    ],
    archivedSessionIds: ['archived']
  }
  return { sessions, statuses, workspaces, currentSessionId: 'review', locale: 'zh', now: NOW, ...overrides }
}

test('derives exactly four columns from DSH status facts', () => {
  const result = board.deriveBoard(fixture())
  assert.deepEqual(result.columns.needs.map((card) => card.id), ['needs'])
  assert.deepEqual(result.columns.running.map((card) => card.id), ['running'])
  assert.deepEqual(result.columns.review.map((card) => card.id), ['review'])
  assert.deepEqual(result.columns.done.map((card) => card.id), ['other', 'done'])
  assert.deepEqual(result.counts, { needs: 1, running: 1, review: 1, done: 2, total: 5 })
})

test('hides blank, subagent, parented and archived sessions', () => {
  const result = board.deriveBoard(fixture())
  const ids = new Set(Object.values(result.columns).flat().map((card) => card.id))
  assert.equal(ids.has('blank'), false)
  assert.equal(ids.has('sub'), false)
  assert.equal(ids.has('archived'), false)
})

test('pending interaction outranks running; current session sorts first in its column', () => {
  const result = board.deriveBoard(fixture())
  assert.equal(result.columns.needs[0].pendingKind, 'approval')
  assert.equal(result.columns.needs[0].badge, '待审批')
  assert.equal(result.columns.review[0].current, true)
  assert.equal(result.columns.review[0].id, 'review')
})

test('project comes from workspace membership, then cwd basename', () => {
  const result = board.deriveBoard(fixture())
  const needs = result.columns.needs[0]
  const done = result.columns.done.find((card) => card.id === 'done')
  const other = result.columns.done.find((card) => card.id === 'other')
  assert.equal(needs.project, 'dshdesk 项目')
  assert.equal(done.project, 'zhiwu')
  assert.equal(other.project, 'alpha')
})

test('relative time is stable and locale aware', () => {
  assert.equal(board.relativeTime(NOW - 10_000, NOW, 'zh'), '刚刚')
  assert.equal(board.relativeTime(NOW - 120_000, NOW, 'zh'), '2 分钟前')
  assert.equal(board.relativeTime(NOW - 7_200_000, NOW, 'zh'), '2 小时前')
  assert.equal(board.relativeTime(NOW - 172_800_000, NOW, 'en'), '2d ago')
})

test('notifications only fire for newly entering attention columns', () => {
  const first = board.deriveBoard(fixture())
  const next = board.deriveBoard(
    fixture({
      sessions: {
        ...fixture().sessions,
        ids: [...fixture().sessions.ids, 'new'],
        byId: {
          ...fixture().sessions.byId,
          new: {
            id: 'new',
            displayTitle: '新的审批',
            cwd: '/mnt/f/DSH/dshdesk',
            updatedAt: NOW,
            running: false
          }
        }
      },
      statuses: new Map([
        ...fixture().statuses,
        ['new', { running: false, pendingInteraction: { kind: 'question' }, completionUnread: false }]
      ])
    })
  )
  const fresh = board.newAttentionCards(first, next)
  assert.deepEqual(fresh.map((card) => card.id), ['new'])
  assert.equal(fresh[0].column, 'needs')
})

test('moving between needs and review does not count as a new entry', () => {
  const first = board.deriveBoard(fixture())
  const moved = board.deriveBoard(
    fixture({
      statuses: new Map([
        ...fixture().statuses,
        ['review', { running: false, pendingInteraction: undefined, completionUnread: false }],
        ['needs', { running: false, pendingInteraction: undefined, completionUnread: true }]
      ])
    })
  )
  assert.equal(moved.columns.review[0].id, 'needs')
  assert.deepEqual(board.newAttentionCards(first, moved), [])
})

test('sanitizer caps card count and rejects unsafe theme values', () => {
  const raw = {
    generatedAt: 123,
    locale: 'zh',
    theme: { dark: true, bg: 'url(javascript:alert(1))', amber: '#f59e0b' },
    columns: {
      needs: Array.from({ length: 250 }, (_, index) => ({
        id: `id-${index}`,
        column: 'needs',
        title: `t${index}`,
        project: 'p',
        updatedAt: 1,
        badge: 'x'
      })),
      running: [],
      review: [],
      done: []
    }
  }
  const clean = board.sanitizeSnapshot(raw, 200)
  assert.equal(clean.counts.total, 200)
  assert.equal(clean.theme.bg, board.DEFAULT_THEME.bg)
  assert.equal(clean.theme.amber, '#f59e0b')
  assert.equal(clean.theme.dark, true)
})

test('labels cover both locales', () => {
  for (const locale of ['zh', 'en']) {
    const labels = board.labelsFor(locale)
    for (const key of ['needs', 'running', 'review', 'done', 'empty', 'current', 'board']) {
      assert.equal(typeof labels[key], 'string')
      assert.ok(labels[key].length > 0)
    }
  }
})
