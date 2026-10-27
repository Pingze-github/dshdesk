#!/usr/bin/env node
/**
 * Build the single browser bundle without a bundler.
 *
 * The shared attention model is CommonJS so the same file can be unit-tested by
 * Node and inlined into the `__ModuleLoader__` factory. The generated
 * `client.js` is committed; this script only needs to run when `src/` changes.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const templatePath = join(root, 'src', 'client.template.js')
const boardPath = join(root, 'lib', 'board.cjs')
const outputPath = join(root, 'client.js')
const checkOnly = process.argv.includes('--check')

const template = await readFile(templatePath, 'utf8')
const boardSource = await readFile(boardPath, 'utf8')
const marker = '    /*__DSHDESK_BOARD__*/'
if (!template.includes(marker)) {
  console.error('build-client: template marker missing')
  process.exit(1)
}
const wrapped = [
  '    // Inlined from lib/board.cjs — edit that file, then run scripts/build-client.mjs.',
  '    const board = (function () {',
  '      const module = { exports: {} }',
  '      const exports = module.exports',
  boardSource
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n'),
  '      return module.exports',
  '    })()'
].join('\n')
const output = template.replace(marker, wrapped)

if (checkOnly) {
  let existing = ''
  try {
    existing = await readFile(outputPath, 'utf8')
  } catch {
    existing = ''
  }
  if (existing !== output) {
    console.error('build-client: client.js is stale — run node scripts/build-client.mjs')
    process.exit(1)
  }
  console.log('build-client: client.js is current')
} else {
  await writeFile(outputPath, output, 'utf8')
  console.log(`build-client: wrote ${outputPath}`)
}
