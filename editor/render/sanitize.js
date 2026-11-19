// SVG sanitizer for rhwp page output. The frame viewer (inline SVG) and agent/agent-view.mjs (Node)
// both use it, so it is plain ESM with JSDoc types and needs no DOM.
//
// Allow-list rules (design 5.4): only the elements and attributes listed below are kept; the
// rest are dropped with their content. `<a>` is unwrapped. `href` may only point inside the page
// (`#id`) or, on `<image>`, at a `data:image/` URL. `url()` may only point inside the page.
// `<style>` is removed; `@font-face` rules whose sources are all `data:` fonts are rebuilt and
// returned in `fontFaces` for the caller's one head stylesheet.
//
// Attribute values are judged the way the browser will read them: XML entities decoded first,
// then CSS `url()` matched case-insensitively with any quoting. Only what passes is written
// back, rebuilt (`url(#prefix-id)`) and re-escaped, so no other spelling reaches the page. Every `id` and every `#id` reference gets
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
    'polyline polygon path text tspan image use symbol title desc ' +
    // Beyond the design's list, because rhwp 0.8.7 emits them: line arrows, and image
    // brightness/contrast/grayscale. None of these loads anything from outside the page.
    'marker filter feColorMatrix feComponentTransfer feFuncR feFuncG feFuncB feFuncA'
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
    'href xlink:href vector-effect paint-order shape-rendering text-rendering image-rendering ' +
    'marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient ' +
    'filter filterUnits primitiveUnits color-interpolation-filters in in2 result ' +
    'type values tableValues slope intercept amplitude exponent'
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
/** A CSS url() in any case and quoting; group 1/2/3 is the double-, single- or unquoted target. */
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]*))\s*\)/gi
/** What may follow `#` in a reference we write back. */
const FRAGMENT = /^[^\s"'<>()\\]+$/
/**
 * CSS functions an allowed attribute may contain: transforms, colours and arithmetic, nothing
 * that loads or reads other values (`url`, `image`, `var`, `attr`, `env` stay out).
 */
const SAFE_FUNCTIONS = new Set(
  (
    'matrix translate translatex translatey scale scalex scaley rotate skewx skewy ' +
    'rgb rgba hsl hsla calc min max clamp'
  ).split(' ')
)
const CLASS_VALUE = /^[\w\s-]*$/
const PLAIN_VALUE = /^[\w\s.,#%+-]*$/
const SPECIAL_ATTRIBUTES = new Set(['id', 'class', 'href', 'xlink:href'])
const DATA_IMAGE = /^data:image\/[^\s"'<>\\]*$/i
const DATA_FONT =
  /^data:(?:font\/[\w.+-]+|application\/(?:font-woff2?|font-sfnt|x-font-[\w.+-]+|vnd\.ms-fontobject|octet-stream))(?:;[\w.+-]+=[\w.+-]+)*(?:;base64)?,[A-Za-z0-9+/=%._~-]*$/i

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
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      return valid ? String.fromCodePoint(code) : '\ufffd'
    }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[/** @type {'lt'} */ (e)]
  })
}

/** @param {string} s decoded value, written inside double quotes */
function escapeAttribute(s) {
  if (!/[&<>"]/.test(s)) return s
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Splits at `separator` outside quotes and parentheses.
 * @param {string} s
 * @param {string} separator
 */
function splitTopLevel(s, separator) {
  /** @type {string[]} */
  const parts = []
  let depth = 0
  /** @type {string | null} */
  let quote = null
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      i++ // an escaped character never separates or quotes
    } else if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === separator && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

const FONT_SOURCE =
  /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]*))\s*\)(?:\s+format\(\s*(?:"([\w.-]+)"|'([\w.-]+)'|([\w.-]+))\s*\))?$/i

const FEATURE_TAG = String.raw`(?:"[\x20-\x7e]{4}"|'[\x20-\x7e]{4}')`
const PERCENT = String.raw`\d+(?:\.\d+)?%`

