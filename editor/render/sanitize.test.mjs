import { existsSync, readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { SanitizeError, sanitizeSvg } from './sanitize.js'

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
/** @param {string} body */
const svg = (body) => `<svg ${NS} width="10" height="10" viewBox="0 0 10 10">${body}</svg>`
/** @param {string} body */
const clean = (body) => sanitizeSvg(svg(body), 'p0-')

test('script, foreignObject, iframe, object and embed are removed with their content', () => {
  const r = clean(
    '<script>alert(1)</script><foreignObject><div>x</div></foreignObject>' +
      '<iframe src="https://e.com"/><object data="x"/><embed src="x"/><rect width="1" height="1"/>'
  )
  for (const name of ['script', 'foreignObject', 'iframe', 'object', 'embed', 'alert', '<div']) {
    assert.ok(!r.svg.includes(name), `${name} should be gone: ${r.svg}`)
  }
  assert.ok(r.svg.includes('<rect width="1" height="1"/>'))
  assert.ok(r.warnings.some((w) => w.includes('script')))
})

test('element names are matched exactly, so case tricks are removed too', () => {
  const r = clean('<Script>alert(1)</Script><svg:script>alert(2)</svg:script><animate attributeName="href" to="javascript:x"/>')
  assert.ok(!/script|alert|animate/i.test(r.svg), r.svg)
})

test('on* attributes and other unknown attributes are removed', () => {
  const r = clean('<rect onload="x()" onClick="y()" style="fill:url(https://e.com/a)" width="1"/>')
  assert.ok(!/onload|onclick|style/i.test(r.svg), r.svg)
  assert.ok(r.svg.includes('<rect width="1"/>'))
})

test('only data:image hrefs on <image> survive; external and javascript: hrefs are removed', () => {
  const r = clean(
    '<image href="data:image/png;base64,AAAA" width="1" height="1"/>' +
      '<image href="https://e.com/a.png" width="2"/>' +
      '<image xlink:href="javascript:x" width="3"/>' +
      '<image href=" JavaScript:x" width="4"/>' +
      '<use href="data:image/svg+xml;base64,AAAA"/>'
  )
  assert.ok(r.svg.includes('href="data:image/png;base64,AAAA"'))
  assert.ok(!r.svg.includes('e.com'))
  assert.ok(!/javascript/i.test(r.svg))
  assert.ok(r.svg.includes('<image width="2"/>'))
  assert.ok(r.svg.includes('<use/>'))
})

test('url() that points outside the document is removed', () => {
  const r = clean('<rect fill="url(https://e.com/x.svg#a)" stroke="url(#g)" width="1"/>')
  assert.ok(!r.svg.includes('e.com'))
  assert.ok(r.svg.includes('stroke="url(#p0-g)"'))
})

test('<a> is unwrapped and its content kept', () => {
  const r = clean('<a href="https://e.com"><text x="1" y="2">링크</text></a>')
  assert.ok(!r.svg.includes('<a'))
  assert.ok(!r.svg.includes('e.com'))
  assert.ok(r.svg.includes('<text x="1" y="2">링크</text>'))
})

test('<style> keeps only data: @font-face rules, moved to fontFaces; other rules warn', () => {
  const face = "@font-face{font-family:'A';src:url(data:font/woff2;base64,AAAA) format('woff2')}"
  const r = clean(
    `<style>/* c */ ${face} @font-face{font-family:B;src:url(https://e.com/b.woff2)} ` +
      `text{fill:red} @import url(x.css);</style><style><![CDATA[${face}]]></style>`
  )
  assert.ok(!r.svg.includes('<style'))
  assert.deepEqual(r.fontFaces, [face])
  assert.ok(r.warnings.length >= 3, r.warnings.join('\n'))
})

test('@font-face decodes XML entities and refuses markup or CSS escapes', () => {
  const r = clean("<style>@font-face{font-family:&apos;A&apos;;src:url(data:font/ttf;base64,AA)}</style>")
  assert.deepEqual(r.fontFaces, ["@font-face{font-family:'A';src:url(data:font/ttf;base64,AA)}"])
  const bad = clean(
    '<style>@font-face{font-family:"&lt;/style&gt;";src:url(data:font/ttf;base64,AA)}' +
      '@font-face{font-family:A;src:\\75rl(https://e.com/a)}</style>'
  )
  assert.deepEqual(bad.fontFaces, [])
})

test('identical @font-face rules are kept once', () => {
  const face = '@font-face{font-family:A;src:url(data:font/ttf;base64,AA)}'
  assert.deepEqual(clean(`<style>${face}${face}</style><style>${face}</style>`).fontFaces, [face])
})

test('ids and url(#…)/href="#…" references get the page prefix', () => {
  const r = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="body-clip-3"><rect/></clipPath></defs><g clip-path="url(#body-clip-3)"/></svg>',
    'p0-'
  )
  assert.ok(r.svg.includes('id="p0-body-clip-3"'))
  assert.ok(r.svg.includes('url(#p0-body-clip-3)'))
  const u = clean('<linearGradient id="g1"/><use href="#g1"/><use xlink:href="#g1"/><rect fill="url( \'#g1\' )"/>')
  assert.ok(u.svg.includes('<use href="#p0-g1"/>'))
  assert.ok(u.svg.includes('<use xlink:href="#p0-g1"/>'))
  assert.ok(u.svg.includes('fill="url(#p0-g1)"'))
})

