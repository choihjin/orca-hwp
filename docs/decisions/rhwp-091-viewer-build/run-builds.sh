#!/bin/bash
set -euo pipefail
base_dir="$(cd "$(dirname "$0")" && pwd -P)"
export PATH="$HOME/.cargo/bin:$base_dir/binaryen-version_117/bin:$PATH"
export TMPDIR="$base_dir/process-tmp"
export WASM_PACK_CACHE="$HOME/.cargo/wasm-pack-cache"
export RUSTUP_HOME="$HOME/.rustup"
export CARGO_HOME="$HOME/.cargo"
export RUSTUP_TOOLCHAIN=1.93.1
export CARGO_INCREMENTAL=0
export CARGO_BUILD_JOBS=6
export RUST_LOG=wasm_pack::child=info
export RHWP_WASM_CDYLIB_ONLY=0
mkdir -p "$TMPDIR" "$base_dir/build-baseline" "$base_dir/build-light"
cd "$base_dir/rhwp-sparse"
variant="${1:-both}"
if [[ "$variant" == both || "$variant" == baseline ]]; then
  python3 scripts/measure_render_diff_wasm.py --profile release --build-mode standard --output "$base_dir/build-baseline" > "$base_dir/baseline.log" 2>&1
  cp target/wasm32-unknown-unknown/release/rhwp.wasm "$base_dir/build-baseline/linker.wasm"
  bash scripts/prepare-npm.sh > "$base_dir/build-baseline/prepare-npm.log" 2>&1
  cp -R pkg "$base_dir/build-baseline/package"
fi
if [[ "$variant" == both || "$variant" == light ]]; then
  sh scripts/wasm-pack-locked.sh --target web --release --out-dir "$base_dir/build-light/package" --no-default-features --features wasm-api > "$base_dir/build-light/build.log" 2>&1
  cp target/wasm32-unknown-unknown/release/rhwp.wasm "$base_dir/build-light/linker.wasm"
fi
