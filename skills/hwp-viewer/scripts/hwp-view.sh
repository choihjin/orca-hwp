#!/usr/bin/env bash
# Finds the HWP Reader renderer (the Orca plugin's agent/agent-view.mjs) and runs it, so an agent
# never has to work out the plugin folder itself. Works without Orca too (servers, CI).
#
#   hwp-view.sh <file.hwp|file.hwpx> [agent-view options]   # PNG + text of a page (offline)
#   hwp-view.sh --shot <file>        # Orca capture of the page the user is on (Orca desktop app only)
#   hwp-view.sh --plugin-dir         # print the renderer folder in use
#   hwp-view.sh --fetch [vX.Y.Z]     # download the plugin (newest tag) into the cache, for machines
#                                    # without the Orca desktop app; uses the network
#
# agent-view options: --page N (from 1) --region x,y,w,h --scale S --out PATH --text --json
#                     --bundled-fonts-only.  Needs Node.js 22+.
# Renderer lookup: $HWP_VIEWER_DIR, the plugin installed in Orca, the repository checkout this
# script sits in, then the cache (${XDG_CACHE_HOME:-~/.cache}/orca-hwp).
set -euo pipefail

ORCA="${ORCA_CLI_COMMAND:-orca}"
REPO_URL="https://github.com/choihjin/orca-hwp"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/orca-hwp"
here=$(cd "$(dirname "$0")" && pwd)

has_renderer() { [ -f "$1/agent/agent-view.mjs" ] && [ -f "$1/editor/vendor/rhwp/rhwp_bg.wasm" ]; }

plugin_info() { # prints "<pluginKey>\t<contentHash or empty>\t<isDev>"; fails quietly without Orca
  "$ORCA" plugin list --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
      let plugins = []
      try { plugins = JSON.parse(s).result?.plugins ?? [] } catch { process.exit(4) }
      const p = plugins.find((x) => /(^|\.)hwp-viewer$/.test(x.pluginKey ?? "") && x.status !== "disabled")
      if (!p) process.exit(3)
      console.log([p.pluginKey, p.source?.contentHash ?? "", p.isDev ? "dev" : ""].join("\t"))
    })'
}

installed_dir() {
  local info key hash dev root
  info=$(plugin_info) || return 1
  IFS=$'\t' read -r key hash dev <<< "$info"
  [ "$dev" = dev ] || [ -z "$hash" ] && return 1
  for root in "$HOME/Library/Application Support/orca/plugins" "${XDG_CONFIG_HOME:-$HOME/.config}/orca/plugins"; do
    has_renderer "$root/$key/$hash" && { echo "$root/$key/$hash"; return 0; }
  done
  return 1
}

plugin_dir() {
  if [ -n "${HWP_VIEWER_DIR:-}" ]; then
    has_renderer "$HWP_VIEWER_DIR" || { echo "HWP_VIEWER_DIR=$HWP_VIEWER_DIR has no agent/agent-view.mjs or rhwp WASM" >&2; exit 3; }
    echo "$HWP_VIEWER_DIR"; return
  fi
  installed_dir && return
  local checkout; checkout=$(cd "$here/../../.." 2>/dev/null && pwd || true)
  if [ -n "$checkout" ] && has_renderer "$checkout"; then echo "$checkout"; return; fi
  if has_renderer "$CACHE"; then echo "$CACHE"; return; fi
  cat >&2 <<EOF
HWP Reader renderer not found: no Orca plugin here (Orca not installed, or a headless runtime
without the plugin service), no repository checkout, and nothing in $CACHE.
  - Desktop with Orca: orca plugin install choihjin/orca-hwp
  - Anywhere else:     $0 --fetch      (downloads the newest release tag into the cache)
  - Or point HWP_VIEWER_DIR at a clone of $REPO_URL
EOF
  exit 3
}

fetch() {
  local tag="${1:-}"
  if [ -z "$tag" ]; then
    tag=$(git ls-remote --tags --refs "$REPO_URL" 'v*' | sed 's#.*/##' | sed 's/^v//' \
      | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
    [ -n "$tag" ] || { echo "no release tag found at $REPO_URL" >&2; exit 1; }
    tag="v$tag"
  fi
  local err; tmp=$(mktemp -d "${TMPDIR:-/tmp}/orca-hwp-fetch.XXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  # git's detached-HEAD advice and "tag is not a commit" warning are noise here; show them on failure
  err=$(git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$tag" "$REPO_URL" "$tmp/orca-hwp" 2>&1) \
    || { echo "could not fetch $tag from $REPO_URL:" >&2; echo "$err" >&2; exit 1; }
  has_renderer "$tmp/orca-hwp" || { echo "$tag has no renderer" >&2; exit 1; }
  mkdir -p "$(dirname "$CACHE")"
  rm -rf "$CACHE"
  mv "$tmp/orca-hwp" "$CACHE"
  echo "fetched $tag into $CACHE (rhwp $(node -e 'import(require("url").pathToFileURL(process.argv[1]).href).then((m) => console.log(m.ENGINE_INFO.version))' "$CACHE/editor/vendor/rhwp/engine-info.js"))"
}

case "${1:-}" in
  ""|-h|--help) sed -n 2,15p "$0"; exit 2 ;;
  --plugin-dir) plugin_dir ;;
  --fetch) fetch "${2:-}" ;;
  --shot)
    file="${2:?usage: hwp-view.sh --shot <file>}"
    hint="--shot needs the Orca desktop app with this plugin installed; a headless runtime (orca serve) answers \"Plugin service is not available on this runtime\". Render the page instead: $0 <file> --page N --json"
    info=$(plugin_info) || { echo "$hint" >&2; exit 3; }
    IFS=$'\t' read -r key _ _ <<< "$info"
    out="$(mktemp -d "${TMPDIR:-/tmp}/hwp-view.XXXXXX")/shot.png"   # not the agent's working folder
    "$ORCA" plugin shot "$key" --editor "$file" --width 1000 --height 1400 --out "$out" --json \
      || { echo "$hint" >&2; exit 3; }
    ;;
  *) dir=$(plugin_dir); exec node "$dir/agent/agent-view.mjs" "$@" ;;
esac
