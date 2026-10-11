import type { Rpc } from '@lvce-editor/rpc'
import * as EditorOnlyConfig from './config.ts'
import * as EditorOnlyKeyBinding from './keyBinding.ts'
import * as EditorOnlyViewlet from './viewlet.ts'
import * as VirtualDom from '@lvce-editor/virtual-dom'

const editorUid = 1

const getCharWidth = (fontFamily: string, fontSize: number, fontWeight: number): number => {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    return 9
  }
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  return context.measureText('a').width
}

const getBounds = () => {
  return {
    height: window.innerHeight,
    width: window.innerWidth,
    x: 0,
    y: 0,
  }
}

const getEditorMethod = (command: string): string => {
  return command.includes('.') ? command : `Editor.${command}`
}

const render = async (editorRpc: Rpc): Promise<void> => {
  const diffResult = await editorRpc.invoke('Editor.diff2', editorUid)
  const commands = await editorRpc.invoke('Editor.render2', editorUid, diffResult)
  EditorOnlyViewlet.executeCommands(commands)
}

const focus = (): void => {
  const input = document.querySelector<HTMLTextAreaElement>('.EditorInput textarea')
  input?.focus()
}

const markRendered = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
  performance.mark('syntax-highlight-rendered')
  document.documentElement.dataset.renderBenchmarkReady = 'true'
}

const setError = (error: unknown): void => {
  document.documentElement.dataset.benchmarkReady = 'error'
  document.body.textContent = error instanceof Error ? error.stack || error.message : String(error)
}

export const main = async (launchWorker: typeof import('./workerRpc.ts').launchWorker): Promise<void> => {
  const commandMap = {}
  const workerConfig = EditorOnlyConfig.getConfig()
  document.documentElement.dataset.benchmarkStage = 'starting'
  try {
    document.documentElement.dataset.benchmarkStage = 'launching-syntax-worker'
    const syntaxHighlightingRpc = await launchWorker('Syntax Highlighting Worker', workerConfig.syntaxHighlightingWorkerUrl || '', {})
    Object.assign(commandMap, {
      'Main.handleModifiedStatusChange': () => undefined,
      'SendMessagePortToSyntaxHighlightingWorker.sendMessagePortToSyntaxHighlightingWorker': async (
        port: MessagePort,
        initialCommand: string,
      ): Promise<void> => {
        document.documentElement.dataset.benchmarkStage = 'connecting-syntax-worker'
        await syntaxHighlightingRpc.invokeAndTransfer(initialCommand, port)
        document.documentElement.dataset.benchmarkStage = 'syntax-worker-connected'
      },
    })

    document.documentElement.dataset.benchmarkStage = 'launching-editor-worker'
    const editorRpc = await launchWorker('Editor Worker', workerConfig.editorWorkerUrl || '', commandMap)
    document.documentElement.dataset.benchmarkStage = 'initializing-editor-worker'
    await editorRpc.invoke('Initialize.initialize', true, true)

    document.documentElement.dataset.benchmarkStage = 'creating-editor'
    const config = EditorOnlyConfig.getEditorOnlyConfig()
    const fontFamily = config.fontFamily || 'monospace'
    const fontSize = config.fontSize || 15
    const fontWeight = config.fontWeight || 400
    const bounds = getBounds()
    const characterCount = Number(new URLSearchParams(location.search).get('characters'))
    const safeCharacterCount = Number.isSafeInteger(characterCount) && characterCount >= 2 ? characterCount : 1_000
    const content = `A${'x'.repeat(safeCharacterCount - 2)}Z`
    await editorRpc.invoke('Editor.createStandalone', {
      assetDir: '',
      charWidth: getCharWidth(fontFamily, fontSize, fontWeight),
      content,
      fontFamily,
      fontSize,
      fontWeight,
      ...bounds,
      id: editorUid,
      languageId: config.languageId || 'plaintext',
      letterSpacing: config.letterSpacing || 0,
      lineNumbers: config.lineNumbers || false,
      platform: 1,
      rowHeight: config.rowHeight || 20,
      tabSize: config.tabSize || 2,
      tokenizePath: config.tokenizePath || '',
      uri: config.uri || 'file:///standalone.txt',
    })
    document.documentElement.dataset.benchmarkStage = 'rendering-editor'
    EditorOnlyViewlet.create(editorUid)
    const listeners = await editorRpc.invoke('Editor.renderEventListeners')
    EditorOnlyViewlet.registerEventListeners(editorUid, listeners)

    let text = content
    let pending = Promise.resolve()
    const executeQueued = async (previous: Promise<void>, command: string, args: readonly any[]): Promise<void> => {
      try {
        await previous
        await editorRpc.invoke(getEditorMethod(command), editorUid, ...args)
        await render(editorRpc)
        text = await editorRpc.invoke('Editor.getText', editorUid)
      } catch (error) {
        setError(error)
      }
    }
    const execute = (command: string, ...args: readonly any[]): void => {
      pending = executeQueued(pending, command, args)
    }
    VirtualDom.setIpc({
      send(method: string, uid: number, command: string, ...args: readonly any[]): void {
        if (method !== 'Viewlet.executeViewletCommand' || uid !== editorUid) {
          throw new Error(`Unsupported editor-only event: ${method}`)
        }
        execute(command, ...args)
      },
    })

    document.addEventListener(
      'keydown',
      (event) => {
        const command = EditorOnlyKeyBinding.getEditorCommand(event)
        if (!command) {
          return
        }
        event.preventDefault()
        execute(command)
      },
      { capture: true },
    )
    window.addEventListener('resize', () => {
      execute('resize', getBounds())
    })

    await render(editorRpc)
    Object.defineProperty(window, '__typingBenchmark', {
      configurable: true,
      value: {
        focus,
        getText: () => text,
      },
    })
    focus()
    await markRendered()
    document.documentElement.dataset.benchmarkReady = 'true'
    document.documentElement.dataset.benchmarkStage = 'ready'
  } catch (error) {
    setError(error)
  }
}
