// Small HWPX documents from XML text, made while a test runs: no document is committed
// (scripts/testdata/README.md). Only the structure the tests need, written by hand; whether Hancom
// Office opens them has not been checked. Plain ESM, Node only.
import { crc32 } from 'node:zlib'

/** The time stamp of every entry, so the same text gives the same bytes: 1980-01-01 00:00. */
const DOS_DATE = 0x21
const UTF8_NAMES = 0x800
const VERSION = 20

/**
 * A ZIP without compression. `mimetype` comes first, as HWPX wants it; the others keep their order.
 * @param {Record<string, string>} parts file name in the package, to its text
 * @returns {Uint8Array}
 */
export function hwpxFromText(parts) {
  const all = { mimetype: 'application/hwp+zip', ...parts }
  /** @type {Buffer[]} */
  const files = []
  /** @type {Buffer[]} */
  const directory = []
  let offset = 0
  for (const [name, text] of Object.entries(all)) {
    const nameBytes = Buffer.from(name, 'utf8')
    const data = Buffer.from(text, 'utf8')
    // The fields both headers share: from the version to the length of the extra field.
    const common = Buffer.alloc(26)
    common.writeUInt16LE(VERSION, 0)
    common.writeUInt16LE(UTF8_NAMES, 2)
    common.writeUInt16LE(DOS_DATE, 8)
    common.writeUInt32LE(crc32(data), 10)
    common.writeUInt32LE(data.length, 14)
    common.writeUInt32LE(data.length, 18)
    common.writeUInt16LE(nameBytes.length, 22)
    const local = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), common, nameBytes, data])
    const made = Buffer.alloc(2)
    made.writeUInt16LE(VERSION, 0)
    const place = Buffer.alloc(14)
    place.writeUInt32LE(offset, 10)
    directory.push(Buffer.concat([Buffer.from('PK\x01\x02', 'latin1'), made, common, place, nameBytes]))
    files.push(local)
    offset += local.length
  }
  const central = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.write('PK\x05\x06', 'latin1')
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...files, central, end]))
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const HWPML = 'http://www.hancom.co.kr/hwpml/2011'
const NAMESPACES = [
  ['hp', `${HWPML}/paragraph`],
  ['hs', `${HWPML}/section`],
  ['hc', `${HWPML}/core`],
  ['hh', `${HWPML}/head`],
  ['hm', `${HWPML}/master-page`],
  ['opf', 'http://www.idpf.org/2007/opf/']
].map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`).join(' ')

/** @param {string} text */
const escapeXml = (text) =>
  text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char)

// What is below gives the pieces of section XML as strings; they are put together with `+`.

/** @param {string} text */
export const text = (text) => `<hp:t>${escapeXml(text)}</hp:t>`

/** @param {string} xml */
const ctrl = (xml) => `<hp:ctrl>${xml}</hp:ctrl>`

/**
 * @param {string} content runs of text and controls
 * @param {{ pageBreak?: boolean }} [options]
 */
export const para = (content, { pageBreak = false } = {}) =>
  `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">` +
  `<hp:run charPrIDRef="0">${content}</hp:run></hp:p>`

/** @param {string} paras */
const subList = (paras, attributes = '') =>
  `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP"${attributes}>${paras}</hp:subList>`

/**
 * 100 ns since 1601 in the two halves the MEMO command has, `low/high`.
 * @param {string} iso
 */
export function filetime(iso) {
  const ticks = (BigInt(Date.parse(iso)) + 11_644_473_600_000n) * 10_000n
  return `${ticks & 0xffff_ffffn}/${ticks >> 32n}`
}

/**
 * `time` is the two halves of a FILETIME as the command has them; `created` is the CreateDateTime
 * text; a null leaves the thing out. `command: false` leaves the whole MEMO command out. `body` is
 * the memo's text, one paragraph for each line; null leaves the list of paragraphs out.
 * @typedef {{
 *   author?: string, body?: string | null, time?: string, created?: string | null,
 *   command?: boolean, authorParam?: boolean
 * }} MemoSpec
 */

/**
 * The start of a memo; `memoEnd` with the same number ends it.
 * @param {number} number
 * @param {MemoSpec} [spec]
 */