/** @type {Record<string, RegExp>} */
const FONT_DESCRIPTORS = {
  'font-feature-settings': new RegExp(
    String.raw`^(?:normal|${FEATURE_TAG}(?:\s+(?:\d+|on|off))?(?:\s*,\s*${FEATURE_TAG}(?:\s+(?:\d+|on|off))?)*)$`,
    'i'
  ),
  'font-variation-settings': new RegExp(
    String.raw`^(?:normal|${FEATURE_TAG}\s+-?\d+(?:\.\d+)?(?:\s*,\s*${FEATURE_TAG}\s+-?\d+(?:\.\d+)?)*)$`,
    'i'
  ),
  'font-variant': /^[a-z-]+(?:\s+[a-z-]+)*$/i,
  'ascent-override': new RegExp(String.raw`^(?:normal|${PERCENT})$`, 'i'),
  'descent-override': new RegExp(String.raw`^(?:normal|${PERCENT})$`, 'i'),
  'line-gap-override': new RegExp(String.raw`^(?:normal|${PERCENT})$`, 'i'),
  'size-adjust': new RegExp(String.raw`^${PERCENT}$`, 'i'),
  'font-weight': /^(?:normal|bold|bolder|lighter|\d{1,4})(?:\s+\d{1,4})?$/i,
  'font-style': /^(?:normal|italic|oblique)(?:\s+-?\d+(?:\.\d+)?deg){0,2}$/i,
  'font-stretch': /^(?:[a-z-]+|\d+(?:\.\d+)?%)(?:\s+\d+(?:\.\d+)?%)?$/i,
  'font-display': /^(?:auto|block|swap|fallback|optional)$/i,
  'unicode-range': /^u\+[0-9a-f?]{1,6}(?:-[0-9a-f]{1,6})?(?:\s*,\s*u\+[0-9a-f?]{1,6}(?:-[0-9a-f]{1,6})?)*$/i
}

/**
 * Reads a CSS string token that is the whole of `value`, decoding its escapes.
 * @param {string} value
 * @returns {string | null}
 */
function cssString(value) {
  const quote = value[0]
  if (quote !== '"' && quote !== "'") return null
  let out = ''
  let i = 1
  for (; i < value.length; i++) {
    const c = value[i]
    if (c === quote) break
    if (c === '\n' || c === '\r' || c === '\f') return null // unterminated string in CSS
    if (c !== '\\') {
      out += c
      continue
    }
    const next = value[i + 1]
    if (next === undefined) return null
    if (next === '\n' || next === '\f') {
      i++ // escaped newline continues the string
      continue
    }
    const hex = /^[0-9a-fA-F]{1,6}/.exec(value.slice(i + 1, i + 7))
    if (hex) {
      const code = parseInt(hex[0], 16)
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      out += valid ? String.fromCodePoint(code) : '\ufffd'
      i += hex[0].length
      if (/[ \t\n]/.test(value[i + 1] ?? '')) i++
    } else {
      out += next
      i++
    }
  }
  if (i >= value.length || value.slice(i + 1).trim() !== '') return null
  return out
}

/**
 * A family name from a `font-family` descriptor: one quoted string, or identifiers separated by
 * spaces. Returns null for anything else (lists, functions, escapes outside a string).
 * @param {string} value
 */
