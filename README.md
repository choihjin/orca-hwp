# HWP Viewer for Orca

A read-only, page-by-page viewer for Hangul word processor documents (`.hwpx`, `.hwp`) inside [Orca](https://github.com/stablyai/orca). Orca's agents can get the same view as a PNG, so they can check how a document actually looks.

[한국어](README.ko.md)

## Status (0.1.0, 2026-11-20)

- Renders `.hwp` (HWP 5.x) and `.hwpx` page by page with the [rhwp](https://github.com/edwardkim/rhwp) 0.8.7 engine plus a pagination patch (our own build, `0.8.7-p1`; it fixes a page per table when one paragraph holds many inline tables and text boxes, see the [decision record](docs/decisions/2026-11-20-rhwp-tac-pagination-patch.md), Korean), including tables, images, headers and footers, and mixed portrait and landscape pages.
- Draws the visible pages first and the rest as you scroll, so the first page of a document with hundreds of pages appears right away.
- Remembers the last page and zoom for each document.
- Works offline and asks for no plugin capabilities. It ships 13 open (OFL) fonts for Korean text and prefers the document's original fonts, such as HCR Batang, when they are installed.
- Shows a message for damaged files, files that are not Hangul documents, password-protected documents and empty documents. Password-protected documents are not opened.

Limits:

- Pages are drawn by rhwp and can differ from Hancom Office. Line and page breaks differed in a document with complex tables that cross pages ([decision record](docs/decisions/2026-11-19-phase2-integration.md), Korean).
- No editing, saving, printing or in-document search yet.
- Orca desktop app only. Browser clients (`orca serve`) cannot open it.

## Install

It is not in an Orca catalog yet. Install it from GitHub:

```sh
orca plugin install choihjin/orca-hwp
```

When Orca prints an approval fingerprint, check what it grants (no capabilities, an editor for `.hwp` and `.hwpx`) and run the command again with `--approve <fingerprint>`. Requires Orca 1.4.248 or later.

## Use

Opening a `.hwp` or `.hwpx` file in Orca opens the viewer.

| Key | Action |
|---|---|
| `PageDown` / `PageUp` | Next / previous page |
| `Home` / `End` | First / last page |
| Type a number, then `Enter` | Go to that page |
| `+` / `-` / `0` | Zoom in / out / fit page width |

The status bar at the top shows the format, current page, zoom and engine version. Its ⓘ button shows the notices and licenses.

## Read documents with an agent

Point your agent at the [HWP viewing guide](docs/AGENTS.md) (Korean). An agent can:

- capture the page you are viewing with `orca plugin shot`;
- render any page or region as a PNG and get the page text with `agent/agent-view.mjs`, which ships with the plugin. It works offline from any project and needs Node.js 22 or later.

## Develop

```sh
pnpm install
orca plugin types .
npm run typecheck
orca plugin test .
npm run fixtures      # download public sample documents into fixtures/ (git-ignored)
npm run acceptance    # compare the samples with Hancom's reference PDFs
npm run check:size    # check Orca's size limits
orca plugin dev watch .
```

The editor runs with no build step. Third-party files (rhwp, fonts, PNG renderer) are downloaded and hash-checked by the scripts in `build/` (`npm run vendor:rhwp`, `vendor:fonts`, `vendor:resvg`). `npm run notices` writes the third-party notices. The engine WASM is built from v0.8.7 with the patch in `build/rhwp-patches/`; `build/build-rhwp-patched.sh` rebuilds it and compares the hash with the pin (needs a Rust toolchain).

| Path | What it is |
|---|---|
| `editor/` | The viewer. Only `editor/engine/rhwp-adapter.js` imports rhwp |
| `editor/render/sanitize.js` | Sanitizes the SVG that comes from a document before it is shown |
| `editor/vendor/`, `editor/fonts/` | Pinned rhwp and fonts |
| `agent/` | The agent page renderer and its PNG renderer |
| `build/` | Pinning and checking third-party files, notices, size checks |
| `scripts/` | Sample downloads and the acceptance check |
| `docs/` | [Design](docs/superpowers/specs/2026-11-19-hwp-viewer-design.md), [implementation plan](docs/superpowers/plans/2026-11-19-hwp-viewer.md), [decision records](docs/decisions/), [plan](docs/PLAN.ko.md) (all Korean) |

## Hancom and trademark notices

본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표입니다. 이 플러그인은 한글과컴퓨터와 관계없는 독립 프로젝트입니다.

This product was developed with reference to Hancom's public documentation for the HWP document file format (.hwp).

"한글" (Hangul), "한컴" (Hancom), "HWP", and "HWPX" are registered trademarks of Hancom Inc. This plugin is an independent project unaffiliated with Hancom Inc.

## License

MIT. Licenses for the bundled rhwp, fonts, PNG renderer and other components are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
