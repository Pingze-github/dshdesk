import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { apply, __test } from '../index.js'

function fakeContext() {
  const routes = new Map()
  const cleanups = []
  const ctx = {
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler)
        return () => routes.delete(path)
      }
    },
    effect(factory) {
      const cleanup = factory()
      cleanups.push(cleanup)
      return () => {
        if (typeof cleanup === 'function') cleanup()
      }
    },
    logger() {
      return { info() {}, warn() {} }
    }
  }
  return { ctx, routes, cleanups }
}

function invokeGet(handler) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([])
    req.method = 'GET'
    req.url = '/'
    const chunks = []
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk))
        try {
          resolve({ status: this.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        } catch (error) {
          reject(error)
        }
      },
      get writableEnded() {
        return false
      }
    }
    handler(req, res)
  })
}

function invokePost(handler, payload) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([Buffer.from(JSON.stringify(payload))])
    req.method = 'POST'
    req.url = '/'
    const chunks = []
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk))
        try {
          resolve({ status: this.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        } catch (error) {
          reject(error)
        }
      },
      get writableEnded() {
        return false
      }
    }
    handler(req, res)
  })
}

test('opacity clamps to the documented range', () => {
  assert.equal(__test.clampOpacity(0.9), 0.9)
  assert.equal(__test.clampOpacity(0.1), 0.3)
  assert.equal(__test.clampOpacity(2), 1)
  assert.equal(__test.clampOpacity('nope'), 0.9)
})

test('host registers every route and reports capabilities', async () => {
  const { ctx, routes, cleanups } = fakeContext()
  apply(ctx)
  assert.deepEqual(
    [...routes.keys()].sort(),
    ['/dshdesk/capabilities', '/dshdesk/opened', '/dshdesk/pin', '/dshdesk/snapshot', '/dshdesk/unpin', '/dshdesk/window'].sort()
  )
  const capabilities = await invokeGet(routes.get('/dshdesk/capabilities'))
  assert.equal(capabilities.status, 200)
  assert.equal(capabilities.body.staleMs, 6000)
  assert.equal(typeof capabilities.body.window, 'boolean')
  assert.equal(typeof capabilities.body.reason, 'string')

  const window = await invokeGet(routes.get('/dshdesk/window'))
  assert.equal(window.status, 200)
  assert.equal(window.body.open, false)
  assert.equal(typeof window.body.supported, 'boolean')

  for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
})

test('snapshot route accepts a sanitised board', async () => {
  const { ctx, routes, cleanups } = fakeContext()
  apply(ctx)
  const snapshot = {
    generatedAt: 123,
    locale: 'zh',
    theme: { dark: true, bg: '#1b1b1c' },
    columns: {
      needs: [{ id: 'a', title: '审批', project: 'p', updatedAt: 1, badge: '待审批', column: 'needs' }],
      running: [],
      review: [],
      done: []
    }
  }
  const response = await invokePost(routes.get('/dshdesk/snapshot'), snapshot)
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.ok(response.body.savedAt > 0)
  for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
})

test('non-POST snapshot is rejected', async () => {
  const { ctx, routes, cleanups } = fakeContext()
  apply(ctx)
  const response = await invokeGet(routes.get('/dshdesk/snapshot'))
  assert.equal(response.status, 405)
  for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
})
