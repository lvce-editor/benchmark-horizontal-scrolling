const styleSheets = new Map<number, CSSStyleSheet>()

export const addCssStyleSheet = (id: number, text: string): void => {
  const existing = styleSheets.get(id)
  if (existing) {
    existing.replaceSync(text)
    return
  }
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(text)
  styleSheets.set(id, sheet)
  document.adoptedStyleSheets.push(sheet)
}
