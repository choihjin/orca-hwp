#!/usr/bin/env bash
# Finds the installed Orca HWP Viewer plugin and runs its page renderer, so an agent never has to
# work out the plugin folder itself.
#
#   hwp-view.sh <file.hwp|file.hwpx> [agent-view options]   # PNG + text of a page (offline)
#   hwp-view.sh --shot <file>                              # Orca capture of the page the user is on
#   hwp-view.sh --plugin-dir                               # print the plugin folder
#
# agent-view options: --page N (from 1) --region x,y,w,h --scale S --out PATH --text --json
#                     --bundled-fonts-only.  Needs Node.js 22+ and the plugin installed in Orca.
# HWP_VIEWER_DIR overrides the folder (a development checkout, or an OS whose install path differs).
set -euo pipefail

ORCA="${ORCA_CLI_COMMAND:-orca}"

plugin_info() { # prints "<pluginKey>\t<contentHash or empty>\t<isDev>"
  "$ORCA" plugin list --json | node -e '
    let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
      const plugins = JSON.parse(s).result?.plugins ?? []
      const p = plugins.find((x) => /(^|\.)hwp-viewer$/.test(x.pluginKey ?? "") && x.status !== "disabled")
      if (!p) { console.error("HWP Viewer is not installed: orca plugin install choihjin/orca-hwp"); process.exit(3) }
      console.log([p.pluginKey, p.source?.contentHash ?? "", p.isDev ? "dev" : ""].join("\t"))
    })'
}

plugin_dir() {
  if [ -n "${HWP_VIEWER_DIR:-}" ]; then echo "$HWP_VIEWER_DIR"; return; fi
  IFS=$'\t' read -r key hash dev < <(plugin_info)
  if [ "$dev" = dev ] || [ -z "$hash" ]; then
    echo "$key is a development load; set HWP_VIEWER_DIR to its folder" >&2; exit 3
  fi
  for root in "$HOME/Library/Application Support/orca/plugins" "${XDG_CONFIG_HOME:-$HOME/.config}/orca/plugins"; do
    if [ -f "$root/$key/$hash/agent/agent-view.mjs" ]; then echo "$root/$key/$hash"; return; fi
  done
  echo "found $key ($hash) in Orca but not its folder; set HWP_VIEWER_DIR" >&2; exit 3
}

case "${1:-}" in
  ""|-h|--help) sed -n 2,11p "$0"; exit 2 ;;
  --plugin-dir) plugin_dir ;;
  --shot)
    file="${2:?usage: hwp-view.sh --shot <file>}"
    IFS=$'\t' read -r key _ _ < <(plugin_info)
    out="$(mktemp -d "${TMPDIR:-/tmp}/hwp-view.XXXXXX")/shot.png"   # not the agent's working folder
    "$ORCA" plugin shot "$key" --editor "$file" --width 1000 --height 1400 --out "$out" --json
    ;;
  *) dir=$(plugin_dir); exec node "$dir/agent/agent-view.mjs" "$@" ;;
esac
