// SVG sanitizer for rhwp page output. The frame viewer (inline SVG) and agent/agent-view.mjs (Node)
// both use it, so it is plain ESM with JSDoc types and needs no DOM.
//
// Allow-list rules (design 5.4): only the elements and attributes listed below are kept; the
// rest are dropped with their content. `<a>` is unwrapped. `href` may only point inside the page
// (`#id`) or, on `<image>`, at a `data:image/` URL. `url()` may only point inside the page.
// `<style>` is removed; `@font-face` rules whose sources are all `data:` URLs are returned in
// `fontFaces` for the caller's one head stylesheet. Every `id` and every `#id` reference gets
// the page prefix so pages placed in one document do not share ids.
//
// The input must be well-formed XML with one `<svg>` root; anything else is a SanitizeError and
// the caller shows that page as a render error instead of passing the original through.

export class SanitizeError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'SanitizeError'
  }
}

/**
 * @typedef {{ svg: string, fontFaces: string[], warnings: string[] }} SanitizeResult
 */

const ALLOWED_ELEMENTS = new Set(
  (
    'svg g defs clipPath mask pattern linearGradient radialGradient stop rect circle ellipse line ' +
    'polyline polygon path text tspan image use symbol title desc'
  ).split(' ')
)

const ALLOWED_ATTRIBUTES = new Set(
  (
    'id class x y x1 y1 x2 y2 cx cy r rx ry fx fy fr width height d points pathLength transform ' +
    'viewBox preserveAspectRatio xmlns xmlns:xlink xml:space ' +
    'fill fill-opacity fill-rule stroke stroke-width stroke-dasharray stroke-dashoffset ' +
    'stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity opacity color visibility display ' +
    'clip-path clip-rule clipPathUnits mask maskUnits maskContentUnits ' +
    'patternUnits patternContentUnits patternTransform gradientUnits gradientTransform spreadMethod ' +
    'offset stop-color stop-opacity ' +
    'font-family font-size font-weight font-style font-variant font-stretch text-anchor ' +
    'dominant-baseline alignment-baseline baseline-shift letter-spacing word-spacing ' +
    'text-decoration textLength lengthAdjust dx dy rotate writing-mode ' +
    'href xlink:href vector-effect paint-order shape-rendering text-rendering image-rendering'
  ).split(' ')
)

/** Dropped as a tag, its content kept (design 5.4). */
const UNWRAPPED = 'a'

