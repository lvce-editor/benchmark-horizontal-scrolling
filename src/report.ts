import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
interface Result {
  readonly domNodeCount: number
  readonly findings: readonly string[]
  readonly lineLength: number
  readonly loadTimeMs: number
  readonly position: 'start' | 'middle' | 'end'
  readonly renderedTextLength: number
  readonly scrollTimeMs: number
  readonly textNodeCount: number
  readonly trace: {
    readonly layoutCount: number
    readonly layoutDurationMs: number
    readonly paintAreaPixels: number
    readonly paintCount: number
    readonly paintDurationMs: number
    readonly recalculateStyleCount: number
    readonly recalculateStyleDurationMs: number
    readonly slowestFunctions: readonly {
      readonly functionName: string
      readonly inclusiveTimeMs: number
      readonly samples: number
      readonly selfTimeMs: number
      readonly url: string
    }[]
  }
}
interface Data {
  readonly chromiumVersion: string
  readonly generatedAt: string
  readonly iterations: number
  readonly nodeVersion: string
  readonly packageVersions: Record<string, string>
  readonly results: readonly Result[]
  readonly warmups: number
}

const escapeHtml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const mean = (values: readonly number[]): number => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
const format = (value: number, digits = 2): string => Number.isFinite(value) ? value.toFixed(digits) : '—'
const getPositionColor = (position: string): string => {
  if (position === 'start') return '#5b8def'
  if (position === 'middle') return '#44a884'
  return '#e49b42'
}

const createChart = (data: readonly Result[]): string => {
  const sizes = [...new Set(data.map((item) => item.lineLength))]
  const positions = ['end', 'middle', 'start'] as const
  const values = sizes.flatMap((lineLength) => positions.map((position) => mean(data
    .filter((item) => item.lineLength === lineLength && item.position === position)
    .map((item) => item.scrollTimeMs))))
  const max = Math.max(1, ...values)
  const width = 900
  const height = 260
  const barWidth = width / Math.max(1, values.length) * 0.55
  const bars = values.map((value, index) => {
    const x = (index + 0.5) * width / Math.max(1, values.length) - barWidth / 2
    const barHeight = value / max * (height - 45)
    const color = getPositionColor(positions[index % positions.length] || 'start')
    const label = `${sizes[Math.floor(index / positions.length)]?.toLocaleString()} ${positions[index % positions.length]}`
    return `<g><rect x="${x}" y="${height - barHeight - 28}" width="${barWidth}" height="${barHeight}" rx="4" fill="${color}"/><text x="${x + barWidth / 2}" y="${height - 12}" text-anchor="middle">${label}</text><text x="${x + barWidth / 2}" y="${height - barHeight - 34}" text-anchor="middle">${format(value)} ms</text></g>`
  }).join('')
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Mean scroll interval time by line size and position"><style>text{font:12px system-ui;fill:#333}</style>${bars}</svg>`
}

