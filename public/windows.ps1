# Fractal Remote on Windows, in one paste.
#
#   $env:FORGEFX_TOKEN = "the-token"
#   irm https://fractal.newbold.cloud/windows.ps1 | iex
#
# There is no Windows app and this is why there does not need to be one. What
# the Mac app actually does is start a small server on the machine with the USB
# cable and put a window around a web page; the server has always run anywhere
# Node runs. What was missing was somebody doing the setup, so this does the
# setup.
#
# It ends by running `npm run serve`, which is the same command a Mac uses from
# a terminal — it builds the page, starts the server, and prints a QR code to
# scan with a phone on the same wifi. No account, no relay, nothing to sign
# into.
#
# Run it again any time. It updates what is already there rather than starting
# over, so it is also the update command.
#
# Settings are environment variables rather than parameters, because the way
# this is meant to be run — piped into `iex` — has no way to pass parameters:
#
#   FORGEFX_TOKEN   a GitHub token that can read the three repositories
#   FRACTAL_ROOT    where the checkouts go (default: %USERPROFILE%\src)
#   FRACTAL_NO_SERVE  set to 1 to set everything up and stop

# Everything lives in a function and returns rather than exits. `exit` inside a
# piped-in script closes the whole PowerShell window, so every one of the
# "you're missing X" messages below would have taken the terminal — and the
# message — with it.
function Install-FractalRemote {

  $ErrorActionPreference = 'Stop'

  $Token = $env:FORGEFX_TOKEN
  $Root = if ($env:FRACTAL_ROOT) { $env:FRACTAL_ROOT } else { Join-Path $HOME 'src' }
  $NoServe = $env:FRACTAL_NO_SERVE -eq '1'

  function Write-Step { param([string] $Text) Write-Host "`n· $Text" -ForegroundColor Cyan }
  function Write-Note { param([string] $Text) Write-Host "  $Text" -ForegroundColor DarkGray }

  # PowerShell's error handling does not extend to the programs it runs: git and
  # npm report failure through an exit code that $ErrorActionPreference never
  # sees, so a failed clone would otherwise sail on into a build of nothing.
  function Invoke-Checked {
    param([string] $Exe, [string[]] $Arguments, [string] $Cwd, [string] $What)
    Push-Location $Cwd
    try {
      & $Exe @Arguments
      if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)." }
    } finally {
      Pop-Location
    }
  }

  function Test-Command {
    param([string] $Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
  }

  Write-Host ''
  Write-Host '  Fractal Remote — Windows setup' -ForegroundColor White
  Write-Host ''

  # -------------------------------------------------------------- what's here

  if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Host '  This needs PowerShell 5 or newer.' -ForegroundColor Yellow
    Write-Host '  Windows 10 and 11 both ship with it; open "Windows PowerShell" rather'
    Write-Host '  than the old blue "Command Prompt".'
    Write-Host ''
    return
  }

  $missing = @()
  if (-not (Test-Command 'git')) { $missing += 'Git       https://git-scm.com/download/win' }
  if (-not (Test-Command 'node')) { $missing += 'Node 20   https://nodejs.org/dist/latest-v20.x/' }

  if ($missing.Count -gt 0) {
    Write-Host '  Two things have to be installed first:' -ForegroundColor Yellow
    Write-Host ''
    foreach ($m in $missing) { Write-Host "    $m" }
    Write-Host ''
    Write-Host '  Install what is listed, open a NEW PowerShell window, and run this again.'
    Write-Host '  (A new window matters — the old one cannot see a program installed after'
    Write-Host '  it opened.)'
    Write-Host ''
    return
  }

  # The server pins itself to Node 20 in its own package.json and npm refuses to
  # install against anything else. Saying so here beats an error from twenty
  # lines deep inside a dependency tree.
  $nodeMajor = [int]((node --version) -replace '^v(\d+)\..*$', '$1')
  if ($nodeMajor -ne 20) {
    Write-Host "  Node 20 is required; this machine has Node $nodeMajor." -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  The device server pins itself to Node 20 because it carries USB and MIDI'
    Write-Host '  code compiled against one version, which will not load on another.'
    Write-Host ''
    Write-Host '    https://nodejs.org/dist/latest-v20.x/'
    Write-Host ''
    return
  }

  if (-not $Token) {
    Write-Host '  A GitHub token is needed.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  The three repositories this pulls from are private, so there is no way'
    Write-Host '  around it. Ask Justin for a token that can read them, then run:'
    Write-Host ''
    Write-Host '    $env:FORGEFX_TOKEN = "the-token"' -ForegroundColor White
    Write-Host '    irm https://fractal.newbold.cloud/windows.ps1 | iex' -ForegroundColor White
    Write-Host ''
    return
  }

  # ----------------------------------------------------------------- fetching

  # The token reaches git through a credential helper that reads it from the
  # environment, never through the URL. A token in a remote URL is written into
  # .git/config and turns up again in every error message git prints about that
  # remote; this way it exists for the length of the fetch and leaves nothing
  # behind. Git for Windows ships the shell this helper is written in, so the
  # same helper works here as on a Mac.
  $helper = '!f() { echo username=x-access-token; echo "password=$FORGEFX_TOKEN"; }; f'
  $auth = @('-c', "credential.helper=$helper")

  function Sync-Repo {
    param(
      [string] $Repo,    # owner/name on GitHub
      [string] $Dir,     # where it goes
      [string] $Commit,  # exact commit, or empty for the default branch
      [string] $What
    )
    Write-Step "$What  ($Repo)"

    if (-not (Test-Path (Join-Path $Dir '.git'))) {
      New-Item -ItemType Directory -Force -Path $Dir | Out-Null
      Invoke-Checked 'git' @('init', '--quiet') $Dir 'git init'
      Invoke-Checked 'git' @('remote', 'add', 'origin', "https://github.com/$Repo") $Dir 'adding the remote'
    }

    # Asked for by commit where there is one, the way the Mac build does it: the
    # only thing that can arrive is the thing that was pinned. A tag can be
    # moved by whoever owns the repository; a commit cannot.
    $ref = if ($Commit) { $Commit } else { 'HEAD' }
    try {
      Invoke-Checked 'git' ($auth + @('fetch', '--quiet', '--depth', '1', 'origin', $ref)) $Dir 'fetching'
    } catch {
      # git's own message here is "could not read Username for
      # 'https://github.com'", which sends people to look at everything except
      # the token.
      throw "Could not read $Repo. The token is probably missing that repository — it needs read access to all three."
    }
    Invoke-Checked 'git' @('-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD') $Dir 'checking out'
    Write-Note (& git -C $Dir rev-parse --short HEAD)
  }

  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  $app = Join-Path $Root 'fractal-ai-builder'

  # The app first, because it carries the pins for the other two — one source of
  # truth for which versions belong together, shared with the Mac build.
  Sync-Repo -Repo 'justinnewbold/fractal-ai-builder' -Dir $app -Commit '' -What 'the app'

  $lock = Get-Content (Join-Path $app 'desktop\forgefx.lock.json') -Raw | ConvertFrom-Json

  # Siblings, not nested. The server depends on the codec by relative path
  # ("forgefx-midi": "file:../../forgefx-midi"), so flattening this layout
  # leaves that link pointing at nothing and the build fails somewhere that
  # looks unrelated.
  $server = Join-Path $Root 'forgefx'
  $codec = Join-Path $Root 'forgefx-midi'

  Sync-Repo -Repo $lock.'forgefx-midi'.repo -Dir $codec -Commit $lock.'forgefx-midi'.commit -What 'the preset codec'
  Sync-Repo -Repo $lock.forgefx.repo -Dir $server -Commit $lock.forgefx.commit -What 'the device server'

  # ----------------------------------------------------------------- building

  # npm on Windows is npm.cmd, a batch file. PowerShell runs one happily; Node
  # refuses to. That refusal is a real bug in the serve script and is fixed
  # there — worth knowing the two are separate problems if this ever needs
  # debugging.
  function Invoke-Npm {
    param([string[]] $Arguments, [string] $Cwd, [string] $What)
    Invoke-Checked 'npm.cmd' $Arguments $Cwd $What
  }

  # The codec before the server: the server's build reads its types.
  Write-Step 'building the preset codec'
  Write-Note 'the first run takes a few minutes'
  Invoke-Npm @('install', '--no-audit', '--no-fund') $codec 'installing the codec'
  Invoke-Npm @('run', 'build') $codec 'building the codec'

  Write-Step 'building the device server'
  Invoke-Npm @('install', '--no-audit', '--no-fund') (Join-Path $server 'server') 'installing the server'
  Invoke-Npm @('run', 'build') (Join-Path $server 'server') 'building the server'

  Write-Step 'installing the app'
  Invoke-Npm @('install', '--no-audit', '--no-fund') $app 'installing the app'

  # ------------------------------------------------------------------- saying

  Write-Host ''
  Write-Host '  Set up.' -ForegroundColor Green
  Write-Host ''
  Write-Note 'Two things to expect the first time it runs:'
  Write-Note ''
  Write-Note 'Windows will ask whether to let Node through the firewall. Allow it on'
  Write-Note 'private networks, or a phone will never reach this PC.'
  Write-Note ''
  Write-Note 'Plug the Fractal in over USB before starting, and quit Fractal-Bot or'
  Write-Note 'Axe-Edit if either is open — they hold the port, and only one program'
  Write-Note 'can have it at a time.'
  Write-Host ''

  if ($NoServe) {
    Write-Host '  Start it any time with:' -ForegroundColor White
    Write-Host "    cd `"$app`"; npm run serve" -ForegroundColor White
    Write-Host ''
    return
  }

  Write-Step 'starting'
  Write-Note 'Ctrl-C stops it. The same command starts it next time:'
  Write-Note "cd `"$app`"; npm run serve"
  Write-Host ''
  Invoke-Npm @('run', 'serve') $app 'serving'
}

Install-FractalRemote
