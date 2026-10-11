import assert from 'node:assert/strict'
import test from 'node:test'
import { getTraceMetrics } from '../src/traceMetrics.ts'

test('counts trace layout, style and paint work and calculates paint clip area', () => {
  const metrics = getTraceMetrics([
    { name: 'UpdateLayoutTree', ph: 'X', dur: 2000 },
    { name: 'Layout', ph: 'X', dur: 3000 },
    { name: 'Paint', ph: 'X', dur: 4000, args: { data: { clip: [0, 0, 20, 0, 20, 10, 0, 10] } } },
    { name: 'Paint', ph: 'X', dur: 1000, args: { data: { clip: [0, 0, 10, 0, 10, 10, 0, 10] } } },
    { name: 'Paint', ph: 'I', dur: 9000 },
  ])
  assert.deepEqual(metrics, {
    layoutCount: 1,
    layoutDurationMs: 3,
    paintAreaPixels: 300,
    paintCount: 2,
    paintDurationMs: 5,
    recalculateStyleCount: 1,
    recalculateStyleDurationMs: 2,
    slowestFunctions: [],
  })
})

test('attributes CPU sample durations to self and inclusive functions', () => {
  const metrics = getTraceMetrics([
    {
      args: {
        data: {
          cpuProfile: {
            nodes: [
              { id: 1, callFrame: { functionName: '(root)' } },
              { id: 2, parent: 1, callFrame: { functionName: 'scroll', url: 'fixture.js' } },
              { id: 3, parent: 2, callFrame: { functionName: 'measure', url: 'fixture.js' } },
            ],
            samples: [2, 3],
          },
          timeDeltas: [1000, 2000],
        },
      },
      name: 'ProfileChunk',
      pid: 1,
      tid: 2,
    },
  ])
  assert.deepEqual(metrics.slowestFunctions, [
    { functionName: 'scroll', inclusiveTimeMs: 3, samples: 1, selfTimeMs: 1, url: 'fixture.js' },
    { functionName: 'measure', inclusiveTimeMs: 2, samples: 1, selfTimeMs: 2, url: 'fixture.js' },
  ])
})
