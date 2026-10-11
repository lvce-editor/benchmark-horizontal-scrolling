import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type CDPSession, type Page } from 'playwright'
import { getDomMetrics, getTraceMetrics, type TraceEvent, type TraceMetrics } from './traceMetrics.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sizes = [1000, 10_000, 100_000, 1_000_000]
const categories = [
  'devtools.timeline',
  'blink',
  'v8',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-v8.cpu_profiler',
].join(',')

interface TrialPosition {
  readonly domNodeCount: number
  readonly findings: readonly string[]
  readonly lineLength: number
  readonly loadTimeMs: number
  readonly position: 'start' | 'middle' | 'end'
  readonly renderedTextLength: number
  readonly scrollTimeMs: number
  readonly textNodeCount: number
  readonly trace: TraceMetrics
}

interface RunResult {
  readonly chromiumVersion: string
  readonly generatedAt: string
  readonly iterations: number
  readonly nodeVersion: string
  readonly packageVersions: Record<string, string>
  readonly results: readonly TrialPosition[]
  readonly warmups: number
}

const readNumberOption = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer`)
  return value
}

const readSizesOption = (): readonly number[] => {
  const index = process.argv.indexOf('--sizes')
  if (index === -1) return sizes
  const requested = process.argv[index + 1]?.split(',').map(Number) || []
  if (requested.some((value) => !sizes.includes(value))) throw new Error(`--sizes must be selected from ${sizes.join(', ')}`)
  return requested
}

const getMimeType = (path: string): string => {
  switch (extname(path)) {
    case '.css': return 'text/css'
    case '.html': return 'text/html'
    case '.js': return 'text/javascript'
    case '.json': return 'application/json'
    default: return 'application/octet-stream'
  }
}

const startServer = async () => {
  const staticRoot = join(root, '.tmp', 'static')
  const server = createServer((request, response) => {
    const {pathname} = new URL(request.url || '/', 'http://localhost')
    const requestedPath = resolve(staticRoot, `.${pathname}`)
    if (requestedPath !== staticRoot && !requestedPath.startsWith(`${staticRoot}${sep}`)) {
      response.writeHead(403).end()
      return
    }
    const filePath = requestedPath === staticRoot ? join(staticRoot, 'index.html') : requestedPath
    void readFile(filePath).then(
      (content) => response.writeHead(200, { 'content-type': getMimeType(filePath) }).end(content),
      () => response.writeHead(404).end('Not found'),
    )
  })
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not start the fixture server')
  return { origin: `http://127.0.0.1:${address.port}`, server }
}

const readStream = async (session: CDPSession, stream: string): Promise<string> => {
  let result = ''
  while (true) {
    const chunk = await session.send('IO.read', { handle: stream }) as { data: string; eof: boolean }
    result += chunk.data
    if (chunk.eof) break
  }
  await session.send('IO.close', { handle: stream })
  return result
}

const captureScroll = async (
  page: Page,
  session: CDPSession,
  fraction: number,
  lineLength: number,
  position: TrialPosition['position'],
  loadTimeMs: number,
): Promise<TrialPosition> => {
  const completed = Promise.withResolvers<string>()
  session.once('Tracing.tracingComplete', ({ stream }) => {
    if (stream) {completed.resolve(stream)}
    else {completed.reject(new Error('Chromium trace did not provide a read stream'))}
  })
  await session.send('Tracing.start', { categories, transferMode: 'ReturnAsStream' })
  const start = performance.now()
  const track = page.locator('.ScrollBarHorizontal')
  const thumb = track.locator('.ScrollBarThumbHorizontal')
  const hasThumb = (await thumb.count()) > 0
  const trackBounds = await track.boundingBox()
  if (!trackBounds && hasThumb) throw new Error(`Horizontal scrollbar track is unavailable for ${lineLength} characters`)
  const thumbBounds = hasThumb ? await thumb.boundingBox() : undefined
  const startX = thumbBounds ? thumbBounds.x + thumbBounds.width / 2 : 0
  const targetX = thumbBounds && trackBounds
    ? trackBounds.x + (trackBounds.width - thumbBounds.width) * fraction + thumbBounds.width / 2
    : trackBounds ? trackBounds.x + trackBounds.width * fraction : 0
  const pointerY = trackBounds ? trackBounds.y + trackBounds.height / 2 : 0
  if (thumbBounds) {
    await page.mouse.move(startX, pointerY)
    await page.mouse.down()
    await page.mouse.move(targetX, pointerY, { steps: 3 })
    await page.mouse.up()
  } else if (trackBounds) {
    await page.mouse.click(targetX, pointerY)
  }
  const findings: string[] = []
  try {
    if (thumbBounds) {
      await page.waitForFunction((target) => {
        const text = document.querySelector('.EditorRows')?.textContent || ''
        if (target === 'start') return text.startsWith('A')
        if (target === 'end') return !text.startsWith('A') && text.includes('Z')
        return !text.startsWith('A') && !text.includes('Z')
      }, position, { timeout: 5000 })
    }
  } catch (error) {
    const snapshot = await page.locator('body').innerHTML()
    const diagnosticPath = join(root, 'results', 'diagnostics', `${lineLength}-${position}-${Date.now()}.html`)
    await mkdir(dirname(diagnosticPath), { recursive: true })
    await writeFile(diagnosticPath, snapshot)
    findings.push(`Could not verify ${position} at scrollbar position ${fraction}: ${error instanceof Error ? error.message : String(error)}`)
  }
  // eslint-disable-next-line unicorn/isolated-functions
  await page.evaluate(() => new Promise<void>((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()))))
  const scrollTimeMs = performance.now() - start
  await session.send('Tracing.end')
  const stream = await completed.promise
  const traceText = await readStream(session, stream)
  const trace = JSON.parse(traceText) as { readonly traceEvents?: readonly TraceEvent[] }
  const summary = getTraceMetrics(trace.traceEvents || [])
  const dom = await page.locator('body').evaluate(getDomMetrics)
  const editorText = await page.locator('body').evaluate((body) => body.querySelector('.EditorRows')?.textContent || '')
  const viewportWidth = await page.evaluate(() => globalThis.innerWidth)
  const charWidth = await page.evaluate(() => {
    // eslint-disable-next-line unicorn/isolated-functions
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return 9
    context.font = '400 15px monospace'
    return context.measureText('x').width
  })
  const maxVisible = Math.ceil(viewportWidth / charWidth) + 2
  if (!hasThumb) findings.push('Editor did not render a horizontal scrollbar thumb for this line size')
  if (!editorText) findings.push('Editor row text was unavailable after the scroll interval')
  if (dom.renderedTextLength > maxVisible) {
    findings.push(`Rendered text ${dom.renderedTextLength} exceeds viewport and one-grapheme overscan bound ${maxVisible}`)
  }
  if (position === 'start' && !editorText.startsWith('A')) findings.push('Start position did not render the leading marker')
  if (position === 'middle' && (editorText.startsWith('A') || editorText.includes('Z'))) findings.push('Middle position did not land inside the long line')
  if (position === 'end' && (editorText.startsWith('A') || !editorText.includes('Z'))) {
    findings.push('End position did not render the trailing marker')
  }
  await writeFile(join(root, 'results', 'traces', `${lineLength}-${position}-${Date.now()}.json`), traceText)
  return {
    ...dom,
    findings,
    lineLength,
    loadTimeMs,
    position,
    scrollTimeMs,
    trace: summary,
  }
}


