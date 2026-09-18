#!/usr/bin/env bash
#
# Start Fractal Remote's device server, without installing the app.
#
#   curl -fsSL https://raw.githubusercontent.com/justinnewbold/fractal-ai-builder/main/helpers/fractal-remote.sh | bash
#
# WHAT THIS IS FOR is a computer that cannot run the Mac app — a PC, a Linux
# box, or a Mac where somebody would rather not install anything. It fetches
# ForgeFX, builds it, starts it, and tells you what your phone should see.
#
# WHAT IT RUNS, said plainly, because it is not the same thing the Mac app
# carries. The app ships a PINNED fork of ForgeFX with fixes that are not
# upstream yet. This fetches the PUBLIC upstream, because that is the one
# anybody can clone. It works; it may behave differently from the app in ways
# nobody here has measured. Point FORGEFX_REPO somewhere else to change that.
#
# It installs nothing system-wide. Everything lives in one directory and
# deleting that directory is the uninstall.
set -euo pipefail

HOME_DIR="${FRACTAL_HOME:-$HOME/.fractal-remote}"
PORT="${PORT:-5056}"
FORGEFX_REPO="${FORGEFX_REPO:-https://github.com/sKuhLight/forgefx.git}"
CODEC_REPO="${CODEC_REPO:-https://github.com/sKuhLight/forgefx-midi.git}"

# The account this app's phones sign in to. An anon key is public by design —
# every row it can reach is behind row-level security. Same values the Mac app
# and the browser use; see desktop/lib/project.mjs.
SUPABASE_URL="${SUPABASE_URL:-https://biznwrqeckviawjuhvyg.supabase.co}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpem53cnFlY2t2aWF3anVodnlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MjIyNDksImV4cCI6MjEwMzQ5ODI0OX0.WT2K6kxqy5cMc1tL-Lr3JgTwwhFYY2t-NJsOXNJXgVU}"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
step() { printf '  %s\n' "$1"; }
die() { printf '\n\033[1;31m%s\033[0m\n\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- what we need
#
# Checked before anything is downloaded. A script that clones two repositories
# and then discovers there is no compiler has wasted somebody's evening and
# left a directory behind to explain.

command -v git >/dev/null 2>&1 || die "git is not installed. Install it and run this again."
command -v node >/dev/null 2>&1 || die "Node is not installed. Get Node 20 from https://nodejs.org and run this again."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "This needs Node 20 or newer. You have $(node -v)."
fi

say "Fractal Remote — device server"
step "Node $(node -v), git $(git --version | awk '{print $3}')"
step "Working in $HOME_DIR"

mkdir -p "$HOME_DIR"
cd "$HOME_DIR"

# ------------------------------------------------------------------ the source
#
# Clone once, pull after. `git -C` rather than cd, so a failure cannot leave
# the shell somewhere unexpected.

fetch() {
  local dir="$1" repo="$2"
  if [ -d "$dir/.git" ]; then
    step "Updating $dir"
    git -C "$dir" pull --ff-only --quiet || die "Could not update $dir. Delete $HOME_DIR/$dir and run this again."
  else
    step "Fetching $dir"
    git clone --depth 1 --quiet "$repo" "$dir" || die "Could not fetch $repo. Check the address and your connection."
  fi
}

say "Getting the device server"
fetch forgefx-midi "$CODEC_REPO"
fetch forgefx "$FORGEFX_REPO"

# ------------------------------------------------------------------- the build
#
# The codec first: ForgeFX depends on it by relative path, so building them the
# other way round fails on an import that is not there yet.

say "Building it (this takes a minute the first time)"
step "The codec"
(cd forgefx-midi && npm install --silent && npm run build --silent) || die "The codec would not build. The output above says why."
step "The server"
(cd forgefx && npm install --silent && npm run build --silent) || die "The server would not build. The output above says why."

# ------------------------------------------------------------------- running it
#
# What the phone needs to see, before the server's own output buries it.

IP="$(node -e '
const os = require("node:os")
const nets = Object.values(os.networkInterfaces()).flat()
const found = nets.find((n) => n && n.family === "IPv4" && !n.internal)
process.stdout.write(found ? found.address : "")
' || true)"

say "Starting"
step "Plug your unit into this computer with a USB cable."
step "Quit FM3-Edit or Axe-Edit if either is open — only one program can hold the USB port."
printf '\n'
step "On your phone: sign in with your account and it will find this computer."
if [ -n "$IP" ]; then
  step "In a browser on this network: http://$IP:$PORT"
fi
step "On this computer: http://localhost:$PORT"
printf '\n'
step "Leave this window open. Ctrl-C stops the server."
printf '\n'

cd forgefx
PORT="$PORT" \
AXIS_CLOUD=1 \
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  exec node server/dist/index.js
