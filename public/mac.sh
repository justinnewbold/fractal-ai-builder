# Fractal Remote on a Mac or Linux box, in one paste.
#
#   export FORGEFX_TOKEN="the-token"
#   curl -fsSL https://fractal.newbold.cloud/mac.sh | bash
#
# THE COUNTERPART OF windows.ps1, and written to match it line for line where
# it can. The two do the same job on two operating systems, and the way they
# fail — a missing token, the wrong Node, a private repository — should read
# the same on both. Where this one differs, there is a comment saying why.
#
# What it does: fetches the app and the two projects the device server is made
# of, builds them, and runs `npm run serve` — which builds the page, starts the
# server on the machine with the USB cable in it, and prints a QR code to scan
# with a phone on the same wifi. No account, no relay, nothing to sign into.
#
# The Mac app does exactly this inside a window. This is for a machine that
# would rather not install one, and for Linux, which has no app at all.
#
# Run it again any time. It updates what is already there rather than starting
# over, so it is also the update command.
#
# Settings are environment variables rather than arguments, because the way
# this is meant to be run — piped into bash — has nowhere to put arguments:
#
#   FORGEFX_TOKEN     a GitHub token that can read the three repositories
#   FRACTAL_ROOT      where the checkouts go (default: ~/src)
#   FRACTAL_NO_SERVE  set to 1 to set everything up and stop

