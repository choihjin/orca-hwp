"""Limit a pinned wasm-bindgen web build to the four viewer interfaces."""
import argparse
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("package", type=Path, help="Directory of the already optimized PDF-free web package")
parser.add_argument("viewer", type=Path, help="Output directory for the viewer-only build")
args = parser.parse_args()
package = args.package.resolve()
viewer = args.viewer.resolve()
if viewer == package or package in viewer.parents:
    parser.error("choose an output directory outside the input package")
viewer.mkdir(exist_ok=True)
out = viewer / "package"
out.mkdir(exist_ok=True)

keep = {
    "memory", "version", "__wbg_hwpdocument_free",
    "hwpdocument_new", "hwpdocument_pageCount", "hwpdocument_renderPageSvg", "hwpdocument_getPageText",
    "__wbindgen_malloc", "__wbindgen_realloc", "__wbindgen_free", "__wbindgen_start",
    "__wbindgen_exn_store", "__wbindgen_externrefs", "__externref_table_alloc", "__externref_table_dealloc",
}

def leb(data, cursor):
    value = 0
    for shift in range(0, 35, 7):
        byte = data[cursor]
        cursor += 1
        value |= (byte & 0x7f) << shift
        if byte < 128:
            return value, cursor
    raise ValueError("invalid LEB128")

def encode(value):
    result = bytearray()
    while value > 127:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)

wasm = (package / "rhwp_bg.wasm").read_bytes()
assert wasm[:8] == b"\x00asm\x01\x00\x00\x00"
output = bytearray(wasm[:8])
cursor = 8
found = set()
while cursor < len(wasm):
    start = cursor
    section = wasm[cursor]
    size, position = leb(wasm, cursor + 1)
    cursor = position + size
    if section != 7:
        output.extend(wasm[start:cursor])
        continue
    count, position = leb(wasm, position)
    names = []
    for _ in range(count):
        start = position
        length, position = leb(wasm, position)
        name = wasm[position:position+length].decode("utf-8")
        _, position = leb(wasm, position + length + 1)
        if name in keep:
            found.add(name)
            names.append(wasm[start:position])
    assert position == cursor
    exports = encode(len(names)) + b"".join(names)
    output.extend(b"\x07" + encode(len(exports)) + exports)
assert found == keep, f"missing: {keep-found}"
(viewer / "retained-exports.wasm").write_bytes(output)

glue = re.sub(r"^export (?=(?:class|function) )", "", (package / "rhwp.js").read_text(), flags=re.M)
glue += """
class ViewerDocument {
    #document;

    constructor(data) {
        this.#document = new HwpDocument(data);
    }

    pageCount() {
        return this.#document.pageCount();
    }

    renderPageSvg(page) {
        return this.#document.renderPageSvg(page);
    }

    getPageText(page) {
        return this.#document.getPageText(page);
    }

    free() {
        this.#document.free();
    }
}

export { ViewerDocument as HwpDocument, version };
"""
(out / "rhwp.js").write_text(glue)
(out / "rhwp.d.ts").write_text("""export class HwpDocument {
    constructor(data: Uint8Array);
    pageCount(): number;
    renderPageSvg(page: number): string;
    getPageText(page: number): string;
    free(): void;
}
export function version(): string;
export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;
export type SyncInitInput = BufferSource | WebAssembly.Module;
export function initSync(module: { module: SyncInitInput } | SyncInitInput): WebAssembly.Exports;
export default function init(
    module?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>,
): Promise<WebAssembly.Exports>;
""")
(out / "package.json").write_text('{"type":"module","main":"rhwp.js","types":"rhwp.d.ts"}\n')
