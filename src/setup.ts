import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleBrowserFixture, bundleJavaScriptFile } from './rollupBundle.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, '.tmp', 'static')

const setup = async (): Promise<void> => {
  await mkdir(output, { recursive: true })
  const html = await readFile(join(root, 'fixtures', 'index.html'), 'utf8')
  await writeFile(join(output, 'index.html'), html)
  await bundleBrowserFixture(join(root, 'fixtures', 'lvce', 'index.ts'), join(output, 'index.js'))
  const workerRoot = join(root, 'node_modules', '@lvce-editor', 'editor-worker', 'dist')
  const syntaxWorkerRoot = join(root, 'node_modules', '@lvce-editor', 'syntax-highlighting-worker', 'dist')
  await bundleJavaScriptFile(join(workerRoot, 'editorWorkerMain.js'), join(output, 'editorWorkerMain.js'))
  await bundleJavaScriptFile(join(syntaxWorkerRoot, 'syntaxHighlightingWorkerMain.js'), join(output, 'syntaxHighlightingWorkerMain.js'))
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  const versions = Object.fromEntries(
    [...Object.keys(packageJson.dependencies), ...Object.keys(packageJson.devDependencies)].map((name) => {
      const packagePath = join(root, 'node_modules', name, 'package.json')
      return [name, JSON.parse(readFileSync(packagePath, 'utf8')).version]
    }),
  )
  await writeFile(join(output, 'versions.json'), `${JSON.stringify({ packages: versions, generatedAt: new Date().toISOString() }, null, 2)}\n`)
  await cp(join(root, 'fixtures', 'lvce', 'index.css'), join(output, 'index.css'))
}

await setup()