test('entities stay as they are and single-quoted values are re-quoted safely', () => {
  const r = clean(`<text font-family="&apos;함초롬바탕&apos;,serif" x='1"2'>&lt;&amp;&#44032;</text>`)
  assert.ok(r.svg.includes('font-family="&apos;함초롬바탕&apos;,serif"'))
  assert.ok(r.svg.includes('x="1&quot;2"'))
  assert.ok(r.svg.includes('>&lt;&amp;&#44032;</text>'))
})

test('comments, processing instructions and CDATA are handled', () => {
  const r = sanitizeSvg(`<?xml version="1.0"?><!-- a --><svg ${NS}><!-- b --><text><![CDATA[a<b&c]]></text></svg>`, 'p1-')
  assert.ok(!r.svg.includes('<!--') && !r.svg.includes('<?'))
  assert.ok(r.svg.includes('<text>a&lt;b&amp;c</text>'))
})

test('broken XML is a SanitizeError', () => {
  const broken = [
    '<svg><g></svg>',
    '<svg><g>',
    '<svg></g>',
    '<svg x="1></svg>',
    '<svg x=1></svg>',
    '<svg x="1" x="2"></svg>',
    '<svg x="a<b"></svg>',
    '<svg>a & b</svg>',
    '<svg>&nbsp;</svg>',
    '<svg><!-- open </svg>',
    '<svg/><svg/>',
    '<g/>',
    'text<svg/>',
    '',
    '<!DOCTYPE svg [<!ENTITY a "b">]><svg/>'
  ]
  for (const input of broken) {
    let error
    try {
      sanitizeSvg(input, 'p0-')
    } catch (e) {
      error = e
    }
    assert.ok(error instanceof SanitizeError, `should reject with SanitizeError: ${input} (got ${error})`)
  }
})

test('a prefix that is not a plain id fragment is refused', () => {
  assert.throws(() => sanitizeSvg('<svg/>', 'p"0'), (e) => e instanceof TypeError)
})

const fixtures = new URL('../../fixtures/', import.meta.url)
const samples = ['21868765_별표2_보건소_분장사무.hwp', '2025년 기부·답례품 실적 지자체 보고서_양식.hwpx']

test('rhwp sample SVG keeps every text element, image and clip reference', async () => {
  const present = samples.filter((name) => existsSync(new URL(name, fixtures)))
  if (present.length === 0) return // fixtures/ is fetched by scripts/fetch-fixtures.mjs
  const { initEngine, openDocument } = await import('../engine/rhwp-adapter.js')
  await initEngine(new Uint8Array(readFileSync(new URL('../vendor/rhwp/rhwp_bg.wasm', import.meta.url))))
  /** @param {string} s @param {RegExp} re */
  const count = (s, re) => (s.match(re) ?? []).length
  for (const name of present) {
    const doc = openDocument(new Uint8Array(readFileSync(new URL(name, fixtures))))
    try {
      for (let i = 0; i < doc.pageCount; i++) {
        const raw = doc.renderPageSvg(i)
        const r = sanitizeSvg(raw, `p${i}-`)
        assert.equal(count(r.svg, /<text[\s>]/g), count(raw, /<text[\s>]/g), `${name} page ${i + 1} text`)
        assert.equal(count(r.svg, /<image[\s>]/g), count(raw, /<image[\s>]/g), `${name} page ${i + 1} image`)
        assert.equal(count(r.svg, /url\(#p\d+-/g), count(raw, /url\(#/g), `${name} page ${i + 1} refs`)
        assert.equal(count(r.svg, / id="(?!p\d+-)/g), 0)
        assert.deepEqual(r.warnings, [], `${name} page ${i + 1} warnings`)
      }
    } finally {
      doc.dispose()
    }
  }
})
