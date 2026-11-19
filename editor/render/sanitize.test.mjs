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
  const rebuilt = '@font-face{font-family:"A";src:url("data:font/woff2;base64,AAAA") format("woff2")}'
  const r = clean(
    `<style>/* c */ ${face} @font-face{font-family:B;src:url(https://e.com/b.woff2)} ` +
      `text{fill:red} @import url(x.css);</style><style><![CDATA[${face}]]></style>`
  )
  assert.ok(!r.svg.includes('<style'))
  assert.deepEqual(r.fontFaces, [rebuilt])
  assert.ok(r.warnings.length >= 3, r.warnings.join('\n'))
})

test('@font-face decodes XML entities, escapes markup in names and refuses CSS escapes in src', () => {
  const r = clean("<style>@font-face{font-family:&apos;A&apos;;src:url(data:font/ttf;base64,AA)}</style>")
  assert.deepEqual(r.fontFaces, ['@font-face{font-family:"A";src:url("data:font/ttf;base64,AA")}'])
  const markup = clean('<style>@font-face{font-family:"&lt;/style&gt;";src:url(data:font/ttf;base64,AA)}</style>')
  assert.deepEqual(markup.fontFaces, ['@font-face{font-family:"\\3c /style\\3e ";src:url("data:font/ttf;base64,AA")}'])
  const bad = clean('<style>@font-face{font-family:A;src:\\75rl(https://e.com/a)}</style>')
  assert.deepEqual(bad.fontFaces, [])
})

test('identical @font-face rules are kept once', () => {
  const face = '@font-face{font-family:A;src:url(data:font/ttf;base64,AA)}'
  const same = "@font-face { font-family: 'A' ; src: URL( 'data:font/ttf;base64,AA' ) }"
  assert.deepEqual(clean(`<style>${face}${face}</style><style>${same}</style>`).fontFaces, [
    '@font-face{font-family:"A";src:url("data:font/ttf;base64,AA")}'
  ])
})