const main = async (): Promise<void> => {
  const data = JSON.parse(await readFile(join(root, 'results', 'horizontal-scrolling.json'), 'utf8')) as Data
  const lengths = [...new Set(data.results.map((item) => item.lineLength))].toSorted((a, b) => a - b)
  const positions = ['start', 'middle', 'end'] as const
  const trialRows = lengths.flatMap((length) => positions.flatMap((position) => {
    const trials = data.results.filter((item) => item.lineLength === length && item.position === position)
    const sample = trials[0]
    if (!sample) return []
    return [`<tr><th>${length.toLocaleString()}</th><td>${position}</td><td>${trials.length}</td><td>${format(mean(trials.map((item) => item.scrollTimeMs)))}</td><td>${format(mean(trials.map((item) => item.loadTimeMs)))}</td><td>${format(mean(trials.map((item) => item.trace.recalculateStyleCount)), 1)}</td><td>${format(mean(trials.map((item) => item.trace.recalculateStyleDurationMs)))}</td><td>${format(mean(trials.map((item) => item.trace.layoutCount)), 1)}</td><td>${format(mean(trials.map((item) => item.trace.layoutDurationMs)))}</td><td>${format(mean(trials.map((item) => item.trace.paintCount)), 1)}</td><td>${format(mean(trials.map((item) => item.trace.paintDurationMs)))}</td><td>${format(mean(trials.map((item) => item.trace.paintAreaPixels)), 0)}</td><td>${format(mean(trials.map((item) => item.domNodeCount)), 0)}</td><td>${format(mean(trials.map((item) => item.textNodeCount)), 0)}</td><td>${format(mean(trials.map((item) => item.renderedTextLength)), 0)}</td><td>${trials.filter((item) => item.findings.length).length}</td></tr>`]
  })).join('')
  const functionSamples = new Map<string, { inclusiveTimeMs: number; samples: number; selfTimeMs: number; url: string }>()
  for (const result of data.results) {
    for (const fn of result.trace.slowestFunctions) {
      const key = `${fn.functionName}:${fn.url}`
      const previous = functionSamples.get(key)
      functionSamples.set(key, {
        inclusiveTimeMs: (previous?.inclusiveTimeMs || 0) + fn.inclusiveTimeMs,
        samples: (previous?.samples || 0) + fn.samples,
        selfTimeMs: (previous?.selfTimeMs || 0) + fn.selfTimeMs,
        url: fn.url,
      })
    }
  }
  const functions = [...functionSamples].toSorted((a, b) => b[1].samples - a[1].samples).slice(0, 20)
  const functionRows = functions.map(([name, value]) => `<tr><td>${escapeHtml(name.slice(0, name.lastIndexOf(':')))}</td><td>${format(value.selfTimeMs)}</td><td>${format(value.inclusiveTimeMs)}</td><td>${value.samples}</td><td><code>${escapeHtml(value.url)}</code></td></tr>`).join('')
  const findings = data.results.flatMap((item) => item.findings.map((finding) => `<li><strong>${item.lineLength.toLocaleString()} ${item.position}:</strong> ${escapeHtml(finding)}</li>`))
  const findingsMarkup = findings.length > 0 ? `<div class="notice"><ul>${findings.join('')}</ul></div>` : '<p>No viewport-bound or position-validation findings.</p>'
  const versions = Object.entries(data.packageVersions).map(([name, version]) => `<li><code>${escapeHtml(name)}</code> ${escapeHtml(version)}</li>`).join('')
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LVCE horizontal scrolling benchmark</title><style>body{font:15px system-ui;max-width:1400px;margin:2rem auto;padding:0 1rem;color:#222}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ddd;padding:.45rem;text-align:right}th:first-child,td:first-child,td:nth-child(2){text-align:left}th{background:#f4f5f7}svg{width:100%;max-height:300px}code{overflow-wrap:anywhere}.notice{background:#fff2cc;padding:1rem}</style><h1>LVCE horizontal scrolling benchmark</h1><p>Generated ${escapeHtml(data.generatedAt)} · Node ${escapeHtml(data.nodeVersion)} · Chromium ${escapeHtml(data.chromiumVersion)} · ${data.iterations} measured trial(s), ${data.warmups} warmup(s) per size.</p><p>This report measures the editor-only fixture with pinned packages and Chromium. Load time includes worker startup, initial text measurement, and first render; scroll time spans input dispatch and two animation frames. Trace metrics cover the main page renderer. Paint area sums paint clips, including overlap and repaint work. Text metrics count the editor subtree after the scroll position is reached.</p><h2>Scroll interval chart</h2>${createChart(data.results)}<h2>Measurements</h2><div style="overflow:auto"><table><thead><tr><th>Line chars</th><th>Position</th><th>Trials</th><th>Scroll ms</th><th>Load ms</th><th>Style count</th><th>Style ms</th><th>Layout count</th><th>Layout ms</th><th>Paint count</th><th>Paint ms</th><th>Paint area px²</th><th>DOM nodes</th><th>Text nodes</th><th>Rendered chars</th><th>Failed trials</th></tr></thead><tbody>${trialRows}</tbody></table></div><h2>Slowest sampled functions</h2><p>Ranked by aggregate inclusive CPU sample time across measured scroll intervals.</p><table><thead><tr><th>Function</th><th>Self CPU ms</th><th>Inclusive CPU ms</th><th>Self samples</th><th>Source</th></tr></thead><tbody>${functionRows}</tbody></table><h2>Findings</h2>${findingsMarkup}<h2>Versions</h2><ul>${versions}</ul><p>Raw measurements and traces are available in the CI artifact. Results from different runner images or instrumentation versions are not directly comparable.</p></html>`
  const output = join(root, '.tmp', 'pages')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'index.html'), html)
  await writeFile(join(output, 'horizontal-scrolling.json'), `${JSON.stringify(data, null, 2)}\n`)
}

await main()
