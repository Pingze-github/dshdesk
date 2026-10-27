/**
 * dshdesk — browser half.
 *
 * A read-only four-column attention board in the sidebar footer. The native
 * always-on-top companion is opened only when DSH is running inside a desktop
 * shell and the host reports a Windows window capability; a browser tab never
 * pretends it can float.
 *
 * This file is a template. `scripts/build-client.mjs` substitutes the pure
 * `lib/board.cjs` module at `/*__DSHDESK_BOARD__*\/` and writes `client.js`.
 */

window.__ModuleLoader__.load({
  id: 'dshdesk',
  factory: function (require) {
    var module = { exports: {} }
    module.exports

    const react = require('react')
    const reactDom = require('react-dom')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = react.createElement

    const NS = 'dshdesk'
    const API = '/dshdesk'
    const OPEN_WIDTH = 860
    const OPEN_HEIGHT = 620
    const MIN_NATIVE_WIDTH = 760
    const MIN_NATIVE_HEIGHT = 210
    const THEME_TOKENS = {
      bg: ['--dsw-alias-bg-base', '#ffffff'],
      layer1: ['--dsw-alias-bg-layer-1', '#ffffff'],
      layer2: ['--dsw-alias-bg-layer-2', '#f5f6f7'],
      sidebar: ['--dsw-specific-sidebar-fill', '#f9fafb'],
      labelPrimary: ['--dsw-alias-label-primary', '#0f1115'],
      labelSecondary: ['--dsw-alias-label-secondary', '#545557'],
      labelTertiary: ['--dsw-alias-label-tertiary', '#81858c'],
      border: ['--dsw-alias-border-l2', '#1a000000'],
      accent: ['--dsw-alias-state-business-primary', '#4176e6'],
      amber: ['--dsw-alias-state-warn-primary', '#f59e0b'],
      green: ['--dsw-alias-state-success-primary', '#22c55e'],
      idle: ['--dsw-alias-state-idle-primary', '#d4d4d4'],
      red: ['--dsw-alias-state-error-primary', '#ec1313']
    }

    /*__DSHDESK_BOARD__*/
    const { deriveBoard, newAttentionCards, sanitizeTheme } = board

    const StateDot =
      primitives && typeof primitives.StateDot === 'function'
        ? primitives.StateDot
        : function FallbackDot(props) {
            return h('span', { className: 'dshdesk-fallbackDot', 'data-state': props.state })
          }

    const DICT_ZH = {
      'button.title': '任务看板',
      'button.aria': '任务看板：进行中 {running} 项，需要你 {needs} 项，验收 {review} 项',
      'button.label': '任务看板',
      'panel.close': '关闭',
      'panel.pin': '钉成置顶小窗',
      'panel.pinActive': '关闭置顶小窗',
      'panel.pinUnavailable': '网页版不提供置顶窗',
      'panel.pinFailed': '置顶窗打开失败：{message}',
      'panel.subtitle': '只读 · 状态由会话实时推导',
      'panel.current': '当前',
      'panel.count': '{count}',
      'panel.empty': '暂无',
      'panel.stale': '主窗 6 秒未同步，正在关闭…',
      'panel.waiting': '等待主窗同步…',
      'panel.opacity': '透明度',
      'panel.alwaysOnTop': '置顶',
      'panel.unpin': '取消置顶',
      'panel.notificationHint': '看板未聚焦时，新进入「需要你」或「验收」会发系统通知',
      'panel.loading': '正在读取…',
      'panel.error': '读取失败，请稍后重试',
      'panel.drag': '拖动看板',
      'panel.ready': '实时',
      'panel.pinned': '已钉住',
      'panel.browser': '网页版',
      'panel.desktop': '桌面版'
    }

    const DICT_EN = {
      'button.title': 'Attention board',
      'button.aria': 'Attention board: {running} in progress, {needs} need you, {review} to review',
      'button.label': 'Task board',
      'panel.close': 'Close',
      'panel.pin': 'Pin as always-on-top',
      'panel.pinActive': 'Close pinned window',
      'panel.pinUnavailable': 'Not available in a browser',
      'panel.pinFailed': 'Could not open the pinned window: {message}',
      'panel.subtitle': 'Read-only · derived live from session state',
      'panel.current': 'Current',
      'panel.count': '{count}',
      'panel.empty': 'Nothing here',
      'panel.stale': 'No main-window sync for 6 s; closing…',
      'panel.waiting': 'Waiting for the main window…',
      'panel.opacity': 'Opacity',
      'panel.alwaysOnTop': 'Always on top',
      'panel.unpin': 'Stop always on top',
      'panel.notificationHint': 'When the board is unfocused, new “Needs you” or “Review” items send a system notification',
      'panel.loading': 'Reading…',
      'panel.error': 'Could not read the board; try again shortly',
      'panel.drag': 'Drag board',
      'panel.ready': 'Live',
      'panel.pinned': 'Pinned',
      'panel.browser': 'Browser',
      'panel.desktop': 'Desktop'
    }

    const EMPTY_WORKSPACES = { items: [], archivedSessionIds: [] }
    const EMPTY_SELECTION = {}

    function localText(locale, key, params) {
      const dict = String(locale || '').toLowerCase().startsWith('zh') ? DICT_ZH : DICT_EN
      const text = dict[key] || DICT_ZH[key] || key
      if (!params) return text
      return text.replace(/\{(\w+)\}/g, function (_, name) {
        return params[name] === undefined || params[name] === null ? '' : String(params[name])
      })
    }

    function currentLocale() {
      const lang = String(
        (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) ||
          (typeof navigator !== 'undefined' && navigator.language) ||
          'zh'
      ).toLowerCase()
      return lang.indexOf('zh') === 0 ? 'zh' : 'en'
    }

    function readStoredCurrent() {
      try {
        const raw = window.localStorage.getItem('dsh.sessions.current')
        if (!raw) return undefined
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined
      } catch {
        return undefined
      }
    }

    function useStoreSnapshot(store, fallback) {
      const subscribe = react.useCallback(
        function (listener) {
          if (!store || typeof store.subscribe !== 'function') return function () {}
          return store.subscribe(listener)
        },
        [store]
      )
      const getSnapshot = react.useCallback(
        function () {
          if (!store || typeof store.getSnapshot !== 'function') return fallback
          try {
            return store.getSnapshot()
          } catch {
            return fallback
          }
        },
        [store, fallback]
      )
      return react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    function rgbaToToken(value, fallback) {
      const text = String(value || '').trim()
      if (!text || text === 'transparent') return fallback
      if (/^#[0-9a-f]{3}$/i.test(text)) {
        return ('#' + text[1] + text[1] + text[2] + text[2] + text[3] + text[3]).toLowerCase()
      }
      if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase()
      if (/^#[0-9a-f]{8}$/i.test(text)) return text.toLowerCase()
      const match = text.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i)
      if (!match) return fallback
      const channel = function (raw) {
        const numeric = Math.max(0, Math.min(255, Math.round(Number(raw))))
        return numeric.toString(16).padStart(2, '0')
      }
      const alpha = match[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(match[4])))
      if (alpha >= 0.999) return '#' + channel(match[1]) + channel(match[2]) + channel(match[3])
      const a = Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0')
      return '#' + a + channel(match[1]) + channel(match[2]) + channel(match[3])
    }

    function readTheme() {
      const theme = { dark: false }
      let probe = null
      try {
        if (typeof document === 'undefined' || !document.body) return sanitizeTheme(theme)
        theme.dark = document.body.hasAttribute('data-ds-dark-theme')
        probe = document.createElement('span')
        probe.setAttribute('aria-hidden', 'true')
        probe.style.position = 'absolute'
        probe.style.width = '0'
        probe.style.height = '0'
        probe.style.opacity = '0'
        probe.style.pointerEvents = 'none'
        document.body.appendChild(probe)
        for (const key of Object.keys(THEME_TOKENS)) {
          const pair = THEME_TOKENS[key]
          probe.style.color = 'var(' + pair[0] + ', ' + pair[1] + ')'
          const resolved = window.getComputedStyle(probe).color
          theme[key] = rgbaToToken(resolved, pair[1])
        }
        return sanitizeTheme(theme)
      } catch {
        return sanitizeTheme(theme)
      } finally {
        if (probe && probe.parentNode) probe.parentNode.removeChild(probe)
      }
    }

    function detectDesktopShell() {
      try {
        if (window.__DSHSDESK_FORCE_DESKTOP__ === true) return true
        if (window.dshDesktop && typeof window.dshDesktop === 'object') return true
        if (window.dshWindowControl && typeof window.dshWindowControl === 'object') return true
        if (typeof location !== 'undefined' && location.protocol === 'dsh-app:') return true
        if (document.documentElement && document.documentElement.hasAttribute('data-windows-titlebar')) return true
        if (document.documentElement && document.documentElement.getAttribute('data-platform') === 'darwin') return true
        return /DeepSeek Harness Desktop/i.test(navigator.userAgent || '')
      } catch {
        return false
      }
    }

    function payloadFor(board, theme) {
      return {
        generatedAt: Date.now(),
        locale: board.locale,
        currentSessionId: board.currentSessionId,
        columns: board.columns,
        counts: board.counts,
        labels: board.labels,
        theme: theme
      }
    }

    function postJson(path, body) {
      return fetch(API + path, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error((data && (data.error || data.reason)) || 'HTTP ' + response.status)
          return data
        })
      })
    }

    function getJson(path) {
      return fetch(API + path, { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
    }

    function ensureNotificationPermission() {
      try {
        if (typeof Notification !== 'function') return
        if (Notification.permission === 'default') Notification.requestPermission().catch(function () {})
      } catch {
        /* notifications are optional */
      }
    }

    function notifyCards(cards, labels) {
      if (!Array.isArray(cards) || cards.length === 0) return
      if (typeof Notification !== 'function' || Notification.permission !== 'granted') return
      const seen = new Set()
      let sent = 0
      for (const card of cards) {
        if (!card || seen.has(card.id)) continue
        seen.add(card.id)
        if (sent >= 3) break
        const title = card.column === 'review' ? labels.notificationReview : labels.notificationNeeds
        const body = String(labels.notificationBody || '{title} · {project}')
          .replace('{title}', card.title)
          .replace('{project}', card.project)
        try {
          const notification = new Notification(title, { body: body, tag: 'dshdesk-' + card.id })
          notification.onclick = function () {
            try {
              window.focus()
            } catch {}
            notification.close()
          }
          sent += 1
        } catch {
          /* the OS may veto a notification; never break the board */
        }
      }
    }

    function Trigger(props) {
      const { wide, counts, t, triggerRef } = props
      const total = counts.needs + counts.running + counts.review
      return h(
        'button',
        {
          type: 'button',
          className: 'dshdesk-trigger',
          'data-wide': wide ? 'true' : 'false',
          'data-dshdesk-trigger': 'true',
          title: t('button.title'),
          'aria-label': t('button.aria', { running: counts.running, needs: counts.needs, review: counts.review }),
          'aria-haspopup': 'dialog',
          'aria-expanded': props.open ? 'true' : 'false',
          ref: triggerRef,
          onClick: props.onClick
        },
        h(
          'span',
          { className: 'dshdesk-triggerIcon', 'aria-hidden': 'true' },
          h(
            'svg',
            { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 },
            h('rect', { x: 2.1, y: 2.5, width: 11.8, height: 11, rx: 2.2 }),
            h('path', { d: 'M4.6 6.1h4.2M4.6 8.7h6.8M4.6 11.3h3.1' })
          )
        ),
        wide ? h('span', { className: 'dshdesk-triggerLabel' }, t('button.label')) : null,
        h('span', { className: 'dshdesk-triggerTotal' }, String(total)),
        h(
          'span',
          { className: 'dshdesk-triggerDots', 'aria-hidden': 'true' },
          h(StateDot, { state: 'warning', size: 8 }),
          h('span', { className: 'dshdesk-triggerDotCount' }, String(counts.needs)),
          h(StateDot, { state: 'done', size: 8 }),
          h('span', { className: 'dshdesk-triggerDotCount' }, String(counts.review))
        )
      )
    }

    function Card(props) {
      const { card, t } = props
      return h(
        'div',
        {
          className: 'dshdesk-card' + (card.current ? ' dshdesk-cardCurrent' : ''),
          'data-card-id': card.id,
          'data-current': card.current ? 'true' : 'false'
        },
        h('div', { className: 'dshdesk-cardTitle', title: card.title }, card.title),
        h(
          'div',
          { className: 'dshdesk-cardMeta' },
          h('span', { className: 'dshdesk-cardProject', title: card.project }, card.project),
          h('span', { className: 'dshdesk-cardTime' }, card.relative)
        ),
        h(
          'div',
          { className: 'dshdesk-cardFooter' },
          card.current ? h('span', { className: 'dshdesk-currentBadge' }, t('panel.current')) : null,
          h(
            'span',
            {
              className: 'dshdesk-cardBadge dshdesk-badge-' + card.column,
              title: card.badge
            },
            card.badge
          )
        )
      )
    }

    function Column(props) {
      const { id, label, cards, t } = props
      return h(
        'section',
        { className: 'dshdesk-column dshdesk-column-' + id, 'data-column': id },
        h(
          'header',
          { className: 'dshdesk-columnHeader' },
          h(StateDot, { state: id === 'needs' ? 'warning' : id === 'running' ? 'ongoing' : id === 'review' ? 'done' : 'idle', size: id === 'running' ? 12 : 8 }),
          h('span', { className: 'dshdesk-columnName' }, label),
          h('span', { className: 'dshdesk-columnCount' }, String(cards.length))
        ),
        h(
          'div',
          { className: 'dshdesk-columnBody' },
          cards.length === 0
            ? h('div', { className: 'dshdesk-empty' }, t('panel.empty'))
            : cards.map(function (card) {
                return h(Card, { key: card.id, card: card, t: t })
              })
        )
      )
    }

    function Panel(props) {
      const {
        board,
        t,
        position,
        panelRef,
        onClose,
        onPin,
        canPin,
        pinBusy,
        pinError,
        pinned,
        dragHandlers,
        closeRef
      } = props
      if (!position) return null
      const style = {
        left: position.left + 'px',
        top: position.top + 'px',
        width: position.width + 'px',
        height: position.height + 'px'
      }
      const columns = [
        ['needs', board.labels.needs],
        ['running', board.labels.running],
        ['review', board.labels.review],
        ['done', board.labels.done]
      ]
      return reactDom.createPortal(
        h(
          'div',
          {
            className: 'dshdesk-panel',
            style: style,
            role: 'dialog',
            'aria-modal': 'false',
            'aria-label': t('button.title'),
            ref: panelRef
          },
          h(
            'header',
            { className: 'dshdesk-panelHeader', onPointerDown: dragHandlers.onPointerDown },
            h(
              'div',
              { className: 'dshdesk-panelHeading' },
              h('div', { className: 'dshdesk-panelTitle' }, t('button.title')),
              h('div', { className: 'dshdesk-panelSubtitle' }, t('panel.subtitle'))
            ),
            h(
              'div',
              { className: 'dshdesk-panelFlags' },
              h(StateDot, { state: 'done', size: 8 }),
              h('span', null, t('panel.ready'))
            ),
            canPin
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshdesk-iconButton' + (pinned ? ' dshdesk-iconButtonActive' : ''),
                    title: pinned ? t('panel.pinActive') : t('panel.pin'),
                    'aria-label': pinned ? t('panel.pinActive') : t('panel.pin'),
                    onClick: onPin,
                    disabled: pinBusy,
                    'data-dshdesk-pin': 'true'
                  },
                  h(
                    'svg',
                    { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35 },
                    h('path', { d: 'M6 2.5h4l-.7 3.1 2.2 2.2v1.1H9v4.6L8 15l-1-1.5V7.9H4.5V6.8l2.2-2.2L6 2.5Z' })
                  )
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'dshdesk-iconButton',
                title: t('panel.close'),
                'aria-label': t('panel.close'),
                onClick: onClose,
                ref: closeRef
              },
              h(
                'svg',
                { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 },
                h('path', { d: 'm4 4 8 8M12 4l-8 8' })
              )
            )
          ),
          pinError
            ? h('div', { className: 'dshdesk-error', role: 'status' }, t('panel.pinFailed', { message: pinError }))
            : null,
          h(
            'div',
            { className: 'dshdesk-columns' },
            columns.map(function (entry) {
              return h(Column, {
                key: entry[0],
                id: entry[0],
                label: entry[1],
                cards: board.columns[entry[0]] || [],
                t: t
              })
            })
          ),
          h(
            'footer',
            { className: 'dshdesk-panelFooter' },
            h('span', { className: 'dshdesk-footerHint' }, t('panel.notificationHint'))
          )
        ),
        document.body
      )
    }

    function Footer(props) {
      const { wide, useSessions, useSessionStatus, t: slotT, workspaceService } = props
      const locale = currentLocale()
      const t = typeof slotT === 'function' ? slotT : function (key, params) {
        return localText(locale, key, params)
      }
      const sessions = typeof useSessions === 'function' ? useSessions(function (state) { return state }) : null
      const statuses = typeof useSessionStatus === 'function' ? useSessionStatus(function (state) { return state }) : null
      const workspaceList = workspaceService && workspaceService.workspaces && workspaceService.workspaces.list
      const selection = workspaceService && workspaceService.selection
      const workspaceSnapshot = useStoreSnapshot(workspaceList, EMPTY_WORKSPACES)
      const selectionSnapshot = useStoreSnapshot(selection, EMPTY_SELECTION)
      const currentSessionId = selectionSnapshot && selectionSnapshot.sessionId ? selectionSnapshot.sessionId : readStoredCurrent()

      const [open, setOpen] = react.useState(false)
      const [now, setNow] = react.useState(Date.now())
      const [themeTick, setThemeTick] = react.useState(0)
      const [position, setPosition] = react.useState(null)
      const [pinned, setPinned] = react.useState(false)
      const [nativeFocused, setNativeFocused] = react.useState(false)
      const [pinBusy, setPinBusy] = react.useState(false)
      const [pinError, setPinError] = react.useState('')
      const [capability, setCapability] = react.useState(null)
      const triggerRef = react.useRef(null)
      const panelRef = react.useRef(null)
      const closeRef = react.useRef(null)
      const previousBoardRef = react.useRef(null)
      const boardRef = react.useRef(null)
      const themeRef = react.useRef(null)
      const pinnedRef = react.useRef(false)

      pinnedRef.current = pinned

      const board = react.useMemo(
        function () {
          return deriveBoard({
            sessions: sessions || {},
            statuses: statuses || new Map(),
            workspaces: workspaceSnapshot || EMPTY_WORKSPACES,
            currentSessionId: currentSessionId,
            locale: locale,
            now: now
          })
        },
        [sessions, statuses, workspaceSnapshot, currentSessionId, locale, now]
      )
      boardRef.current = board

      const theme = react.useMemo(readTheme, [themeTick])
      themeRef.current = theme

      react.useEffect(
        function () {
          const timer = window.setInterval(function () {
            setNow(Date.now())
          }, 30000)
          return function () {
            window.clearInterval(timer)
          }
        },
        []
      )

      react.useEffect(
        function () {
          if (typeof MutationObserver !== 'function' || !document.body) return
          const observer = new MutationObserver(function () {
            setThemeTick(function (value) {
              return value + 1
            })
          })
          observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'data-theme'] })
          const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
          const onChange = function () {
            setThemeTick(function (value) {
              return value + 1
            })
          }
          if (media && media.addEventListener) media.addEventListener('change', onChange)
          return function () {
            observer.disconnect()
            if (media && media.removeEventListener) media.removeEventListener('change', onChange)
          }
        },
        []
      )

      react.useEffect(
        function () {
          let cancelled = false
          getJson('/capabilities')
            .then(function (data) {
              if (!cancelled) setCapability(data)
            })
            .catch(function () {
              if (!cancelled) setCapability({ window: false, reason: 'host route unavailable' })
            })
          return function () {
            cancelled = true
          }
        },
        []
      )

      const canPin = !!(capability && capability.window === true && detectDesktopShell())

      react.useEffect(
        function () {
          if (!pinned) return
          let cancelled = false
          const send = function () {
            if (cancelled || !boardRef.current || !themeRef.current) return
            postJson('/snapshot', payloadFor(boardRef.current, themeRef.current)).catch(function () {})
          }
          send()
          const timer = window.setInterval(send, 1000)
          return function () {
            cancelled = true
            window.clearInterval(timer)
          }
        },
        [pinned, board, theme]
      )

      react.useEffect(
        function () {
          let cancelled = false
          const tick = function () {
            getJson('/window')
              .then(function (data) {
                if (cancelled) return
                const isOpen = data && data.open === true
                setNativeFocused(data && data.focused === true)
                if (isOpen && !pinnedRef.current) {
                  setPinned(true)
                } else if (!isOpen && pinnedRef.current) {
                  setPinned(false)
                  setOpen(true)
                }
              })
              .catch(function () {})
          }
          tick()
          const timer = window.setInterval(tick, 1200)
          return function () {
            cancelled = true
            window.clearInterval(timer)
          }
        },
        []
      )

      react.useEffect(
        function () {
          if (!open) return
          const onKey = function (event) {
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
            }
          }
          const onPointer = function (event) {
            const target = event.target
            if (panelRef.current && panelRef.current.contains(target)) return
            if (triggerRef.current && triggerRef.current.contains(target)) return
            setOpen(false)
          }
          document.addEventListener('keydown', onKey, true)
          document.addEventListener('pointerdown', onPointer, true)
          return function () {
            document.removeEventListener('keydown', onKey, true)
            document.removeEventListener('pointerdown', onPointer, true)
          }
        },
        [open]
      )

      react.useEffect(
        function () {
          if (!open) return
          if (closeRef.current && typeof closeRef.current.focus === 'function') closeRef.current.focus()
        },
        [open]
      )

      react.useEffect(
        function () {
          if (!open) {
            setPosition(null)
            return
          }
          const place = function () {
            if (!triggerRef.current) return
            const rect = triggerRef.current.getBoundingClientRect()
            const width = Math.min(OPEN_WIDTH, Math.max(320, window.innerWidth - 16))
            const height = Math.min(OPEN_HEIGHT, Math.max(240, window.innerHeight - 16))
            let left = rect.right + 10
            if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
            let top = rect.top + rect.height - height
            top = Math.max(8, Math.min(top, window.innerHeight - height - 8))
            setPosition({ left: left, top: top, width: width, height: height })
          }
          place()
          window.addEventListener('resize', place)
          return function () {
            window.removeEventListener('resize', place)
          }
        },
        [open]
      )

      react.useEffect(
        function () {
          const previous = previousBoardRef.current
          const next = board
          previousBoardRef.current = next
          if (!previous) return
          const focused = (open && document.hasFocus()) || (pinned && nativeFocused)
          if (focused) return
          const fresh = newAttentionCards(previous, next)
          if (fresh.length > 0) notifyCards(fresh, next.labels)
        },
        [board, open, pinned, nativeFocused]
      )

      const onDragStart = react.useCallback(
        function (event) {
          if (event.button !== 0) return
          const target = event.target
          if (target && target.closest && target.closest('button, input, textarea, select')) return
          if (!position) return
          event.preventDefault()
          const startX = event.clientX
          const startY = event.clientY
          const startLeft = position.left
          const startTop = position.top
          const move = function (moveEvent) {
            const width = position.width
            const height = position.height
            const left = Math.max(0, Math.min(window.innerWidth - width, startLeft + moveEvent.clientX - startX))
            const top = Math.max(0, Math.min(window.innerHeight - height, startTop + moveEvent.clientY - startY))
            setPosition({ left: left, top: top, width: width, height: height })
          }
          const up = function () {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            window.removeEventListener('pointercancel', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
          window.addEventListener('pointercancel', up)
        },
        [position]
      )

      const closePin = function () {
        postJson('/unpin', {}).catch(function () {})
        setPinned(false)
      }

      const togglePin = function () {
        if (!canPin) return
        setPinError('')
        if (pinned) {
          closePin()
          return
        }
        setPinBusy(true)
        const payload = payloadFor(boardRef.current || board, themeRef.current || theme)
        postJson('/pin', { snapshot: payload, opacity: 0.9 })
          .then(function (data) {
            if (!data || data.open !== true) throw new Error((data && (data.reason || data.error)) || 'not opened')
            setPinned(true)
            setOpen(false)
          })
          .catch(function (error) {
            setPinError(error && error.message ? error.message : String(error))
          })
          .finally(function () {
            setPinBusy(false)
          })
      }

      const onTrigger = function () {
        ensureNotificationPermission()
        if (pinned) {
          closePin()
          setOpen(true)
          return
        }
        setOpen(function (value) {
          return !value
        })
      }

      return h(
        react.Fragment,
        null,
        h(Trigger, {
          wide: wide,
          counts: board.counts,
          t: t,
          open: open,
          onClick: onTrigger,
          triggerRef: triggerRef
        }),
        open && position
          ? h(Panel, {
              board: board,
              t: t,
              position: position,
              panelRef: panelRef,
              onClose: function () {
                setOpen(false)
              },
              onPin: togglePin,
              canPin: canPin,
              pinBusy: pinBusy,
              pinError: pinError,
              pinned: pinned,
              dragHandlers: { onPointerDown: onDragStart },
              closeRef: closeRef
            })
          : null
      )
    }

    const CSS = [
      '.dshdesk-trigger{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;min-width:0;height:30px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;user-select:none;transition:background-color .15s ease,color .15s ease}',
      '.dshdesk-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshdesk-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
      '.dshdesk-trigger[data-wide="false"]{width:36px;height:36px;margin:0 auto;padding:0;justify-content:center;flex-direction:column;gap:1px;border-radius:var(--dsw-radius-md,12px)}',
      '.dshdesk-triggerIcon{display:inline-flex;flex:none;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}',
      '.dshdesk-triggerLabel{flex:1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshdesk-triggerTotal{font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px}',
      '.dshdesk-triggerDots{display:inline-flex;align-items:center;gap:2px;flex:none;margin-left:auto}',
      '.dshdesk-trigger[data-wide="false"] .dshdesk-triggerDots{margin-left:0;gap:1px}',
      '.dshdesk-triggerDotCount{font-size:10px;line-height:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-right:2px}',
      '.dshdesk-trigger[data-wide="false"] .dshdesk-triggerDotCount{display:none}',
      '.dshdesk-panel{position:fixed;z-index:2147483000;box-sizing:border-box;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;box-shadow:0 18px 50px #0003;overflow:hidden;font-family:var(--dsw-font-family);font-size:13px;line-height:20px}',
      '.dshdesk-panelHeader{display:flex;align-items:center;gap:8px;flex:none;padding:10px 12px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l2);cursor:grab;touch-action:none}',
      '.dshdesk-panelHeader:active{cursor:grabbing}',
      '.dshdesk-panelHeading{min-width:0;flex:1}',
      '.dshdesk-panelTitle{font-size:14px;line-height:20px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshdesk-panelSubtitle{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshdesk-panelFlags{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;flex:none}',
      '.dshdesk-desktopOnly{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 7px}',
      '.dshdesk-iconButton{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}',
      '.dshdesk-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshdesk-iconButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
      '.dshdesk-iconButtonActive{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover-accent)}',
      '.dshdesk-iconButton:disabled{opacity:.5;cursor:progress}',
      '.dshdesk-error{flex:none;padding:6px 12px;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);font-size:12px;line-height:18px}',
      '.dshdesk-columns{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:10px;flex:1;min-height:0}',
      '.dshdesk-column{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--dsw-specific-sidebar-fill);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden}',
      '.dshdesk-columnHeader{display:flex;align-items:center;gap:6px;flex:none;padding:8px 9px 6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dshdesk-columnName{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshdesk-columnCount{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}',
      '.dshdesk-columnBody{display:flex;flex-direction:column;gap:6px;min-height:0;padding:0 6px 6px;overflow-y:auto;scrollbar-width:thin}',
      '.dshdesk-empty{display:flex;align-items:center;justify-content:center;min-height:54px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.dshdesk-card{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:8px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 1px #00000008}',
      '.dshdesk-cardCurrent{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary)}',
      '.dshdesk-cardTitle{font-size:13px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
      '.dshdesk-cardMeta{display:flex;align-items:center;gap:5px;min-width:0;font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary)}',
      '.dshdesk-cardProject{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}',
      '.dshdesk-cardTime{flex:none;font-variant-numeric:tabular-nums}',
      '.dshdesk-cardFooter{display:flex;align-items:center;gap:5px;min-height:17px}',
      '.dshdesk-currentBadge{font-size:9px;line-height:14px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);flex:none}',
      '.dshdesk-cardBadge{font-size:10px;line-height:15px;padding:0 6px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;flex:none;margin-left:auto}',
      '.dshdesk-badge-needs{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}',
      '.dshdesk-badge-running{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}',
      '.dshdesk-badge-review{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}',
      '.dshdesk-badge-done{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}',
      '.dshdesk-panelFooter{display:flex;align-items:center;gap:8px;flex:none;padding:6px 12px 8px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px}',
      '.dshdesk-footerHint{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshdesk-footerCurrent{flex:none}',
      '.dshdesk-fallbackDot{display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;color:var(--dsw-alias-state-idle-primary)}',
      '.dshdesk-fallbackDot[data-state="warning"]{color:var(--dsw-alias-state-warn-primary)}',
      '.dshdesk-fallbackDot[data-state="done"]{color:var(--dsw-alias-state-success-primary)}',
      '.dshdesk-fallbackDot[data-state="ongoing"]{color:var(--dsw-alias-label-tertiary)}',
      '@media (max-width:760px){.dshdesk-panel{border-radius:12px}.dshdesk-panelSubtitle{display:none}.dshdesk-panelFlags{display:none}.dshdesk-columns{gap:5px;padding:6px}.dshdesk-columnHeader{padding:6px 6px 4px}.dshdesk-columnBody{padding:0 4px 4px}.dshdesk-card{padding:6px}}',
      '@media (prefers-reduced-motion:reduce){.dshdesk-trigger{transition:none}}'
    ].join('\n')

    /**
     * Register the footer trigger and open the board on top of the app.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(
        function () {
          const style = document.createElement('style')
          style.id = 'dshdesk-style'
          style.textContent = CSS
          ;(document.head || document.documentElement).appendChild(style)
          return function () {
            if (style.parentNode) style.parentNode.removeChild(style)
          }
        },
        'dshdesk: styles'
      )

      ctx.effect(
        function () {
          return ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN })
        },
        'dshdesk: dictionaries'
      )

      const workspaceService = ctx.get('uiWorkspace')

      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'dshdesk-footer',
            order: 20,
            locale: NS
          },
          function (props) {
            return h(Footer, Object.assign({}, props, { workspaceService: workspaceService }))
          }
        )
      })
    }

    module.exports = {
      name: NS,
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply: apply,
      __test: {
        detectDesktopShell: detectDesktopShell,
        payloadFor: payloadFor,
        rgbaToToken: rgbaToToken
      }
    }
    return module.exports
  }
})
