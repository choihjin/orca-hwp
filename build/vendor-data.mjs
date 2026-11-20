import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

export const pins = JSON.parse(await readFile(new URL('./pins.json', import.meta.url), 'utf8'))

export function verify(bytes, pin, name) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (bytes.length !== pin.size || sha256 !== pin.sha256) {
    throw new Error(`${name}: expected ${pin.size} B / ${pin.sha256}, got ${bytes.length} B / ${sha256}`)
  }
  return bytes
}

export async function download(pin) {
  const response = await fetch(pin.url)
  if (!response.ok) throw new Error(`${pin.url}: HTTP ${response.status}`)
  return verify(Buffer.from(await response.arrayBuffer()), pin, pin.url)
}

export function archiveFile(archive, path) {
  return execFileSync('tar', ['-xOzf', '-', path], { input: archive, maxBuffer: 32 * 1024 * 1024 })
}

export async function downloadPackage(pin) {
  const archive = await download(pin)
  return Object.fromEntries(Object.entries(pin.files).map(([path, file]) => [
    path, verify(archiveFile(archive, path), file, `${pin.url} / ${path}`),
  ]))
}

export async function writeFiles(directory, files) {
  await mkdir(directory, { recursive: true })
  for (const [file, bytes] of Object.entries(files)) {
    await writeFile(new URL(file, directory), bytes)
  }
}
