#!/bin/bash
# Renders the plugin page images from the HTML sources in this folder.
#   assets/src/render.sh shots   # viewer PNGs of public samples (npm run fixtures first; current Orca theme)
#   assets/src/render.sh images  # icon, cover and screenshots with headless Chrome
# Only public sample documents go into these images.
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=assets/src
ORCA="${ORCA:-orca}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

shoot() { # name sample
  "$ORCA" plugin shot local.hwp-viewer --editor "fixtures/$2" --width 900 --height 1240 --out "$SRC/shots/$1-dark.png" --json >/dev/null
}

render() { # html-with-query out width height
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --user-data-dir="$PROFILE" --allow-file-access-from-files \
    --virtual-time-budget=3000 --window-size="$3,$4" --screenshot="$2" "file://$PWD/$SRC/$1" >/dev/null 2>&1
}

case "${1:-}" in
  shots)
    mkdir -p "$SRC/shots"
    shoot table '21868765_별표2_보건소_분장사무.hwp'
    shoot handbook '2025 행정업무운영 편람(최종).hwpx'
    node agent/agent-view.mjs 'fixtures/2022년 국립국어원 업무계획.hwp' --page 3 --region 100,410,640,108 \
      --scale 2 --bundled-fonts-only --out "$SRC/shots/agent-region.png" --json >/dev/null
    ;;
  images)
    mkdir -p assets/screenshots
    render icon.html assets/icon.png 512 512
    render "frame.html?slide=cover&theme=dark" assets/cover.png 1600 1000
    for slide in table large agent; do
      render "frame.html?slide=$slide&theme=dark" "assets/screenshots/$slide-dark.png" 1600 1000
    done
    ;;
  *) echo "usage: $0 shots|images" >&2; exit 2 ;;
esac
