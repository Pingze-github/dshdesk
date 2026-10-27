#!/usr/bin/env node
/**
 * Static gate for dshdesk. Behaviour is covered by node:test; this file checks
 * the packaging and cross-file wires that tests cannot see.
 */
import { readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const fail = (message) => {
  console.error(`check: ${message}`)
  process.exitCode = 1
}

const pkg = JSON.parse(read('package.json'))
if (pkg.name !== 'dshdesk') fail('package name must be dshdesk')
if (pkg.private !== false) fail('package must not be private (marketplace installability)')
if (!pkg.dsh || !pkg.dsh.bundle || pkg.dsh.bundle.patch !== './cordis.patch.yml') {
  fail('package.json dsh.bundle.patch must be ./cordis.patch.yml')
}
if (!pkg.dsh.client || pkg.dsh.client.platform !== 'web') fail('dsh.client.platform must be web')
if (pkg.scripts && pkg.scripts.postinstall) fail('postinstall is forbidden by the marketplace')
for (const required of ['index.js', 'client.js', 'lib/board.cjs', 'native/dshdesk-window.ps1', 'cordis.patch.yml']) {
  try {
    if (!statSync(join(root, required)).isFile()) fail(`${required} must be a file`)
  } catch {
    fail(`${required} is missing`)
  }
}
if (!pkg.files.includes('lib') || !pkg.files.includes('native')) fail('package files must include lib and native')

const patch = read('cordis.patch.yml')
if (!/id:\s*dshdesk/.test(patch) || !/name:\s*dshdesk/.test(patch)) fail('cordis.patch.yml must insert id/name dshdesk')

const client = read('client.js')
for (const needle of [
  "id: 'dshdesk'",
  "sidebar.footer.action",
  "data-dshdesk-trigger",
  "dshdesk-panel",
  "dshdesk-columns",
  "dshdesk-card",
  "newAttentionCards",
  "Notification",
  "dshdesk-pin"
]) {
  if (!client.includes(needle)) fail(`client.js missing ${needle}`)
}
if (!client.includes("width: 860") && !client.includes('OPEN_WIDTH = 860')) fail('client bundle must carry the 860px bubble width')
if (!client.includes("state: 'warning'")) fail('client must use the DSH warning dot for needs')
if (!client.includes("state: 'done'")) fail('client must use the DSH done dot for review')
if (client.includes('require("../') || client.includes("require('./")) fail('client.js must only use seed requires')
if (client.includes('http://') || client.includes('https://')) {
  // The client talks only to same-origin /dshdesk routes.
  fail('client.js must not contain absolute network origins')
}

const host = read('index.js')
for (const needle of [
  '127.0.0.1',
  '${BASE}/capabilities',
  '${BASE}/snapshot',
  '${BASE}/pin',
  '${BASE}/unpin',
  '${BASE}/window',
  '${BASE}/opened',
  'STALE_MS = 6000',
  'dshdesk-window.ps1',
  'requestedSessionId',
  'powershell'
]) {
  if (!host.includes(needle)) fail(`index.js missing ${needle}`)
}
if (!host.includes('sanitizeSnapshot')) fail('host must sanitize snapshots')
for (const match of host.matchAll(/https?:\/\/[^\s"'`]+/g)) {
  const url = match[0]
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(url)) fail(`host has a non-loopback origin: ${url}`)
}

const native = readFileSync(join(root, 'native/dshdesk-window.ps1'))
if (native[0] !== 0xef || native[1] !== 0xbb || native[2] !== 0xbf) fail('native script must be UTF-8 BOM for Windows PowerShell 5.1')
const nativeText = native.toString('utf8')
for (const needle of [
  'Topmost = $true',
  'MinWidth = 760',
  'MinHeight = 210',
  'Width = 900',
  'Height = 620',
  'FromMilliseconds(800)',
  'Opacity',
  'SELFTEST_OK',
  'Invoke-Mirror',
  'Post-Mirror',
  'Add_MouseLeftButtonUp'
]) {
  if (!nativeText.includes(needle)) fail(`native script missing ${needle}`)
}
if (nativeText.includes('Invoke-Expression')) fail('native script must not use Invoke-Expression')

const template = read('src/client.template.js')
const zhStart = template.indexOf('const DICT_ZH = {')
const zhEnd = template.indexOf('\n    }', zhStart)
const enStart = template.indexOf('const DICT_EN = {')
const enEnd = template.indexOf('\n    }', enStart)
if (zhStart < 0 || enStart < 0) fail('locale dictionaries not found')
const keys = (block) => new Set([...block.matchAll(/(?:^|\s)'([^']+)'\s*:/g)].map((match) => match[1]))
const zh = keys(template.slice(zhStart, zhEnd))
const en = keys(template.slice(enStart, enEnd))
for (const key of zh) if (!en.has(key)) fail(`locale key ${key} missing from en`)
for (const key of en) if (!zh.has(key)) fail(`locale key ${key} missing from zh`)
const used = new Set([...template.matchAll(/\bt\('([^']+)'/g)].map((match) => match[1]))
for (const key of used) if (!zh.has(key)) fail(`t('${key}') has no dictionary entry`)

for (const path of ['README.md', 'README.en.md', 'AGENTS.md', 'docs/design.md', 'LICENSE']) {
  try {
    if (!read(path).trim()) fail(`${path} must not be empty`)
  } catch {
    fail(`${path} is missing`)
  }
}
if (process.exitCode) {
  console.error('check: FAILED')
} else {
  console.log('check: OK')
}
