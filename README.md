# HWP Viewer for Orca

Open Hangul word processor documents (`.hwpx`, `.hwp`) inside [Orca](https://github.com/stablyai/orca) without leaving the editor.

[한국어](README.ko.md)

## Status

Early scaffold. The plugin registers as the editor for `.hwpx` and `.hwp`, reads the file as bytes, and shows the file kind and size. **It does not render the document yet.** The plan is in [docs/PLAN.ko.md](docs/PLAN.ko.md).

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
| `editor/main.ts` | The editor frame. Scaffold view only |
| `editor/format.ts` | File kind detection by magic bytes, size formatting |
| `editor/format.test.ts` | Tests for `orca plugin test` |
| `docs/PLAN.ko.md` | Scope, open questions and next steps (Korean) |

## License

MIT
