export interface TraceEvent {
  readonly args?: {
    readonly data?: {
      readonly clip?: readonly number[]
      readonly cpuProfile?: {
        readonly nodes?: readonly {
          readonly callFrame?: { readonly functionName?: string; readonly scriptId?: string; readonly url?: string; readonly lineNumber?: number }
          readonly id?: number
          readonly parent?: number
        }[]
        readonly samples?: readonly number[]
      }
      readonly frame?: string
      readonly isMainFrame?: boolean
      readonly timeDeltas?: readonly number[]
    }
  }
  readonly dur?: number
  readonly name?: string
  readonly ph?: string
  readonly pid?: number
  readonly tid?: number
  readonly ts?: number
}

export interface TraceMetrics {
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

const getClipArea = (clip: readonly number[] | undefined): number => {
  if (!clip || clip.length < 6 || clip.length % 2 !== 0 || clip.some((value) => !Number.isFinite(value))) {
    return 0
  }
  let sum = 0
  for (let index = 0; index < clip.length; index += 2) {
    const next = (index + 2) % clip.length
    sum += (clip[index] ?? 0) * (clip[next + 1] ?? 0) - (clip[next] ?? 0) * (clip[index + 1] ?? 0)
  }
  return Math.abs(sum) / 2
}

const getFunctions = (events: readonly TraceEvent[]): TraceMetrics['slowestFunctions'] => {
  const profiles = new Map<string, Map<number, { callFrame?: { functionName?: string; scriptId?: string; url?: string; lineNumber?: number }; parent?: number }>>()
  const totals = new Map<string, { functionName: string; inclusiveTimeMs: number; samples: number; selfTimeMs: number; url: string }>()
  for (const event of events) {
    const data = event.args?.data
    const profile = data?.cpuProfile
    if (!profile?.samples) continue
    const threadKey = `${event.pid || 0}:${event.tid || 0}`
    let nodes = profiles.get(threadKey)
    if (!nodes) {
      nodes = new Map()
      profiles.set(threadKey, nodes)
    }
    for (const node of profile.nodes || []) {
      if (node.id !== undefined) nodes.set(node.id, { callFrame: node.callFrame, parent: node.parent })
    }
    const timeDeltas = data?.timeDeltas || []
    for (let index = 0; index < profile.samples.length; index++) {
      const sampleId = profile.samples[index]
      const durationMs = (timeDeltas[index] || 0) / 1000
      let currentId: number | undefined = sampleId
      let isSelf = true
      while (currentId !== undefined) {
        const node = nodes.get(currentId)
        if (!node?.callFrame) break
        const frame = node.callFrame
        const functionName = frame.functionName || '(anonymous)'
        const url = frame.url || `script:${frame.scriptId || 'unknown'}`
        if (!['(root)', '(program)', '(idle)'].includes(functionName)) {
          const key = `${threadKey}:${functionName}:${url}:${frame.lineNumber ?? 0}`
          const previous = totals.get(key)
          totals.set(key, {
            functionName,
            inclusiveTimeMs: (previous?.inclusiveTimeMs || 0) + durationMs,
            samples: (previous?.samples || 0) + (isSelf ? 1 : 0),
            selfTimeMs: (previous?.selfTimeMs || 0) + (isSelf ? durationMs : 0),
            url,
          })
        }
        isSelf = false
        currentId = node.parent
      }
    }
  }
  // eslint-disable-next-line unicorn/prefer-iterator-to-array
  const functions = [...totals.values()]
  return functions.toSorted((left, right) => right.inclusiveTimeMs - left.inclusiveTimeMs).slice(0, 20)
}

export const getTraceMetrics = (events: readonly TraceEvent[]): TraceMetrics => {
  const paintEvents = events.filter((event) => event.name === 'Paint' && event.ph === 'X')
  const layoutEvents = events.filter((event) => event.name === 'Layout' && event.ph === 'X')
  const styleEvents = events.filter((event) => event.name === 'UpdateLayoutTree' && event.ph === 'X')
  return {
    layoutCount: layoutEvents.length,
    layoutDurationMs: layoutEvents.reduce((total, event) => total + (event.dur || 0), 0) / 1000,
    paintAreaPixels: paintEvents.reduce((total, event) => total + getClipArea(event.args?.data?.clip), 0),
    paintCount: paintEvents.length,
    paintDurationMs: paintEvents.reduce((total, event) => total + (event.dur || 0), 0) / 1000,
    recalculateStyleCount: styleEvents.length,
    recalculateStyleDurationMs: styleEvents.reduce((total, event) => total + (event.dur || 0), 0) / 1000,
    slowestFunctions: getFunctions(events),
  }
}

export const getDomMetrics = (root: Element): { readonly domNodeCount: number; readonly renderedTextLength: number; readonly textNodeCount: number } => {
  const editorRoot = root.matches('.Viewlet') ? root : root.querySelector('.Viewlet') || root
  const renderedRoot = editorRoot.querySelector('.EditorRows') || editorRoot
  const walker = document.createTreeWalker(editorRoot, NodeFilter.SHOW_TEXT)
  const renderedTextWalker = document.createTreeWalker(renderedRoot, NodeFilter.SHOW_TEXT)
  let textNodeCount = 0
  let renderedTextLength = 0
  while (walker.nextNode()) {
    textNodeCount++
  }
  while (renderedTextWalker.nextNode()) {
    renderedTextLength += renderedTextWalker.currentNode.textContent?.length || 0
  }
  return {
    domNodeCount: editorRoot.querySelectorAll('*').length + 1,
    renderedTextLength,
    textNodeCount,
  }
}