const run = async (): Promise<void> => {
  const iterations = readNumberOption('iterations', 1)
  if (iterations < 1) throw new Error('--iterations must be at least 1')
  const warmups = readNumberOption('warmups', 0)
  const lineSizes = readSizesOption()
  await mkdir(join(root, 'results', 'traces'), { recursive: true })
  const { origin, server } = await startServer()
  const browser = await chromium.launch({ headless: true })
  const results: TrialPosition[] = []
  try {
    for (const lineLength of lineSizes) {
      for (let trial = -warmups; trial < iterations; trial++) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
        const page = await context.newPage()
        page.on('console', (message) => console.log(`browser ${message.type()}: ${message.text()}`))
        page.on('pageerror', (error) => console.error(`browser error: ${error.stack || error.message}`))
        const session = await context.newCDPSession(page)
        await session.send('Performance.enable')
        const loadStart = performance.now()
        await page.goto(`${origin}/?characters=${lineLength}`)
        await page.waitForFunction(() => ['true', 'error'].includes(document.documentElement.dataset.benchmarkReady || ''), undefined, { timeout: 120_000 })
        if (await page.locator('html').getAttribute('data-benchmark-ready') === 'error') {
          throw new Error(`Editor fixture failed to initialize: ${await page.locator('body').innerText()}`)
        }
        if (!(await page.locator('.EditorRows').count())) {
          throw new Error(`Editor was marked ready without an EditorRows node: ${(await page.locator('body').innerText()).slice(0, 2000)}`)
        }
        // eslint-disable-next-line unicorn/isolated-functions
        await page.evaluate(() => new Promise<void>((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()))))
        const loadTimeMs = performance.now() - loadStart
        const baseline = await page.locator('.EditorRows').innerText()
        const scrollbar = page.locator('.ScrollBarHorizontal')
        if (!(await scrollbar.count())) throw new Error(`No horizontal scrollbar for ${lineLength} characters`)
        const end = await captureScroll(page, session, 1, lineLength, 'end', loadTimeMs)
        const middle = await captureScroll(page, session, 0.5, lineLength, 'middle', loadTimeMs)
        const start = await captureScroll(page, session, 0, lineLength, 'start', loadTimeMs)
        const initialFinding = baseline.startsWith('A') ? [] : ['Initial viewport did not contain the leading marker']
        if (trial >= 0) results.push({ ...start, findings: [...start.findings, ...initialFinding] }, middle, end)
        await context.close()
        console.log(`${trial < 0 ? 'warmup' : 'trial'} ${trial + 1}/${iterations} ${lineLength}: end, middle, start`)
      }
    }
  } finally {
    await browser.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
  const setup = JSON.parse(await readFile(join(root, '.tmp', 'static', 'versions.json'), 'utf8')) as { packages: Record<string, string> }
  const result: RunResult = {
    chromiumVersion: browser.version(),
    generatedAt: new Date().toISOString(),
    iterations,
    nodeVersion: process.version,
    packageVersions: setup.packages,
    results,
    warmups,
  }
  await writeFile(join(root, 'results', 'horizontal-scrolling.json'), `${JSON.stringify(result, null, 2)}\n`)
}

await run()