export function memoStart(number, spec = {}) {
  const { author = '검토자', body = `메모 ${number}`, time = '0/0', created = null, command = true, authorParam = true } = spec
  const params = [
    command && `<hp:stringParam name="Command">${escapeXml(`MEMO/65535/${number}/${time}/${author}/\;;`)}</hp:stringParam>`,
    `<hp:integerParam name="Number">${number}</hp:integerParam>`,
    authorParam && `<hp:stringParam name="Author">${escapeXml(author)}</hp:stringParam>`,
    created !== null && `<hp:stringParam name="CreateDateTime">${escapeXml(created)}</hp:stringParam>`
  ].filter((param) => param !== false)
  const list = body === null ? '' : subList(body.split('\n').map((line) => para(text(line))).join(''))
  return ctrl(
    `<hp:fieldBegin id="${number}" type="MEMO" name="" editable="1" dirty="1">` +
      `<hp:parameters cnt="${params.length}" name="">${params.join('')}</hp:parameters>${list}</hp:fieldBegin>`
  )
}

/** @param {number} number */
export const memoEnd = (number) => ctrl(`<hp:fieldEnd beginIDRef="${number}" fieldid="0"/>`)

/**
 * A memo on `content`.
 * @param {number} number
 * @param {string} content
 * @param {MemoSpec} [spec]
 */
export const memo = (number, content, spec) => memoStart(number, spec) + content + memoEnd(number)

/** @param {string} paras */
export const footnote = (paras, number = 1) =>
  ctrl(`<hp:footNote number="${number}" suffixChar="41" instId="${100 + number}">${subList(paras)}</hp:footNote>`)

/** @param {string} paras */
export const endnote = (paras, number = 1) =>
  ctrl(`<hp:endNote number="${number}" suffixChar="41" instId="${200 + number}">${subList(paras)}</hp:endNote>`)

/**
 * @param {'header' | 'footer'} kind
 * @param {string} paras
 */
export const pageEdge = (kind, paras) =>
  ctrl(`<hp:${kind} id="1" applyPageType="BOTH">${subList(paras, ' textWidth="42520" textHeight="4252"')}</hp:${kind}>`)

const CELL = { width: 20000, height: 1500 }
const MARGIN = 'left="141" right="141" top="141" bottom="141"'

/** @param {string} paras */
const caption = (paras) =>
  `<hp:caption side="BOTTOM" fullSz="0" width="8504" gap="850" lastWidth="40000">${subList(paras)}</hp:caption>`

