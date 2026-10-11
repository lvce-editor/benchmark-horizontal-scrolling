export interface EditorOnlyConfig {
  readonly content?: string
  readonly fontFamily?: string
  readonly fontSize?: number
  readonly fontWeight?: number
  readonly languageId?: string
  readonly letterSpacing?: number
  readonly lineNumbers?: boolean
  readonly rowHeight?: number
  readonly tabSize?: number
  readonly tokenizePath?: string
  readonly uri?: string
}

interface Config {
  readonly editorWorkerUrl?: string
  readonly syntaxHighlightingWorkerUrl?: string
  readonly editorOnly?: EditorOnlyConfig
}

export const getConfig = (): Config => {
  const configElement = document.getElementById('Config')
  if (!configElement?.textContent) {
    return {}
  }
  return JSON.parse(configElement.textContent) as Config
}

export const getEditorOnlyConfig = (): EditorOnlyConfig => {
  return getConfig().editorOnly || {}
}
