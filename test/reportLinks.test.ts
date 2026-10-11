import assert from 'node:assert/strict'
import test from 'node:test'
import { createEvidenceLinks } from '../src/reportLinks.ts'

test('report links published results and the workflow artifacts safely', () => {
  const links = createEvidenceLinks('https://github.com/lvce-editor/benchmark-horizontal-scrolling/actions/runs/123?view=artifacts&tab=summary')
  assert.match(links, /href="horizontal-scrolling\.json">Download raw measurements \(JSON\)/)
  assert.match(links, /href="https:\/\/github\.com\/lvce-editor\/benchmark-horizontal-scrolling\/actions\/runs\/123\?view=artifacts&amp;tab=summary">Download raw Chromium traces/)
})
