#!/bin/sh
# Rebuild v0.8.7 with the pinned patches, then check WASM, glue and declarations.
# Requires Rust 1.93.1 with the wasm32-unknown-unknown target, wasm-pack 0.15.0,
# wasm-bindgen 0.2.127, and Binaryen wasm-opt version 117. Set WASM_OPT to an
# existing wasm-opt executable to use it instead of wasm-pack's cached binary.
# --install copies all four files into editor/vendor/rhwp/ after checking the pins.
# --install --force also copies a mismatched build (the check still exits nonzero).
# After installing a verified build, run npm run vendor:rhwp to refresh engine-info.js.
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
export PATH="$HOME/.cargo/bin:$PATH"

# Verify the ordered source patches before starting the build.
patches=$(pin 'p.patches.map(patch => patch.path).join("\n")')
for patch in $patches; do
  want_sha=$(pin "p.patches.find(patch => patch.path === '$patch').sha256")
  want_size=$(pin "p.patches.find(patch => patch.path === '$patch').size")
  got_sha=$(shasum -a 256 "$root/$patch" | cut -d' ' -f1)
  got_size=$(wc -c < "$root/$patch" | tr -d ' ')
  if [ "$got_sha" != "$want_sha" ] || [ "$got_size" != "$want_size" ]; then
    echo "$patch does NOT match the pin" >&2
    exit 1
  fi
done

work=$(mktemp -d "${TMPDIR:-/tmp}/rhwp-patched.XXXXXX")
echo "work folder: $work"
git clone --quiet --filter=blob:none --sparse --depth 1 --branch v0.8.7 https://github.com/edwardkim/rhwp.git "$work/rhwp"
test "$(git -C "$work/rhwp" rev-parse HEAD)" = "$base_commit" || { echo "v0.8.7 is not $base_commit" >&2; exit 1; }
# The upstream PDF corpus and research documents take several GB. Only check out
# the sources, workspace manifests, build inputs and tests touched by the patches.
git -C "$work/rhwp" sparse-checkout set src crates bindings scripts tests ttfs assets saved vendor \
  tools/rhwp-subsecond tools/batch-convert tools/llm_verifier tools/diagnostics tools/fixture_generators
for patch in $patches; do
  git -C "$work/rhwp" apply "$root/$patch"
done
(cd "$work/rhwp" && sh scripts/wasm-pack-locked.sh --target web --release --out-dir "$work/out")

files=$(pin 'Object.keys(p.files).join("\n")')
match=yes
for file in $files; do
  built="$work/out/$file"
  got_sha=$(shasum -a 256 "$built" | cut -d' ' -f1)
  got_size=$(wc -c < "$built" | tr -d ' ')
  echo "built $file $got_size B $got_sha"
  if [ "$got_sha" = "$(pin "p.files['$file'].sha256")" ] && [ "$got_size" = "$(pin "p.files['$file'].size")" ]; then
    echo "$file matches the pin"
  else
    echo "$file does NOT match the pin" >&2
    match=no
  fi
done

if [ "$install" = yes ]; then
  if [ "$match" = no ] && [ "$force" = no ]; then
    echo "not installed: pass --force to install a build that differs from the pin" >&2
    exit 1
  fi
  for file in $files; do
    cp "$work/out/$file" "$root/editor/vendor/rhwp/$file"
  done
fi
[ "$match" = yes ]
