#!/bin/bash
set -euo pipefail
base_dir="$(cd "$(dirname "$0")" && pwd -P)"
cd "$base_dir"
export TMPDIR="$base_dir/process-tmp"
light_dir="${1:-build-light}"
node compare.mjs comparison npm-087/package "$light_dir/package"
node compare.mjs compare-same-version build-baseline/package "$light_dir/package"
node compare.mjs compare-published build-baseline/package npm-091/package
python3 render-thumbnails.py comparison thumbnails > thumbnails.log
mkdir -p panels
for pair in nikl/p001 nikl/p020 nikl/p031 health-center-table/p001 row-width/p001; do
  ffmpeg -v error -i "thumbnails/$pair-a.svg.png" -i "thumbnails/$pair-b.svg.png" \
    -filter_complex hstack -frames:v 1 -y -update 1 "panels/${pair/\//-}.png"
done
