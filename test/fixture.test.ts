import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

test('generated fixture includes the editor and both worker bundles', async () => {
  const root = new URL('../.tmp/static/', import.meta.url)
  const directory = join(root.pathname)
  await Promise.all(['index.html', 'index.js', 'index.css', 'editorWorkerMain.js', 'syntaxHighlightingWorkerMain.js', 'versions.json'].map((name) => access(join(directory, name))))
  const html = await readFile(join(directory, 'index.html'), 'utf8')
  assert.match(html, /horizontal scrolling benchmark/)
})
