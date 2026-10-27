/**
 * dshdesk — host half.
 *
 * Responsibilities:
 * - accept the browser's read-only board snapshot;
 * - expose capability/window routes to the footer UI;
 * - when asked, open a true Windows always-on-top companion (WPF via
 *   PowerShell) and serve its 800 ms mirror from a loopback-only, token-gated
 *   HTTP server.
 *
 * The host never reads or writes session status. It only mirrors what the
 * browser derived from DSH's own state.
 */

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'

const require = createRequire(import.meta.url)
const board = require('./lib/board.cjs')

export const name = 'dshdesk'
export const inject = ['webServer']

const BASE = '/dshdesk'
const STALE_MS = 6000
const BODY_LIMIT = 512 * 1024
const DEFAULT_OPACITY = 0.9
const MIN_OPACITY = 0.3
const MAX_OPACITY = 1
const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'native', 'dshdesk-window.ps1')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STATE_FILE = join(DSH_HOME, 'dshdesk.json')

function clampOpacity(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_OPACITY
  return Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, Math.round(numeric * 100) / 100))
}

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeState(value) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    writeFileSync(STATE_FILE, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  } catch {
    /* preference persistence is best effort */
  }
}

function resolvePowerShell() {
  const explicit = process.env.DSHDESK_POWERSHELL
  if (explicit && existsSync(explicit)) return explicit
  if (process.platform === 'win32') return 'powershell.exe'
  if (process.platform === 'linux') {
    const candidates = [
      '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
      '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/pwsh.exe',
      '/mnt/c/Program Files/PowerShell/7/pwsh.exe'
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function resolveScriptPath(powerShell) {
  if (!powerShell || !existsSync(SCRIPT_PATH)) return null
  if (process.platform !== 'linux') return SCRIPT_PATH
  try {
    const { execFileSync } = require('node:child_process')
    const converted = execFileSync('wslpath', ['-w', SCRIPT_PATH], { encoding: 'utf8' }).trim()
    return converted || null
  } catch {
    return null
  }
}


function sendJson(response, statusCode, payload) {
  if (response.writableEnded) return
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (raw === '') return resolve({})
      try {
        const parsed = JSON.parse(raw)
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

function urlOf(request) {
  try {
    return new URL(request.url || '/', 'http://127.0.0.1')
  } catch {
    return new URL('http://127.0.0.1/')
  }
}

/**
 * Build the host state machine for one plugin instance.
 * @param {object} ctx - Cordis host context.
 */
function createHost(ctx) {
  const powerShell = resolvePowerShell()
  const scriptPath = resolveScriptPath(powerShell)
  const saved = readState()
  let desiredOpacity = clampOpacity(saved.opacity)
  let snapshot = null
  let savedAt = 0
  let mirror = null
  let windowProc = null
  let closeRequested = false
  let focused = false
  let lastError = ''
  let lastOpenedAt = 0
  let disposed = false
  let gcTimer = null

  const logger = (() => {
    try {
      if (typeof ctx.logger === 'function') return ctx.logger('dshdesk')
      if (ctx.logger && typeof ctx.logger === 'object') return ctx.logger
    } catch {}
    return null
  })()

  function log(level, message) {
    try {
      const fn = logger && typeof logger[level] === 'function' ? logger[level].bind(logger) : null
      if (fn) fn(message)
      else if (level === 'warn') console.warn(`[dshdesk] ${message}`)
      else console.log(`[dshdesk] ${message}`)
    } catch {
      /* diagnostics never break the board */
    }
  }

  function capability() {
    if (process.platform === 'darwin') {
      return { window: false, platform: process.platform, reason: 'the companion window is Windows-only' }
    }
    if (!powerShell) {
      return { window: false, platform: process.platform, reason: 'Windows PowerShell was not found' }
    }
    if (!scriptPath) {
      return { window: false, platform: process.platform, reason: 'cannot resolve native/dshdesk-window.ps1 to a Windows path' }
    }
    return { window: true, platform: process.platform, reason: 'ready', opacity: desiredOpacity }
  }

  function isOpen() {
    return Boolean(windowProc && !closeRequested && !disposed)
  }

  function stopMirrorSoon(delay = 0) {
    if (gcTimer) clearTimeout(gcTimer)
    gcTimer = setTimeout(() => {
      gcTimer = null
      if (windowProc && !closeRequested) return
      if (mirror) {
        try {
          mirror.server.close()
        } catch {}
        mirror = null
      }
      focused = false
    }, delay)
    if (gcTimer.unref) gcTimer.unref()
  }

  function finalizeWindow(child, reason) {
    if (windowProc !== child) return
    windowProc = null
    closeRequested = false
    focused = false
    lastError = reason || ''
    log('info', `native window closed${reason ? `: ${reason}` : ''}`)
    stopMirrorSoon(20)
  }

  function markClose(reason) {
    closeRequested = true
    focused = false
    if (!windowProc) {
      stopMirrorSoon(0)
      return
    }
    const child = windowProc
    setTimeout(() => {
      if (windowProc === child && child.exitCode === null && !child.killed) {
        try {
          child.kill()
        } catch {}
      }
    }, 1800).unref?.()
    setTimeout(() => {
      if (windowProc === child) {
        windowProc = null
        closeRequested = false
        stopMirrorSoon(0)
      }
    }, 4500).unref?.()
    log('info', `native window close requested${reason ? `: ${reason}` : ''}`)
  }

  async function startMirror() {
    if (mirror) return mirror
    const token = randomBytes(32).toString('hex')
    const server = createServer((request, response) => {
      const url = urlOf(request)
      if (url.searchParams.get('token') !== token) {
        sendJson(response, 403, { error: 'forbidden' })
        return
      }
      if (url.pathname === '/board') {
        const ageMs = snapshot ? Math.max(0, Date.now() - savedAt) : Number.POSITIVE_INFINITY
        sendJson(response, 200, {
          ok: true,
          stale: !snapshot || ageMs > STALE_MS,
          ageMs: Number.isFinite(ageMs) ? ageMs : null,
          closeRequested,
          focused,
          snapshot
        })
        return
      }
      if (url.pathname === '/focus') {
        focused = url.searchParams.get('focused') === '1'
        sendJson(response, 200, { ok: true, focused })
        return
      }
      if (url.pathname === '/opacity') {
        desiredOpacity = clampOpacity(url.searchParams.get('value'))
        writeState({ ...readState(), opacity: desiredOpacity })
        sendJson(response, 200, { ok: true, opacity: desiredOpacity })
        return
      }
      if (url.pathname === '/closed') {
        markClose('native window closed itself')
        sendJson(response, 200, { ok: true })
        return
      }
      if (url.pathname === '/health') {
        sendJson(response, 200, { ok: true, open: isOpen(), focused })
        return
      }
      sendJson(response, 404, { error: 'not found' })
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    mirror = { server, token, port: address && typeof address === 'object' ? address.port : 0 }
    if (!mirror.port) {
      try {
        server.close()
      } catch {}
      mirror = null
      throw new Error('could not allocate a loopback mirror port')
    }
    return mirror
  }

  async function launch(body) {
    if (isOpen()) return { open: true, supported: true }
    if (!capability().window) return { open: false, supported: false, reason: capability().reason }
    if (body && body.snapshot) {
      snapshot = board.sanitizeSnapshot(body.snapshot)
      savedAt = Date.now()
    }
    if (body && body.opacity !== undefined) desiredOpacity = clampOpacity(body.opacity)
    const mirrorState = await startMirror()
    const args = [
      '-STA',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Port',
      String(mirrorState.port),
      '-Token',
      mirrorState.token,
      '-Opacity',
      String(desiredOpacity)
    ]
    let spawnError = null
    const child = spawn(powerShell, args, {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    })
    child.once('error', (error) => {
      spawnError = error
      lastError = error instanceof Error ? error.message : String(error)
      log('warn', `could not launch the native window: ${lastError}`)
      if (windowProc === child) finalizeWindow(child, lastError)
    })
    child.once('exit', (code, signal) => {
      const reason = [code === null ? '' : `exit ${code}`, signal ? `signal ${signal}` : ''].filter(Boolean).join(', ')
      if (windowProc === child) finalizeWindow(child, code === 0 && !signal ? '' : reason)
    })
    windowProc = child
    closeRequested = false
    focused = false
    lastOpenedAt = Date.now()
    writeState({ ...readState(), opacity: desiredOpacity })
    if (child.pid) child.unref()
    await new Promise((resolve) => setTimeout(resolve, 320))
    if (spawnError) {
      if (windowProc === child) finalizeWindow(child, spawnError.message)
      return { open: false, supported: true, error: spawnError.message }
    }
    if (windowProc !== child || closeRequested) {
      return { open: false, supported: true, error: lastError || 'the native window exited immediately' }
    }
    log('info', `native window opened on 127.0.0.1:${mirrorState.port} at ${Math.round(desiredOpacity * 100)}% opacity`)
    return { open: true, supported: true, opacity: desiredOpacity, width: 900, height: 620 }
  }

  function storeSnapshot(body) {
    snapshot = board.sanitizeSnapshot(body)
    savedAt = Date.now()
    return { ok: true, savedAt }
  }

  function dispose() {
    disposed = true
    closeRequested = true
    if (windowProc) {
      try {
        windowProc.kill()
      } catch {}
      windowProc = null
    }
    if (mirror) {
      try {
        mirror.server.close()
      } catch {}
      mirror = null
    }
    if (gcTimer) {
      clearTimeout(gcTimer)
      gcTimer = null
    }
  }

  return {
    capability,
    isOpen,
    launch,
    markClose,
    storeSnapshot,
    dispose,
    log,
    get snapshot() {
      return snapshot
    },
    get savedAt() {
      return savedAt
    },
    get focused() {
      return focused
    },
    get opacity() {
      return desiredOpacity
    },
    get lastOpenedAt() {
      return lastOpenedAt
    },
    get lastError() {
      return lastError
    },
    STALE_MS,
    SCRIPT_PATH
  }
}

/**
 * Register the host half.
 * @param {object} ctx - Cordis host context.
 */
export function apply(ctx) {
  const host = createHost(ctx)

  ctx.effect(() => {
    const disposers = []
    const register = (path, handler) => {
      disposers.push(ctx.webServer.register({ kind: 'exact', path, handler }))
    }

    register(`${BASE}/capabilities`, (_request, response) => {
      const capability = host.capability()
      sendJson(response, 200, {
        ...capability,
        staleMs: host.STALE_MS,
        opacity: host.opacity
      })
    })

    register(`${BASE}/snapshot`, (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'POST required' })
        return
      }
      readBody(request).then(
        (body) => sendJson(response, 200, host.storeSnapshot(body)),
        (error) => sendJson(response, 400, { error: error.message })
      )
    })

    register(`${BASE}/pin`, (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'POST required' })
        return
      }
      readBody(request).then(
        (body) => host.launch(body).then(
          (result) => sendJson(response, result.open ? 200 : result.supported ? 500 : 200, result),
          (error) => sendJson(response, 500, { open: false, supported: true, error: error.message })
        ),
        (error) => sendJson(response, 400, { error: error.message })
      )
    })

    register(`${BASE}/unpin`, (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'POST required' })
        return
      }
      host.markClose('requested by the web UI')
      sendJson(response, 200, { open: false })
    })

    register(`${BASE}/window`, (_request, response) => {
      sendJson(response, 200, {
        open: host.isOpen(),
        supported: host.capability().window,
        focused: host.focused,
        error: host.lastError || null,
        openedAt: host.lastOpenedAt || null
      })
    })

    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {}
      }
      host.dispose()
    }
  }, 'dshdesk: routes and native window')

  ctx.effect(() => {
    return () => host.dispose()
  }, 'dshdesk: native cleanup')
}

export const __test = {
  BASE,
  STALE_MS,
  DEFAULT_OPACITY,
  MIN_OPACITY,
  MAX_OPACITY,
  clampOpacity,
  resolvePowerShell,
  resolveScriptPath,
  SCRIPT_PATH
}
