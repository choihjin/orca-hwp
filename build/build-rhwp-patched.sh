#!/bin/sh
# Rebuilds the patched rhwp engine (pins.rhwp.patched in build/pins.json): rhwp v0.8.7 plus
# build/rhwp-patches/v0.8.7-tac-sibling-reset.diff, compiled to WASM. Prints the SHA-256 and
# compares it with the pin. With --install it copies the WASM into editor/vendor/rhwp/ (only when
# it matches the pin, unless --force), then run `npm run vendor:rhwp` to refresh engine-info.js.
#
# Needs, on PATH or in ~/.cargo/bin: rustup with Rust 1.93.1 and the wasm32-unknown-unknown target,
# wasm-pack 0.15.0 and wasm-bindgen 0.2.127. wasm-pack fetches wasm-opt (binaryen) itself unless
# WASM_OPT points at one. Steps used for the pinned build: docs/decisions/2026-11-20-rhwp-tac-pagination-patch.md
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
install=no
force=no
for arg in "$@"; do
  case "$arg" in
    --install) install=yes ;;
    --force) force=yes ;;
    *) echo "usage: $0 [--install [--force]]" >&2; exit 2 ;;
  esac
done

pin() { node -e "const p=require('$here/pins.json').rhwp.patched; console.log($1)"; }
base_commit=1a76570e833917d15817415a53c09ad61ab3203f
patch="$root/$(pin 'p.patch.path')"
want_sha=$(pin 'p.wasm.sha256')
want_size=$(pin 'p.wasm.size')
export PATH="$HOME/.cargo/bin:$PATH"

work=$(mktemp -d "${TMPDIR:-/tmp}/rhwp-patched.XXXXXX")
echo "work folder: $work"
git clone --quiet --depth 1 --branch v0.8.7 https://github.com/edwardkim/rhwp.git "$work/rhwp"
test "$(git -C "$work/rhwp" rev-parse HEAD)" = "$base_commit" || { echo "v0.8.7 is not $base_commit" >&2; exit 1; }
git -C "$work/rhwp" apply "$patch"
(cd "$work/rhwp" && sh scripts/wasm-pack-locked.sh --target web --release --out-dir "$work/out")

built="$work/out/rhwp_bg.wasm"
got_sha=$(shasum -a 256 "$built" | cut -d' ' -f1)
got_size=$(wc -c < "$built" | tr -d ' ')
echo "built  rhwp_bg.wasm $got_size B $got_sha"
echo "pinned rhwp_bg.wasm $want_size B $want_sha"
if cmp -s "$work/out/rhwp.js" "$root/editor/vendor/rhwp/rhwp.js"; then
  echo "rhwp.js matches the vendored npm glue"
else
  echo "warning: rhwp.js differs from the vendored npm glue" >&2
fi

if [ "$got_sha" = "$want_sha" ]; then
  echo "matches the pin"
  match=yes
else
  echo "does NOT match the pin (toolchain or upstream change?)" >&2
  match=no
fi

if [ "$install" = yes ]; then
  if [ "$match" = yes ] || [ "$force" = yes ]; then
    cp "$built" "$root/editor/vendor/rhwp/rhwp_bg.wasm"
    echo "installed into editor/vendor/rhwp/; if the hash changed, update pins.rhwp.patched.wasm and run npm run vendor:rhwp"
  else
    echo "not installed: pass --force to install a build that differs from the pin" >&2
    exit 1
  fi
fi
[ "$match" = yes ]
