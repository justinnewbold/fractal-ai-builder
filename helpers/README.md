# The one-line helpers

Two files that get ForgeFX — the bit that actually talks to the unit — running
on a computer, without installing either desktop app.

| Computer | Paste this into |  |
|---|---|---|
| Mac or Linux | Terminal | `curl -fsSL https://raw.githubusercontent.com/justinnewbold/fractal-ai-builder/main/helpers/fractal-remote.sh \| bash` |
| Windows | PowerShell | `irm https://raw.githubusercontent.com/justinnewbold/fractal-ai-builder/main/helpers/fractal-remote.ps1 \| iex` |

Each one checks for git and Node 20+, fetches ForgeFX and the codec it depends
on, builds both, prints the address a phone should see, and starts the server.
Everything lives in `~/.fractal-remote`; deleting that folder is the uninstall.
Neither needs an administrator and neither installs anything system-wide.

## What they run is not quite what the apps run

The desktop apps vendor a **pinned private fork** of ForgeFX with fixes that
are not upstream yet. These scripts clone the **public upstream**, because that
is the one anybody can clone without a token. It works — it is the same
project — but the two are not byte for byte the same, and a bug that only
appears on the terminal route may simply be a fix the fork already carries.

Both scripts say this at the top, and both take an override:

```sh
FORGEFX_REPO=https://github.com/you/your-fork.git bash fractal-remote.sh
```

Making them match would mean publishing the fork, or attaching a release
tarball somewhere the scripts can fetch without credentials.

## Other knobs

`PORT` (default 5056), `FRACTAL_HOME` (default `~/.fractal-remote`),
`CODEC_REPO`, and `SUPABASE_URL` / `SUPABASE_ANON_KEY` if this ever points at
a different project. The Supabase values baked in are the same public anon
credentials the browser and the desktop apps carry — an anon key is public by
design and every row behind it is under row-level security.