/** @param {boolean} inline */
const position = (inline, vertical = 0, horizontal = 0) =>
  `<hp:pos treatAsChar="${inline ? 1 : 0}" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
  `vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="${vertical}" horzOffset="${horizontal}"/>`

/**
 * @param {string[][]} rows paragraphs of each cell
 * @param {{ inline?: boolean, captionParas?: string, headerRow?: boolean }} [options] `headerRow`
 *   repeats the first row on every page; a table that is not `inline` can be split over pages
 */
export function table(rows, { inline = true, captionParas, headerRow = false } = {}) {
  const height = rows.length * CELL.height
  const cells = rows.map((row, r) => {
    const tcs = row.map(
      (paras, c) =>
        `<hp:tc name="" header="${headerRow && r === 0 ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="2">` +
        `${subList(paras)}<hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/>` +
        `<hp:cellSz width="${CELL.width}" height="${CELL.height}"/><hp:cellMargin ${MARGIN}/></hp:tc>`
    )
    return `<hp:tr>${tcs.join('')}</hp:tr>`
  })
  return (
    `<hp:tbl id="1" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" ` +
    `pageBreak="CELL" repeatHeader="${headerRow ? 1 : 0}" rowCnt="${rows.length}" colCnt="${rows[0].length}" cellSpacing="0" borderFillIDRef="2" noAdjust="0">` +
    `<hp:sz width="${rows[0].length * CELL.width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `${position(inline)}<hp:outMargin ${MARGIN}/>${captionParas === undefined ? '' : caption(captionParas)}` +
    `<hp:inMargin ${MARGIN}/>${cells.join('')}</hp:tbl>`
  )
}

const IDENTITY = 'e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"'

/**
 * @param {number} width
 * @param {number} height
 */
const shapeSize = (width, height, x = 0, y = 0) =>
  `<hp:offset x="${x}" y="${y}"/><hp:orgSz width="${width}" height="${height}"/><hp:curSz width="${width}" height="${height}"/>` +
  '<hp:flip horizontal="0" vertical="0"/>' +
  `<hp:renderingInfo><hc:transMatrix ${IDENTITY.replace('e3="0"', `e3="${x}"`).replace('e6="0"', `e6="${y}"`)}/>` +
  `<hc:scaMatrix ${IDENTITY}/><hc:rotMatrix ${IDENTITY}/></hp:renderingInfo>`

/**
 * @param {number} width
 * @param {number} height
 * @param {string} place
 */
const shapeFrame = (width, height, place) =>
  `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
  `${place}<hp:outMargin left="0" right="0" top="0" bottom="0"/>`

const BOX = { width: 20000, height: 4000 }

/**
 * @param {string} paras
 * @param {string} layout
 */
const rect = (paras, layout, groupLevel = 0) =>
  `<hp:rect id="1" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" groupLevel="${groupLevel}" instid="1" ratio="0">` +
  `${layout}<hp:lineShape color="#000000" width="33" style="SOLID" endCap="FLAT" headStyle="NORMAL" tailStyle="NORMAL" headfill="1" tailfill="1" headSz="MEDIUM_MEDIUM" tailSz="MEDIUM_MEDIUM" outlineStyle="NORMAL" alpha="0"/>` +
  `<hp:drawText lastWidth="${BOX.width}" name="" editable="0">${subList(paras)}<hp:textMargin left="283" right="283" top="283" bottom="283"/></hp:drawText>` +
  `<hc:pt0 x="0" y="0"/><hc:pt1 x="${BOX.width}" y="0"/><hc:pt2 x="${BOX.width}" y="${BOX.height}"/><hc:pt3 x="0" y="${BOX.height}"/></hp:rect>`

/** @param {string} paras */
export const textBox = (paras, { inline = true } = {}) =>
  rect(paras, shapeSize(BOX.width, BOX.height) + shapeFrame(BOX.width, BOX.height, position(inline)))

/**
 * Text boxes next to each other in one drawing object.
 * @param {string[]} boxes the paragraphs of each
 */
export function groupedBoxes(boxes, { inline = true } = {}) {
  const width = boxes.length * BOX.width
  return (
    '<hp:container id="1" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" groupLevel="0" instid="1">' +
    shapeSize(width, BOX.height) +
    boxes.map((paras, i) => rect(paras, shapeSize(BOX.width, BOX.height, i * BOX.width), 1)).join('') +
    `${shapeFrame(width, BOX.height, position(inline))}</hp:container>`
  )
}

// A4 upright: 42,520 wide and 65,762 high between the margins, in 1/7200 inch.
const SECTION_DEFINITION = (/** @type {string[]} */ masterPages) =>
  '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" outlineShapeIDRef="0" memoShapeIDRef="0" ' +
  `textVerticalWidthHead="0" masterPageCnt="${masterPages.length}"><hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>` +
  '<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>' +
  '<hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY">' +
  '<hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504" top="5668" bottom="4252"/></hp:pagePr>' +
  `${masterPages.map((id) => `<hp:masterPage idRef="${id}"/>`).join('')}</hp:secPr>`

/**
 * @param {string[]} paras each made with `para`
 * @param {string[]} masterPages manifest ids
 */
function sectionXml(paras, masterPages) {
  const [first = para(''), ...rest] = paras
  const definition = `<hp:run charPrIDRef="0">${SECTION_DEFINITION(masterPages)}${ctrl('<hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/>')}</hp:run>`
  const at = first.indexOf('<hp:run')
  return `${XML}<hs:sec ${NAMESPACES}>${first.slice(0, at)}${definition}${first.slice(at)}${rest.join('')}</hs:sec>`
}

/** @param {string} paras */
const masterPageXml = (paras) =>
  `${XML}<hm:masterPage ${NAMESPACES} id="masterpage0" type="BOTH" pageNumber="0" pageDuplicate="0" pageFront="0">` +
  `${subList(paras, ' textWidth="42520" textHeight="65762"')}</hm:masterPage>`

const LANGUAGES = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER']

/** @param {number} value */
const forLanguages = (value) => LANGUAGES.map((name) => `${name.toLowerCase()}="${value}"`).join(' ')

/**
 * @param {number} id
 * @param {'NONE' | 'SOLID'} line
 */
const borderFill = (id, line) =>
  `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
  ['left', 'right', 'top', 'bottom'].map((side) => `<hh:${side}Border type="${line}" width="0.12 mm" color="#000000"/>`).join('') +
  '</hh:borderFill>'

/** One font, one character shape of 10 pt, one paragraph shape with 160 % line spacing. */
const headerXml = (/** @type {number} */ sections) =>
  `${XML}<hh:head ${NAMESPACES} version="1.4" secCnt="${sections}"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList>` +
  `<hh:fontfaces itemCnt="7">${LANGUAGES.map((lang) => `<hh:fontface lang="${lang}" fontCnt="1"><hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0"/></hh:fontface>`).join('')}</hh:fontfaces>` +
  `<hh:borderFills itemCnt="2">${borderFill(1, 'NONE')}${borderFill(2, 'SOLID')}</hh:borderFills>` +
  '<hh:charProperties itemCnt="1"><hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">' +
  `<hh:fontRef ${forLanguages(0)}/><hh:ratio ${forLanguages(100)}/><hh:spacing ${forLanguages(0)}/><hh:relSz ${forLanguages(100)}/><hh:offset ${forLanguages(0)}/></hh:charPr></hh:charProperties>` +
  '<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>' +
  '<hh:paraProperties itemCnt="1"><hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">' +
  '<hh:align horizontal="LEFT" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>' +
  '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>' +
  `<hh:margin>${['intent', 'left', 'right', 'prev', 'next'].map((name) => `<hc:${name} value="0" unit="HWPUNIT"/>`).join('')}</hh:margin>` +
  '<hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/><hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>' +
  '</hh:paraPr></hh:paraProperties>' +
  '<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>' +
  '</hh:refList></hh:head>'

/**
 * @param {string[]} sections
 * @param {boolean} masterPage
 */
const manifestXml = (sections, masterPage) =>
  `${XML}<opf:package ${NAMESPACES} version="" unique-identifier="" id=""><opf:metadata><opf:title/><opf:language>ko</opf:language></opf:metadata><opf:manifest>` +
  '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>' +
  (masterPage ? '<opf:item id="masterpage0" href="Contents/masterpage0.xml" media-type="application/xml"/>' : '') +
  sections.map((id) => `<opf:item id="${id}" href="Contents/${id}.xml" media-type="application/xml"/>`).join('') +
  `</opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/>${sections.map((id) => `<opf:itemref idref="${id}" linear="yes"/>`).join('')}</opf:spine></opf:package>`

/**
 * The parts of a document. Each section is a list of paragraphs made with `para`; a string in place
 * of the list is the section's XML as it is, for damaged ones.
 * @param {{ sections: (string[] | string)[], masterPage?: string }} spec `masterPage`: paragraphs,
 *   used by every section
 * @returns {Record<string, string>}
 */
export function memoParts({ sections, masterPage }) {
  const ids = sections.map((_, i) => `section${i}`)
  return {
    'version.xml': `${XML}<hv:HCFVersion xmlns:hv="${HWPML}/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="orca-hwp test"/>`,
    'META-INF/container.xml':
      `${XML}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"><ocf:rootfiles>` +
      '<ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>',
    'Contents/content.hpf': manifestXml(ids, masterPage !== undefined),
    'Contents/header.xml': headerXml(sections.length),
    ...(masterPage === undefined ? {} : { 'Contents/masterpage0.xml': masterPageXml(masterPage) }),
    ...Object.fromEntries(
      sections.map((section, i) => [
        `Contents/${ids[i]}.xml`,
        typeof section === 'string' ? section : sectionXml(section, masterPage === undefined ? [] : ['masterpage0'])
      ])
    )
  }
}

/**
 * @param {Parameters<typeof memoParts>[0]} spec
 * @returns {Uint8Array}
 */
export const memoHwpx = (spec) => hwpxFromText(memoParts(spec))