function fontFamilyName(value) {
  const name = value[0] === '"' || value[0] === "'" ? cssString(value) : /^-?[A-Za-z_\u0080-\uffff][\w\u0080-\uffff-]*(?:\s+-?[A-Za-z_\u0080-\uffff][\w\u0080-\uffff-]*)*$/.test(value) ? value.replace(/\s+/g, ' ') : null
  if (name === null || name.trim() === '' || /[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

/**
 * Writes `name` as a double-quoted CSS string. `<` and `>` become CSS escapes so the rule can sit
 * inside a <style> element without ending it.
 * @param {string} name
 */
function quoteCss(name) {
  return `"${name.replace(/[\\"]/g, (c) => `\\${c}`).replace(/</g, '\\3c ').replace(/>/g, '\\3e ')}"`
}

/**
 * Rebuilds one `@font-face` body from allowed descriptors, or says why it cannot.
 * `src` may only list `url(<data: font>)` with an optional `format()`; anything else (`local()`,
 * other URLs, `tech()`, other properties) refuses the whole rule.
 * @param {string} body text between the braces, entities decoded, comments removed
 * @returns {{ rule: string } | { reason: string }}
 */
function rebuildFontFace(body) {
  // Every value written back is either rebuilt (family name, src) or matched in full by a
  // pattern without backslashes or markup characters (the other descriptors).
  /** @type {string[]} */
  const out = []
  let family = false
  let source = false
  for (const declaration of splitTopLevel(body, ';')) {
    if (!declaration.trim()) continue
    const colon = declaration.indexOf(':')
    if (colon === -1) return { reason: `not a declaration: ${declaration.trim().slice(0, 30)}` }
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (property === 'font-family') {
      const name = fontFamilyName(value)
      if (name === null) return { reason: `font-family ${value.slice(0, 30)}` }
      out.push(`font-family:${quoteCss(name)}`)
      family = true
    } else if (property === 'src') {
      /** @type {string[]} */
      const items = []
      for (const item of splitTopLevel(value, ',')) {
        const m = FONT_SOURCE.exec(item.trim())
        const url = m ? (m[1] ?? m[2] ?? m[3]).trim() : ''
        if (!m || !DATA_FONT.test(url)) return { reason: `src is not data: fonts only: ${item.trim().slice(0, 40)}` }
        const format = m[4] ?? m[5] ?? m[6]
        items.push(`url("${url}")${format ? ` format("${format}")` : ''}`)
      }
      out.push(`src:${items.join(',')}`)
      source = true
    } else if (FONT_DESCRIPTORS[property]?.test(value)) {
      out.push(`${property}:${value}`)
    } else {
      return { reason: `descriptor ${property}` }
    }
  }
  if (!family || !source) return { reason: 'needs font-family and src' }
  return { rule: `@font-face{${out.join(';')}}` }
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
    const open = rule.indexOf('{')
    const close = rule.lastIndexOf('}')
    const rebuilt = rebuildFontFace(rule.slice(open + 1, close > open ? close : rule.length))
    if ('reason' in rebuilt) {
      warn(`removed @font-face (${rebuilt.reason})`)
      continue
    }
    faces.push(rebuilt.rule)
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
  /** @type {string | null} */
  let lastWarning = null
  /** @param {string} w */
  const warn = (w) => {
    warningCounts.set(w, (warningCounts.get(w) ?? 0) + 1)
    lastWarning = w
  }

  /** @type {{ name: string, mode: 'keep' | 'unwrap' | 'drop' | 'style' }[]} */
  const stack = []
  let dropDepth = 0
  /** @type {string[] | null} */
  let styleText = null
  let rootSeen = false
  let rootClosed = false

  /**
   * @param {string} element
   * @param {string} name
   * @param {string} raw attribute value as written (entities not decoded)
   * @returns {string | null} escaped value to write, or null to drop
   */
  const judgeAttribute = (element, name, raw) => {
    if (!ALLOWED_ATTRIBUTES.has(name)) {
      warn(`removed attribute ${name}`)
      return null
    }
    const value = decodeEntities(raw)
    if (name === 'id') return escapeAttribute(prefix + value)
    if (name === 'href' || name === 'xlink:href') {
      // URL parsing strips leading/trailing C0 controls and spaces
      const v = value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
      if (v.startsWith('#') && FRAGMENT.test(v.slice(1))) return escapeAttribute(`#${prefix}${v.slice(1)}`)
      if (element === 'image' && DATA_IMAGE.test(v)) return escapeAttribute(v)
      warn(`removed ${name} on <${element}> that is not #id${element === 'image' ? ' or data:image/' : ''}`)
      return null
    }
    if (name === 'class' && !CLASS_VALUE.test(value)) {
      warn('removed class with unusual characters')
      return null
    }
    if (value.includes('\\') || value.includes('\u0000')) {
      warn(`removed ${name} with a CSS escape or NUL`)
      return null
    }
    // Local references become placeholders; whatever is left must hold no url() or other
    // resource function in any spelling.
    /** @type {string[]} */
    const refs = []
    let outside = false
    const marked = value.replace(CSS_URL, (_, dq, sq, bare) => {
      const target = /** @type {string} */ (dq ?? sq ?? bare).replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
      if (!target.startsWith('#') || !FRAGMENT.test(target.slice(1))) {
        outside = true
        return ''
      }
      refs.push(`url(#${prefix}${target.slice(1)})`)
      return `\u0000${refs.length - 1}\u0000`
    })
    const unquoted = marked.replace(/"[^"]*"|'[^']*'/g, '')
    const functions = [...unquoted.matchAll(/([A-Za-z_-][\w-]*)\s*\(/g)].map((m) => m[1].toLowerCase())
    if (
      outside ||
      functions.some((f) => !SAFE_FUNCTIONS.has(f)) ||
      /javascript:/i.test(value.replace(/[\u0000-\u0020]/g, ''))
    ) {
      warn(`removed ${name} that points outside the page`)
      return null
    }
    return escapeAttribute(marked.replace(/\u0000(\d+)\u0000/g, (_, i) => refs[Number(i)]))
  }

  // rhwp repeats the same long font-family and colour values thousands of times per page
  /** @type {Map<string, { value: string | null, warning: string | null }>} */
  const judged = new Map()
  /**
   * @param {string} element
   * @param {string} name
   * @param {string} raw
   * @returns {string | null}
   */
  const attributeValue = (element, name, raw) => {
    // numbers, colours, keywords: no "(", ":", quote, "&" or "<", so no url() or scheme possible
    // class, id and href have their own rules: they always go through judgeAttribute
    if (PLAIN_VALUE.test(raw) && ALLOWED_ATTRIBUTES.has(name) && !SPECIAL_ATTRIBUTES.has(name)) {
      return raw
    }
    if (name === 'id' || raw.length > 4096) return judgeAttribute(element, name, raw)
    const key = `${element}\u0000${name}\u0000${raw}`
    let hit = judged.get(key)
    if (!hit) {
      const before = lastWarning
      lastWarning = null
      const value = judgeAttribute(element, name, raw)
      hit = { value, warning: lastWarning }
      lastWarning = before
      judged.set(key, hit)
    } else if (hit.warning) {
      warn(hit.warning)
    }
    return hit.value
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
        if (v !== null) parts.push(` ${attrName}="${v}"`)
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
