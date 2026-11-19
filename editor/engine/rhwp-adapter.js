// The only module that imports rhwp. The frame viewer and agent/agent-view.mjs (Node) both use
// it, so it is plain ESM with JSDoc types. Swapping the engine (for example to a 0.9.1 build)
// should only replace editor/vendor/rhwp/ and the notices.
import init, { HwpDocument } from '../vendor/rhwp/rhwp.js'
import { ENGINE_INFO } from '../vendor/rhwp/engine-info.js'
import { detectKind } from '../format.js'

export { ENGINE_INFO }

/** @typedef {'not-hangul' | 'encrypted' | 'corrupt' | 'unsupported' | 'engine'} EngineErrorCode */

/**
 * @typedef {{ text: string, x: number, y: number, w: number, h: number,
 *   fontFamily: string, fontSize: number, bold: boolean }} TextRun
 */

/**
 * Pages are numbered from 0; sizes are in the same px units as the SVG.
 * @typedef {{
 *   pageCount: number,
 *   pageSize(i: number): { width: number, height: number },
 *   renderPageSvg(i: number): string,
 *   pageTextRuns(i: number): TextRun[],
 *   dispose(): void
 * }} EngineDocument
 */

export class EngineError extends Error {
  /**
   * @param {EngineErrorCode} code
   * @param {string} message
   * @param {string} [engineCode] rhwp's own `오류코드`, when it gave one
   */
  constructor(code, message, engineCode) {
    super(message)
    this.name = 'EngineError'
    /** @type {EngineErrorCode} */
    this.code = code
    /** @type {string | undefined} */
    this.engineCode = engineCode
  }
}

/** @type {Promise<void> | null} */
let ready = null

/**
 * Initialises the WASM once; later calls return the same promise.
 * @param {URL | Uint8Array} wasm a URL in the frame, the bytes in Node
 * @returns {Promise<void>}
 */
export function initEngine(wasm) {
  if (!ready) {
    ready = init({ module_or_path: wasm }).then(() => undefined)
    ready.catch(() => {
      ready = null
    })
  }
  return ready
}

/**
 * @param {string} message
 * @returns {EngineError}
 */
function classify(message) {
  const engineCode = /오류코드:\s*([A-Z0-9_]+)/.exec(message)?.[1]
  const haystack = `${engineCode ?? ''} ${message}`
  if (/PASSWORD|ENCRYPT|암호/i.test(haystack)) {
    return new EngineError('encrypted', message, engineCode)
  }
  if (engineCode === 'UNSUPPORTED_FILE_FORMAT') {
    return new EngineError('unsupported', message, engineCode)
  }
  if (/CORRUPT|INVALID|PARSE|EMPTY_FILE|CFB|헤더 오류|크기 부족|손상/i.test(haystack)) {
    return new EngineError('corrupt', message, engineCode)
  }
  return new EngineError('engine', message, engineCode)
}

/**
 * Whether a ZIP ends with a complete end-of-central-directory record (signature PK\x05\x06, 22
 * bytes plus its comment) reaching exactly to the last byte. A ZIP cut short loses it, and rhwp
 * then reports UNSUPPORTED_FILE_FORMAT as if the package were some other kind of ZIP.
 * @param {Uint8Array} bytes
 */
function hasZipEnd(bytes) {
  const n = bytes.length
  for (let at = n - 22; at >= 0 && at >= n - 22 - 0xffff; at--) {
    if (bytes[at] === 0x50 && bytes[at + 1] === 0x4b && bytes[at + 2] === 0x05 && bytes[at + 3] === 0x06) {
      const commentLength = bytes[at + 20] | (bytes[at + 21] << 8)
      if (at + 22 + commentLength === n) return true
    }
  }
  return false
}

/**
 * @param {Uint8Array} bytes
 * @returns {EngineDocument}
 */
export function openDocument(bytes) {
  if (!ready) {
    throw new EngineError('engine', 'initEngine() has not been called')
  }
  if (detectKind(bytes) === 'unknown') {
    throw new EngineError('not-hangul', 'not a .hwp (OLE) or .hwpx (ZIP) file')
  }
  /** @type {HwpDocument} */
  let doc
  try {
    doc = new HwpDocument(bytes)
  } catch (error) {
    const classified = classify(String(error instanceof Error ? error.message : error))
    // The magic bytes already said ZIP: an incomplete ZIP is a damaged file, not an unsupported one.
    if (classified.code === 'unsupported' && detectKind(bytes) === 'hwpx' && !hasZipEnd(bytes)) {
      throw new EngineError('corrupt', `${classified.message} (ZIP end record missing: file is truncated)`, classified.engineCode)
    }
    throw classified
  }
  let disposed = false
  return {
    pageCount: doc.pageCount(),
    pageSize(i) {
      const info = JSON.parse(doc.getPageInfo(i))
      return { width: Number(info.width), height: Number(info.height) }
    },
    renderPageSvg(i) {
      return doc.renderPageSvg(i)
    },
    pageTextRuns(i) {
      const layout = JSON.parse(doc.getPageTextLayout(i))
      const runs = Array.isArray(layout.runs) ? layout.runs : []
      return runs.map((/** @type {Record<string, unknown>} */ run) => ({
        text: String(run.text ?? ''),
        x: Number(run.x),
        y: Number(run.y),
        w: Number(run.w),
        h: Number(run.h),
        fontFamily: String(run.fontFamily ?? ''),
        fontSize: Number(run.fontSize),
        bold: Boolean(run.bold)
      }))
    },
    dispose() {
      if (!disposed) {
        disposed = true
        doc.free()
      }
    }
  }
}