const PREFIX = /^[A-Za-z_][\w-]*$/
const NAME = /[A-Za-z_:][^\s/>=<"'&]*/y
const ATTRIBUTE = /\s+([^\s/>=<"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y
const TAG_END = /\s*(\/?)>/y
const CLOSE = /<\/([A-Za-z_:][^\s/>=<"'&]*)\s*>/y
/** An `&` that does not start an XML predefined or numeric entity. */
const BAD_AMPERSAND = /&(?!(?:#[0-9]+|#x[0-9a-fA-F]+|lt|gt|amp|quot|apos);)/
const LOCAL_URL = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g
const CLASS_VALUE = /^[\w\s-]*$/

/**
 * @param {string} value raw attribute value or text
 * @param {string} where for the error message
 */
function checkCharacterData(value, where) {
  if (value.includes('<')) throw new SanitizeError(`raw "<" in ${where}`)
  if (BAD_AMPERSAND.test(value)) throw new SanitizeError(`"&" that is not an XML entity in ${where}`)
}

/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return code <= 0x10ffff ? String.fromCodePoint(code) : '�'
    }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[/** @type {'lt'} */ (e)]
  })
}

/** @param {string} s */
function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Splits a stylesheet into top-level rules, keeping data: `@font-face` rules.
 * @param {string} css decoded stylesheet text
 * @param {(warning: string) => void} warn
 * @returns {string[]}
 */
function fontFacesFrom(css, warn) {
  /** @type {string[]} */
  const faces = []
  const text = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ')
  let i = 0
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (i >= text.length) break
    const start = i
    let depth = 0
    /** @type {string | null} */
    let quote = null
    for (; i < text.length; i++) {
      const c = text[i]
      if (quote) {
        if (c === '\\') i++
        else if (c === quote) quote = null
      } else if (c === '"' || c === "'") quote = c
      else if (c === '{') depth++
      else if (c === '}' && --depth <= 0) {
        i++
        break
      } else if (c === ';' && depth === 0) {
        i++
        break
      }
    }
    const rule = text.slice(start, i).trim()
    if (!/^@font-face\s*\{/i.test(rule)) {
      warn(`removed CSS rule: ${rule.slice(0, 40)}`)
      continue
    }
    const body = rule.slice(rule.indexOf('{'))
    const urls = [...body.matchAll(/url\(\s*(['"]?)([^'")]*)/gi)].map((m) => m[2].trim())
    if (
      body.includes('<') ||
      body.includes('\\') ||
      /@import|expression\s*\(/i.test(body) ||
      urls.length === 0 ||
      !urls.every((u) => /^data:/i.test(u))
    ) {
      warn(`removed @font-face that is not data: only: ${rule.slice(0, 40)}`)
      continue
    }
    faces.push(rule)
  }
  return faces
}

/**
 * @param {string} svg one page of rhwp SVG
 * @param {string} prefix page id prefix such as `p3-`
 * @returns {SanitizeResult}
 */
export function sanitizeSvg(svg, prefix) {
  if (!PREFIX.test(prefix)) throw new TypeError(`page prefix must be a plain id fragment: ${prefix}`)
  /** @type {string[]} */
  const out = []
  /** @type {Set<string>} */
  const faces = new Set()
  /** @type {Map<string, number>} */
  const warningCounts = new Map()
  /** @param {string} w */
  const warn = (w) => warningCounts.set(w, (warningCounts.get(w) ?? 0) + 1)

  /** @type {{ name: string, mode: 'keep' | 'unwrap' | 'drop' | 'style' }[]} */
  const stack = []
  let dropDepth = 0
  /** @type {string[] | null} */
  let styleText = null
  let rootSeen = false
  let rootClosed = false

  /** @param {string} value */
  const prefixRefs = (value) => value.replace(LOCAL_URL, (_, _q, id) => `url(#${prefix}${id})`)

  /**
   * @param {string} element
   * @param {string} name
   * @param {string} value raw (entities kept)
   * @returns {string | null} value to write, or null to drop
   */
  const attributeValue = (element, name, value) => {
    if (!ALLOWED_ATTRIBUTES.has(name)) {
      warn(`removed attribute ${name}`)
      return null
    }
    if (name === 'id') return prefix + value
    if (name === 'href' || name === 'xlink:href') {
      const v = value.trim()
      if (v.startsWith('#')) return `#${prefix}${v.slice(1)}`
      if (element === 'image' && /^data:image\//i.test(v)) return v
      warn(`removed ${name} on <${element}> that is not #id${element === 'image' ? ' or data:image/' : ''}`)
      return null
    }
    if (name === 'class' && !CLASS_VALUE.test(value)) {
      warn('removed class with unusual characters')
      return null
    }
    const v = value.includes('url(') ? prefixRefs(value) : value
    if (/url\(\s*['"]?(?!#)/i.test(v) || /javascript:/i.test(v)) {
      warn(`removed ${name} that points outside the page`)
      return null
    }
    return v
  }

  const s = svg.charCodeAt(0) === 0xfeff ? svg.slice(1) : svg
  const n = s.length
  let pos = 0
  while (pos < n) {
    const lt = s.indexOf('<', pos)
    const textEnd = lt === -1 ? n : lt
    if (textEnd > pos) {
      const text = s.slice(pos, textEnd)
      if (stack.length === 0) {
        if (text.trim()) throw new SanitizeError('text outside the <svg> root')
      } else {
        checkCharacterData(text, 'text')
        if (dropDepth > 0) {
          // inside a removed element
        } else if (styleText) styleText.push(text)
        else out.push(text)
      }
    }
    if (lt === -1) break
    pos = lt

    if (s.startsWith('<!--', pos)) {
      const end = s.indexOf('-->', pos + 4)
      if (end === -1) throw new SanitizeError('unclosed comment')
      pos = end + 3
      continue
    }
    if (s.startsWith('<![CDATA[', pos)) {
      const end = s.indexOf(']]>', pos + 9)
      if (end === -1) throw new SanitizeError('unclosed CDATA section')
      if (stack.length === 0) throw new SanitizeError('CDATA outside the <svg> root')
      const data = s.slice(pos + 9, end)
      if (dropDepth > 0) {
        // inside a removed element
      } else if (styleText) styleText.push(escapeText(data))
      else out.push(escapeText(data))
      pos = end + 3
      continue
    }
    if (s.startsWith('<?', pos)) {
      const end = s.indexOf('?>', pos + 2)
      if (end === -1) throw new SanitizeError('unclosed processing instruction')
      pos = end + 2
      continue
    }
    if (s.startsWith('<!DOCTYPE', pos)) {
      const end = s.indexOf('>', pos)
      if (end === -1) throw new SanitizeError('unclosed DOCTYPE')
      if (s.slice(pos, end).includes('[')) throw new SanitizeError('DOCTYPE with an internal subset')
      if (rootSeen) throw new SanitizeError('DOCTYPE after the root')
      pos = end + 1
      continue
    }
    if (s.startsWith('</', pos)) {
      CLOSE.lastIndex = pos
      const m = CLOSE.exec(s)
      if (!m) throw new SanitizeError(`malformed end tag at ${pos}`)
      const top = stack.pop()
      if (!top || top.name !== m[1]) {
        throw new SanitizeError(`</${m[1]}> does not close <${top ? top.name : '(nothing)'}>`)
      }
      if (top.mode === 'drop') dropDepth--
      else if (top.mode === 'style') {
        for (const face of fontFacesFrom(decodeEntities((styleText ?? []).join('')), warn)) faces.add(face)
        styleText = null
      } else if (top.mode === 'keep' && dropDepth === 0) out.push(`</${top.name}>`)
      if (stack.length === 0) rootClosed = true
      pos = CLOSE.lastIndex
      continue
    }

    // Start tag.
    NAME.lastIndex = pos + 1
    const nameMatch = NAME.exec(s)
    if (!nameMatch) throw new SanitizeError(`malformed tag at ${pos}`)
    const name = nameMatch[0]
    if (stack.length === 0) {
      if (rootClosed) throw new SanitizeError('more than one root element')
      if (name !== 'svg') throw new SanitizeError(`root element is <${name}>, not <svg>`)
      rootSeen = true
    }
    let at = NAME.lastIndex
    /** @type {[string, string][]} */
    const attributes = []
    /** @type {Set<string>} */
    const seen = new Set()
    let selfClosing = false
    for (;;) {
      TAG_END.lastIndex = at
      const end = TAG_END.exec(s)
      if (end) {
        selfClosing = end[1] === '/'
        at = TAG_END.lastIndex
        break
      }
      ATTRIBUTE.lastIndex = at
      const a = ATTRIBUTE.exec(s)
      if (!a) throw new SanitizeError(`malformed attribute in <${name}> at ${at}`)
      const attrName = a[1]
      const value = a[2] ?? a[3] ?? ''
      if (seen.has(attrName)) throw new SanitizeError(`duplicate attribute ${attrName} in <${name}>`)
      seen.add(attrName)
      checkCharacterData(value, `attribute ${attrName}`)
      attributes.push([attrName, value])
      at = ATTRIBUTE.lastIndex
    }
    pos = at

    /** @type {'keep' | 'unwrap' | 'drop' | 'style'} */
    let mode
    if (dropDepth > 0 || styleText) mode = 'drop'
    else if (name === 'style') mode = 'style'
    else if (name === UNWRAPPED) mode = 'unwrap'
    else if (ALLOWED_ELEMENTS.has(name)) mode = 'keep'
    else mode = 'drop'
    if (mode === 'drop' && dropDepth === 0) warn(`removed element <${name}>`)
    if (mode === 'unwrap') warn(`unwrapped element <${name}>`)

    if (mode === 'keep') {
      const parts = [`<${name}`]
      for (const [attrName, value] of attributes) {
        const v = attributeValue(name, attrName, value)
        if (v !== null) parts.push(` ${attrName}="${v.replace(/"/g, '&quot;')}"`)
      }
      parts.push(selfClosing ? '/>' : '>')
      out.push(parts.join(''))
    }
    if (selfClosing) {
      if (stack.length === 0) rootClosed = true
      continue
    }
    stack.push({ name, mode })
    if (mode === 'drop') dropDepth++
    else if (mode === 'style') styleText = []
  }

  if (stack.length > 0) throw new SanitizeError(`<${stack[stack.length - 1].name}> is not closed`)
  if (!rootSeen) throw new SanitizeError('no <svg> root element')

  const warnings = [...warningCounts].map(([w, count]) => (count > 1 ? `${w} (${count}x)` : w))
  return { svg: out.join(''), fontFaces: [...faces], warnings }
}