# EVERYTHING IS INSIDE A FUNCTION and the call is the last line of the file.
# `curl | bash` feeds the shell as it downloads, so a connection that drops
# halfway leaves bash having already run the first half of a setup script.
# Wrapped this way, a truncated download never reaches the call and does
# nothing at all.
fractal_remote_setup() {
  set -euo pipefail

  local token="${FORGEFX_TOKEN:-}"
  local root="${FRACTAL_ROOT:-$HOME/src}"
  local no_serve="${FRACTAL_NO_SERVE:-}"

  local bold='' dim='' warn='' good='' off=''
  if [ -t 1 ]; then
    bold=$'\033[1m'; dim=$'\033[2m'; warn=$'\033[33m'; good=$'\033[32m'; off=$'\033[0m'
  fi
  step() { printf '\n%s· %s%s\n' "$bold" "$1" "$off"; }
  note() { printf '  %s%s%s\n' "$dim" "$1" "$off"; }
  say()  { printf '  %s\n' "$1"; }

  printf '\n  %sFractal Remote — setup%s\n\n' "$bold" "$off"

  # ------------------------------------------------------------ what's here

  local missing=()
  command -v git >/dev/null 2>&1 || missing+=('Git       https://git-scm.com/downloads')
  command -v node >/dev/null 2>&1 || missing+=('Node 20   https://nodejs.org/dist/latest-v20.x/')

  if [ "${#missing[@]}" -gt 0 ]; then
    printf '  %sTwo things have to be installed first:%s\n\n' "$warn" "$off"
    local m; for m in "${missing[@]}"; do say "  $m"; done
    printf '\n'
    say 'Install what is listed, open a new terminal, and run this again.'
    printf '\n'
    return 0
  fi

  # The server pins itself to Node 20 in its own package.json and npm refuses
  # to install against anything else. Saying so here beats an error from twenty
  # lines deep inside a dependency tree.
  #
  # The app's own package.json says Node 24, and the two do not contradict each
  # other as much as they look: 24 is what CI and Vercel build the web app with,
  # and 20 is what the device server's compiled USB and MIDI code was built
  # against. The server is the one with a binary in it, so the server wins here.
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$node_major" != "20" ]; then
    printf '  %sNode 20 is required; this machine has Node %s.%s\n\n' "$warn" "$node_major" "$off"
    say 'The device server pins itself to Node 20 because it carries USB and MIDI'
    say 'code compiled against one version, which will not load on another.'
    printf '\n'
    say '  https://nodejs.org/dist/latest-v20.x/'
    printf '\n'
    return 0
  fi

  if [ -z "$token" ]; then
    printf '  %sA GitHub token is needed.%s\n\n' "$warn" "$off"
    say 'The three repositories this pulls from are private, so there is no way'
    say 'around it. Ask Justin for a token that can read them, then run:'
    printf '\n'
    say '  export FORGEFX_TOKEN="the-token"'
    say '  curl -fsSL https://fractal.newbold.cloud/mac.sh | bash'
    printf '\n'
    return 0
  fi

  # ---------------------------------------------------------------- fetching

  # The token reaches git through a credential helper that reads it from the
  # environment, never through the URL. A token in a remote URL is written into
  # .git/config and turns up again in every error message git prints about that
  # remote; this way it exists for the length of the fetch and leaves nothing
  # behind. The same helper, character for character, as the Mac build and the
  # Windows script — Git for Windows ships the shell it is written in.
  local helper='!f() { echo username=x-access-token; echo "password=$FORGEFX_TOKEN"; }; f'

  sync_repo() {
    local repo="$1" dir="$2" commit="$3" what="$4"
    step "$what  ($repo)"

    if [ ! -d "$dir/.git" ]; then
      mkdir -p "$dir"
      git -C "$dir" init --quiet
      git -C "$dir" remote add origin "https://github.com/$repo"
    fi

    # Asked for by commit where there is one, the way the Mac build does it:
    # the only thing that can arrive is the thing that was pinned. A tag can be
    # moved by whoever owns the repository; a commit cannot.
    local ref="${commit:-HEAD}"
    if ! git -C "$dir" -c "credential.helper=$helper" fetch --quiet --depth 1 origin "$ref"; then
      # git's own message here is "could not read Username for
      # 'https://github.com'", which sends people to look at everything except
      # the token.
      printf '\n  %sCould not read %s.%s\n' "$warn" "$repo" "$off"
      say 'The token is probably missing that repository — it needs read access to all three.'
      printf '\n'
      return 1
    fi
    git -C "$dir" -c advice.detachedHead=false checkout --quiet FETCH_HEAD
    note "$(git -C "$dir" rev-parse --short HEAD)"
  }

  mkdir -p "$root"
  local app="$root/fractal-ai-builder"

  # The app first, because it carries the pins for the other two — one source
  # of truth for which versions belong together, shared with the Mac build.
  sync_repo 'justinnewbold/fractal-ai-builder' "$app" '' 'the app'

  # Read with node rather than jq, which is not on a stock Mac.
  local lock="$app/desktop/forgefx.lock.json"
  local codec_repo codec_commit server_repo server_commit
  codec_repo="$(node -p "require('$lock')['forgefx-midi'].repo")"
  codec_commit="$(node -p "require('$lock')['forgefx-midi'].commit")"
  server_repo="$(node -p "require('$lock').forgefx.repo")"
  server_commit="$(node -p "require('$lock').forgefx.commit")"

  # Siblings, not nested. The server depends on the codec by relative path
  # ("forgefx-midi": "file:../../forgefx-midi"), so flattening this layout
  # leaves that link pointing at nothing and the build fails somewhere that
  # looks unrelated.
  local server="$root/forgefx"
  local codec="$root/forgefx-midi"

  sync_repo "$codec_repo" "$codec" "$codec_commit" 'the preset codec'
  sync_repo "$server_repo" "$server" "$server_commit" 'the device server'

  # ---------------------------------------------------------------- building
  #
  # No npm.cmd dance here — that is the one thing the Windows script needs and
  # this does not. npm is a program on this side.

  # The codec before the server: the server's build reads its types.
  step 'building the preset codec'
  note 'the first run takes a few minutes'
  ( cd "$codec" && npm install --no-audit --no-fund && npm run build )

  step 'building the device server'
  ( cd "$server/server" && npm install --no-audit --no-fund && npm run build )

  step 'installing the app'
  ( cd "$app" && npm install --no-audit --no-fund )

  # ------------------------------------------------------------------ saying

  printf '\n  %sSet up.%s\n\n' "$good" "$off"
  note 'Two things to expect the first time it runs:'
  note ''
  note 'macOS will ask whether to let node accept incoming connections. Allow it,'
  note 'or a phone will never reach this machine.'
  note ''
  note 'Plug the Fractal in over USB before starting, and quit Fractal-Bot or'
  note 'Axe-Edit if either is open — they hold the port, and only one program'
  note 'can have it at a time.'
  printf '\n'

  if [ "$no_serve" = "1" ]; then
    say 'Start it any time with:'
    say "  cd \"$app\" && npm run serve"
    printf '\n'
    return 0
  fi

  step 'starting'
  note 'Ctrl-C stops it. The same command starts it next time:'
  note "cd \"$app\" && npm run serve"
  printf '\n'
  cd "$app" && npm run serve
}

fractal_remote_setup
