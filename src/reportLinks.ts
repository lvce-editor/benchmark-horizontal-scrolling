const escapeHtml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export const createEvidenceLinks = (runUrl: string): string => `<h2>Raw evidence</h2><ul><li><a href="horizontal-scrolling.json">Download raw measurements (JSON)</a></li><li><a href="${escapeHtml(runUrl)}">Download raw Chromium traces from the GitHub Actions artifacts</a></li></ul>`
