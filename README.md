# HWP Viewer for Orca

Open Hangul word processor documents (`.hwpx`, `.hwp`) inside [Orca](https://github.com/stablyai/orca) without leaving the editor.

[한국어](README.ko.md)

## Status

The page viewer for `.hwp` and `.hwpx` is in development. It builds on the custom editor scaffold and uses rhwp to render document pages. See the [implementation plan](docs/superpowers/plans/2026-11-19-hwp-viewer.md).

## Read documents with an agent

Give your agent the [HWP viewing guide](docs/AGENTS.md) to capture the current page in Orca or render a specific page or region as a PNG and extract page text offline.

## Develop

```sh
orca plugin validate .
orca plugin test .
orca plugin dev watch .    # loads this folder into Orca and prints its logs and reloads; Ctrl-C unloads it
```

The editor runs in a sandboxed frame with no build step. A parsing or rendering library has to be copied into the plugin as an ESM build and imported by a relative path.

## Layout

| Path | What it is |
|---|---|
| `orca-plugin.json` | Manifest: one custom editor for `.hwpx` and `.hwp`, `contentKind: "bytes"` |
| `editor/main.ts` | Custom editor frame entry |
| `editor/format.js` | File kind detection by magic bytes, size formatting |
| `editor/format.test.ts` | Tests for `orca plugin test` |
| `agent/agent-view.mjs` | Offline page PNG and text CLI |
| `docs/AGENTS.md` | HWP viewing guide for agents (Korean) |

## Hancom and trademark notices

본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표입니다. 이 플러그인은 한글과컴퓨터와 관계없는 독립 프로젝트입니다.

This product was developed with reference to Hancom’s public documentation for the HWP document file format (.hwp).

“한글” (Hangul), “한컴” (Hancom), “HWP”, and “HWPX” are registered trademarks of Hancom Inc. This plugin is an independent project unaffiliated with Hancom Inc.

## License

MIT
