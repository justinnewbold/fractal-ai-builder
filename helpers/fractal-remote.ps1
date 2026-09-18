# Start Fractal Remote's device server, without installing the app.
#
#   irm https://raw.githubusercontent.com/justinnewbold/fractal-ai-builder/main/helpers/fractal-remote.ps1 | iex
#
# WHAT THIS IS FOR is a Windows machine whose owner would rather not install
# the app. It fetches ForgeFX, builds it, starts it, and tells you what your
# phone should see.
#
# WHAT IT RUNS, said plainly, because it is not the same thing the Mac app
# carries. The app ships a PINNED fork of ForgeFX with fixes that are not
# upstream yet. This fetches the PUBLIC upstream, because that is the one
# anybody can clone. It works; it may behave differently from the app in ways
# nobody here has measured. Set $env:FORGEFX_REPO to change that.
#
# It installs nothing machine-wide and needs no administrator. Everything lives
# in one folder and deleting that folder is the uninstall.
#
# WINDOWS WILL ASK ABOUT THE FIREWALL the first time the server opens its port.
# Say yes, or your phone cannot reach this computer over wifi — the unit will
# be found and nothing will be able to talk to it.

$ErrorActionPreference = 'Stop'

$HomeDir = if ($env:FRACTAL_HOME) { $env:FRACTAL_HOME } else { Join-Path $HOME '.fractal-remote' }
$Port = if ($env:PORT) { $env:PORT } else { '5056' }
$ForgeFxRepo = if ($env:FORGEFX_REPO) { $env:FORGEFX_REPO } else { 'https://github.com/sKuhLight/forgefx.git' }
$CodecRepo = if ($env:CODEC_REPO) { $env:CODEC_REPO } else { 'https://github.com/sKuhLight/forgefx-midi.git' }

# The account this app's phones sign in to. An anon key is public by design —
# every row it can reach is behind row-level security. Same values the Mac app
# and the browser use; see desktop/lib/project.mjs.
$SupabaseUrl = if ($env:SUPABASE_URL) { $env:SUPABASE_URL } else { 'https://biznwrqeckviawjuhvyg.supabase.co' }
$SupabaseKey = if ($env:SUPABASE_ANON_KEY) { $env:SUPABASE_ANON_KEY } else { 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpem53cnFlY2t2aWF3anVodnlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MjIyNDksImV4cCI6MjEwMzQ5ODI0OX0.WT2K6kxqy5cMc1tL-Lr3JgTwwhFYY2t-NJsOXNJXgVU' }

function Say($text) { Write-Host ''; Write-Host $text -ForegroundColor White }
function Step($text) { Write-Host "  $text" }
function Die($text) {
  Write-Host ''
  Write-Host $text -ForegroundColor Red
  Write-Host ''
  exit 1
}

# ---------------------------------------------------------------- what we need
#
# Checked before anything is downloaded. A script that clones two repositories
# and then discovers there is no Node has wasted somebody's evening and left a
# folder behind to explain.

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Die 'git is not installed. Get it from https://git-scm.com and run this again.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die 'Node is not installed. Get Node 20 from https://nodejs.org and run this again.'
}

$NodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($NodeMajor -lt 20) {
  Die "This needs Node 20 or newer. You have $(node -v)."
}

Say 'Fractal Remote - device server'
Step "Node $(node -v)"
Step "Working in $HomeDir"

New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
Set-Location $HomeDir

# ------------------------------------------------------------------ the source

function Fetch($dir, $repo) {
  if (Test-Path (Join-Path $dir '.git')) {
    Step "Updating $dir"
    git -C $dir pull --ff-only --quiet
    if ($LASTEXITCODE -ne 0) { Die "Could not update $dir. Delete $HomeDir\$dir and run this again." }
  }
  else {
    Step "Fetching $dir"
    git clone --depth 1 --quiet $repo $dir
    if ($LASTEXITCODE -ne 0) { Die "Could not fetch $repo. Check the address and your connection." }
  }
}

Say 'Getting the device server'
Fetch 'forgefx-midi' $CodecRepo
Fetch 'forgefx' $ForgeFxRepo

# ------------------------------------------------------------------- the build
#
# The codec first: ForgeFX depends on it by relative path, so building them the
# other way round fails on an import that is not there yet.

Say 'Building it (this takes a minute the first time)'

Step 'The codec'
Push-Location 'forgefx-midi'
npm install --silent
if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'The codec would not install. The output above says why.' }
npm run build --silent
if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'The codec would not build. The output above says why.' }
Pop-Location

Step 'The server'
Push-Location 'forgefx'
npm install --silent
if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'The server would not install. The output above says why.' }
npm run build --silent
if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'The server would not build. The output above says why.' }
Pop-Location

# ------------------------------------------------------------------ running it
#
# What the phone needs to see, before the server's own output buries it.

$Ip = node -e @'
const os = require("node:os")
const nets = Object.values(os.networkInterfaces()).flat()
const found = nets.find((n) => n && n.family === "IPv4" && !n.internal)
process.stdout.write(found ? found.address : "")
'@

Say 'Starting'
Step 'Plug your unit into this computer with a USB cable.'
Step 'Quit any Fractal editor if one is open - only one program can hold the USB port.'
Step 'If Windows asks about the firewall, say yes, or your phone cannot reach this computer.'
Write-Host ''
Step 'On your phone: sign in with your account and it will find this computer.'
if ($Ip) { Step "In a browser on this network: http://${Ip}:$Port" }
Step "On this computer: http://localhost:$Port"
Write-Host ''
Step 'Leave this window open. Ctrl-C stops the server.'
Write-Host ''

$env:PORT = $Port
$env:AXIS_CLOUD = '1'
$env:SUPABASE_URL = $SupabaseUrl
$env:SUPABASE_ANON_KEY = $SupabaseKey

Set-Location 'forgefx'
node server/dist/index.js
