# LVCE horizontal scrolling benchmark

Measure how LVCE Editor renders and horizontally scrolls single plain-text lines
of 1,000, 10,000, 100,000 and 1,000,000 characters. The benchmark uses the
editor-only fixture from the pinned `@lvce-editor` packages; it measures editor
rendering without workbench chrome.

## Run

Requires Node.js 24.15.x or Node.js 26 or newer.

```sh
nvm install && nvm use
npm ci
npx playwright install chromium
npm run benchmark -- --iterations 5 --warmups 1
npm run report
```

The benchmark first waits for initial load and text measurement, then records
three steady-state scrolls (start, middle and end) per line size. Warmups are
discarded. Each measured trial records raw Chromium traces, style/layout/paint
events, CPU samples, and editor DOM/text-node counts. Failed position checks
retain their error and a DOM snapshot. `npm run report` writes a static report
to `.tmp/pages/`.

The runner tries the editor's scrollbar at start, middle, and end, and checks
the leading/trailing markers before calling a position verified. Missing thumbs
or unchanged markers remain failed-position findings. It checks that rendered
text stays within the viewport plus the editor's documented one-grapheme
overscan; violations are shown in the report. The benchmark does not change
editor behavior.

Metrics describe Chromium's instrumented main-frame trace and the minimal LVCE
editor fixture. `paintAreaPixels` sums trace paint clips, including overlap and
repaints; `renderedTextLength` counts text in the editor row DOM after each
scroll. Instrumentation affects timings, so compare runs with the same pinned
Chromium, Node.js and package versions. Raw JSON and traces are uploaded by CI.

## CI and GitHub Pages

Pull requests run lint, unit tests, type checking, a browser fixture check, and
a profiled smoke benchmark for all four line sizes. Main runs repeated profiled
trials, uploads raw results, and deploys the report to GitHub Pages.

The LVCE fixture pins `@lvce-editor/editor-worker` and its companion packages in
`package.json`; Playwright pins its Chromium revision through the lockfile.