test('markers and image colour filters that rhwp emits are kept and prefixed', () => {
  const body =
    '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 8 4 L 0 8 z"/></marker>' +
    '<filter id="rhwp-img-grayscale"><feColorMatrix type="matrix" values="1 0 0 0 0"/></filter>' +
    '<filter id="bc"><feComponentTransfer><feFuncR type="linear" slope="1.0000" intercept="0.0800"/></feComponentTransfer></filter></defs>' +
    '<line x1="0" y1="0" x2="5" y2="5" marker-end="url(#arrow)"/><g filter="url(#bc)"/>'
  const r = clean(body)
  assert.deepEqual(r.warnings, [])
  assert.ok(r.svg.includes('<marker id="p0-arrow" markerWidth="8"'))
  assert.ok(r.svg.includes('marker-end="url(#p0-arrow)"'))
  assert.ok(r.svg.includes('<g filter="url(#p0-bc)"/>'))
  assert.ok(r.svg.includes('<feFuncR type="linear" slope="1.0000" intercept="0.0800"/>'))
  assert.ok(!clean('<filter><feImage href="https://e.com/a.png"/></filter>').svg.includes('e.com'))
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

test('attribute values are decoded and re-escaped; text entities stay as they are', () => {
  const r = clean(`<text font-family="&apos;함초롬바탕&apos;,serif" x='1"2'>&lt;&amp;&#44032;</text>`)
  assert.ok(r.svg.includes(`font-family="'함초롬바탕',serif"`))
  assert.ok(r.svg.includes('x="1&quot;2"'))
  assert.ok(r.svg.includes('>&lt;&amp;&#44032;</text>'))
})

test('url() is judged after entity decoding, case-insensitively, with any quoting', () => {
  // equivalent spellings of a local reference are all kept and prefixed
  for (const fill of ['URL(#g)', 'url(&quot;#g&quot;)', "url( '#g' )", 'Url(&#x27;#g&#x27;)', 'url(&#35;g)', 'url(\t#g\n)']) {
    const r = clean(`<linearGradient id="g"/><rect fill="${fill}"/>`)
    assert.ok(r.svg.includes('<rect fill="url(#p0-g)"/>'), `${fill} -> ${r.svg}`)
    assert.deepEqual(r.warnings, [], fill)
  }
  // every spelling of an outside reference is removed
  for (const fill of [
    'URL(https://e.com/a)',
    'url(&quot;https://e.com/a&quot;)',
    '&#117;rl(https://e.com/a)',
    '&#x55;RL(https://e.com/a)',
    'url&#40;https://e.com/a)',
    'url(&#104;ttps://e.com/a)',
    'url( //e.com/a )',
    'url(data:image/svg+xml;base64,AA)',
    'u\\72l(https://e.com/a)',
    'image(https://e.com/a)',
    'url(#g) url(https://e.com/a)'
  ]) {
    const r = clean(`<rect fill="${fill}" width="1"/>`)
    assert.ok(r.svg.includes('<rect width="1"/>'), `${fill} -> ${r.svg}`)
    assert.equal(r.warnings.length, 1, fill)
  }
})

test('href is judged after entity decoding and whitespace trimming', () => {
  assert.ok(clean('<use href="&#35;g"/>').svg.includes('<use href="#p0-g"/>'))
  assert.ok(clean('<use xlink:href=" #g "/>').svg.includes('<use xlink:href="#p0-g"/>'))
  assert.ok(clean('<image href="&#100;ata:image/png;base64,AA"/>').svg.includes('<image href="data:image/png;base64,AA"/>'))
  for (const href of ['&#106;avascript:x', ' JAVASCRIPT:x', 'java&#x09;script:x', '&#x23;g&quot; onload=&quot;x', 'https://e.com/a']) {
    const r = clean(`<image href="${href}" width="1"/>`)
    assert.ok(r.svg.includes('<image width="1"/>'), `${href} -> ${r.svg}`)
  }
})

test('ids and references with markup characters are escaped, not broken out of', () => {
  const r = clean('<linearGradient id="a&amp;b&quot;c"/><rect fill="url(&quot;#a&amp;b&quot;)"/>')
  assert.ok(r.svg.includes('id="p0-a&amp;b&quot;c"'), r.svg)
  assert.ok(r.svg.includes('fill="url(#p0-a&amp;b)"'), r.svg)
})

test('@font-face src must be data: fonts only; mixed sources are refused', () => {
  for (const src of [
    'url(data:font/ttf;base64,AA),local(Fixture)',
    'local(Fixture),url(data:font/ttf;base64,AA)',
    'url(data:font/ttf;base64,AA),url(https://e.com/a.woff2)',
    'url(data:font/ttf;base64,AA) format(woff2),URL(&quot;//e.com/a&quot;)',
    'url(data:text/html;base64,AA)',
    'url(data:font/ttf;base64,AA) tech(color-COLRv1)'
  ]) {
    const r = clean(`<style>@font-face{font-family:A;src:${src}}</style>`)
    assert.deepEqual(r.fontFaces, [], src)
    assert.equal(r.warnings.length, 1, src)
  }
  const extra = clean('<style>@font-face{font-family:A;src:url(data:font/ttf;base64,AA);background:url(https://e.com)}</style>')
  assert.deepEqual(extra.fontFaces, [])
  const kept = clean(
    '<style>@font-face{font-family:"Noto Serif KR";font-weight:700;font-style:normal;unicode-range:U+AC00-D7A3;' +
      "src:url('data:font/woff2;base64,AA') format('woff2'),url(data:font/ttf;base64,BB)}</style>"
  )
  assert.deepEqual(kept.fontFaces, [
    '@font-face{font-family:"Noto Serif KR";font-weight:700;font-style:normal;unicode-range:U+AC00-D7A3;' +
      'src:url("data:font/woff2;base64,AA") format("woff2"),url("data:font/ttf;base64,BB")}'
  ])
})

test('safe CSS math functions in presentation attributes are kept', () => {
  for (const [attr, value] of [
    ['width', 'calc(25% + 2px)'],
    ['height', 'calc((100% - 4px) / 2)'],
    ['x', 'min(10px, 5%)'],
    ['stroke-width', 'clamp(1px, 0.5%, 3px)'],
    ['transform', 'translate(calc(10px + 1%), 0) rotate(45)']
  ]) {
    const r = clean(`<rect ${attr}="${value}"/>`)
    assert.ok(r.svg.includes(`<rect ${attr}="${value}"/>`), `${attr}=${value} -> ${r.svg}`)
    assert.deepEqual(r.warnings, [], value)
  }
  // a math function does not open a way to load anything
  for (const value of ['calc(url(https://e.com/a))', 'calc(1px + image(https://e.com/a))', 'min(var(--x), 1px)']) {
    assert.ok(clean(`<rect width="${value}" height="1"/>`).svg.includes('<rect height="1"/>'), value)
  }
})

test('@font-face family names are re-quoted and escaped, not refused', () => {
  const face = (/** @type {string} */ family) => clean(`<style>@font-face{font-family:${family};src:url(data:font/ttf;base64,AA)}</style>`)
  const rule = (/** @type {string} */ name) => `@font-face{font-family:"${name}";src:url("data:font/ttf;base64,AA")}`
  assert.deepEqual(face(`"D'Angelo"`).fontFaces, [rule("D'Angelo")])
  assert.deepEqual(face(`'Font (Body)'`).fontFaces, [rule('Font (Body)')])
  assert.deepEqual(face('Noto Serif KR').fontFaces, [rule('Noto Serif KR')])
  assert.deepEqual(face('"함초롬바탕; 확장"').fontFaces, [rule('함초롬바탕; 확장')])
  // CSS escapes in the string are decoded, then written back escaped
  assert.deepEqual(face(String.raw`"A\"B\\C\27 D"`).fontFaces, [rule(String.raw`A\"B\\C'D`)])
  // markup in a family name cannot close the stylesheet it is written into
  const markup = face('"&lt;/style&gt;&lt;script&gt;"').fontFaces
  assert.equal(markup.length, 1)
  assert.ok(!/[<>]/.test(markup[0]), markup[0])
  assert.ok(markup[0].includes(String.raw`font-family:"\3c /style\3e \3c script\3e "`), markup[0])
  // still refused: no name, two names, a function in an unquoted name
  for (const family of ['""', 'A, B', 'A(B)', '"A" B']) assert.deepEqual(face(family).fontFaces, [], family)
})

test('@font-face keeps safe descriptors such as font-feature-settings', () => {
  const r = clean(
    '<style>@font-face{font-family:A;src:url(data:font/ttf;base64,AA);' +
      `font-feature-settings:"liga" 1, 'kern' off;font-variation-settings:"wght" 400;font-variant:small-caps;` +
      'ascent-override:90%;descent-override:normal;size-adjust:105.5%}</style>'
  )
  assert.deepEqual(r.warnings, [])
  assert.deepEqual(r.fontFaces, [
    '@font-face{font-family:"A";src:url("data:font/ttf;base64,AA");' +
      `font-feature-settings:"liga" 1, 'kern' off;font-variation-settings:"wght" 400;font-variant:small-caps;` +
      'ascent-override:90%;descent-override:normal;size-adjust:105.5%}'
  ])
  for (const bad of ['font-feature-settings:url(https://e.com)', 'font-feature-settings:"toolong" 1', 'size-adjust:calc(1%)']) {
    assert.deepEqual(clean(`<style>@font-face{font-family:A;src:url(data:font/ttf;base64,AA);${bad}}</style>`).fontFaces, [], bad)
  }
})

test('an attribute gives the same result written plainly or with entities', () => {
  const values = ['a,b', 'a b', 'a.b', '#fff', '10%', 'a+b', 'x-y', 'bold', '1 2,3']
  const encode = (/** @type {string} */ v) => [...v].map((c) => (/[\w]/.test(c) ? c : `&#${c.codePointAt(0)};`)).join('')
  for (const attr of ['class', 'fill', 'font-weight', 'points', 'stroke-dasharray']) {
    for (const value of values) {
      const plain = clean(`<rect ${attr}="${value}"/>`)
      const encoded = clean(`<rect ${attr}="${encode(value)}"/>`)
      assert.equal(encoded.svg, plain.svg, `${attr}="${value}"`)
      assert.deepEqual(encoded.warnings, plain.warnings, `${attr}="${value}" warnings`)
    }
  }
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
