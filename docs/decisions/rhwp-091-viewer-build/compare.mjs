import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const sampleDir = join(root, 'rhwp-sparse', 'samples');
const output = resolve(process.argv[2] ?? join(root, 'comparison'));
const packages = process.argv.slice(3);
if (packages.length !== 2) throw Error('usage: node compare.mjs OUTPUT PACKAGE_A PACKAGE_B');

const samples = [
  ['nikl', '2022년 국립국어원 업무계획.hwp'],
  ['health-center-table', '21868765_별표2_보건소_분장사무.hwp'],
  ['row-width', 'issue5590_per_row_column_widths.hwpx'],
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const engines = await Promise.all(packages.map(async (pkg, i) => {
  const js = join(resolve(pkg), 'rhwp.js');
  const wasm = readFileSync(join(resolve(pkg), 'rhwp_bg.wasm'));
  const mod = await import(pathToFileURL(js));
  await mod.default({ module_or_path: wasm });
  const Document = mod.HwpDocument;
  if (typeof Document !== 'function') throw Error('Missing HwpDocument');
  const methods = Object.fromEntries(['pageCount', 'renderPageSvg', 'getPageText']
    .map((name) => [name, typeof Document.prototype[name]]));
  if (Object.values(methods).some((type) => type !== 'function')) throw Error(JSON.stringify(methods));
  const supportsPdf = Document.supportsPdfImport?.() ?? null;
  let disabledImportMessage = null;
  if (supportsPdf === false) {
    try {
      Document.importPdf(new Uint8Array(), undefined).free();
    } catch (error) {
      disabledImportMessage = String(error);
    }
  }
  const metadata = {
    package: resolve(pkg),
    version: mod.version?.() ?? null,
    wasmSha256: hash(wasm),
    jsSha256: hash(readFileSync(js)),
    wasmBytes: wasm.length,
    methods,
    supportsPdf,
    pdfFeatures: JSON.parse(Document.getPdfImportSupport?.() ?? 'null'),
    disabledImportMessage,
  };
  return { label: i === 0 ? 'a' : 'b', Document, metadata };
}));

const tsv = [
  ['sample', 'page', 'svg_a_bytes', 'svg_b_bytes', 'svg_b_minus_a', 'svg_equal',
    'text_a_bytes', 'text_b_bytes', 'text_equal', 'text_a_codepoints', 'text_b_codepoints'].join('\t'),
];
const results = [];
for (const [id, file] of samples) {
  const source = join(sampleDir, file);
  const bytes = readFileSync(source);
  const directory = join(output, id);
  mkdirSync(directory, { recursive: true });
  const renditions = engines.map(({ label, Document }) => {
    const doc = new Document(new Uint8Array(bytes));
    try {
      return Array.from({ length: doc.pageCount() }, (_, index) => {
        const svg = doc.renderPageSvg(index);
        const text = doc.getPageText(index);
        const prefix = join(directory, `p${String(index + 1).padStart(3, '0')}-${label}`);
        writeFileSync(`${prefix}.svg`, svg);
        writeFileSync(`${prefix}.txt`, text);
        return {
          svgBytes: Buffer.byteLength(svg),
          svgSha256: hash(svg),
          svgViewBox: svg.match(/\bviewBox="([^"]+)"/)?.[1] ?? null,
          textBytes: Buffer.byteLength(text),
          textCodePoints: [...text].length,
          textSha256: hash(text),
        };
      });
    } finally {
      doc.free();
    }
  });
  const [a, b] = renditions;
  const pages = Array.from({ length: Math.max(a.length, b.length) }, (_, index) => {
    const page = index + 1;
    const one = a[index] ?? null, two = b[index] ?? null;
    const svgEqual = one && two ? one.svgSha256 === two.svgSha256 : null;
    const textEqual = one && two ? one.textSha256 === two.textSha256 : null;
    const svgDelta = one && two ? two.svgBytes - one.svgBytes : null;
    tsv.push([file, page, one?.svgBytes, two?.svgBytes, svgDelta, svgEqual,
      one?.textBytes, two?.textBytes, textEqual, one?.textCodePoints, two?.textCodePoints]
      .map((value) => value ?? '—').join('\t'));
    return { page, a: one, b: two, svgEqual, textEqual, svgDelta };
  });
  results.push({ id, file: basename(source), sourceSha256: hash(bytes), pageCounts: [a.length, b.length], pages });
}
writeFileSync(join(output, 'pages.tsv'), tsv.join('\n') + '\n');
writeFileSync(join(output, 'results.json'), JSON.stringify({ engines: engines.map((e) => e.metadata), results }, null, 2) + '\n');
