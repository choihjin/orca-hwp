import { readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const excluded = new Set(['.git', 'node_modules', 'spike', 'fixtures', '.orca'])
const limits = new Map([
  ...['.wasm', '.js', '.mjs', '.html', '.css', '.svg', '.json'].map(ext => [ext, 16_777_216]),
  ...['.ts', '.tsx', '.mts', '.jsx'].map(ext => [ext, 1_048_576]),
  ...['.ttf', '.otf', '.ttc', '.woff', '.woff2'].map(ext => [ext, 33_554_432]),
])
const maxFiles = 2_000
const maxBytes = 52_428_800

function* files(directory = '') {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* files(path)
    if (entry.isFile()) yield path
  }
}

let fileCount = 0
let totalBytes = 0
for (const path of files()) {
  const { size } = statSync(join(root, path))
  fileCount++
  totalBytes += size
  const limit = limits.get(extname(path).toLowerCase())
  if (limit !== undefined && size > limit) {
    console.error(`${path}: ${size} B (limit ${limit} B)`)
    process.exitCode = 1
  }
}

console.log(`Plugin folder: ${fileCount} files, ${totalBytes} B`)
if (fileCount > maxFiles || totalBytes > maxBytes) {
  console.error(`Plugin folder exceeds its limit of ${maxFiles} files and ${maxBytes} B`)
  process.exitCode = 1
}
