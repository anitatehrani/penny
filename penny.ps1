# penny.ps1 - one file to run everything.
#
#     .\penny <command>          for example   .\penny up      .\penny down      .\penny help
#
# Everything runs in Docker (the database, the backend and the frontend), so the only things needed are Docker Desktop
# and this file. `penny.cmd` next to it just starts it without the "scripts are disabled" PowerShell problem.
#
# ADD YOUR OWN COMMANDS in the section "YOUR COMMANDS" near the bottom. One line each:
#
#     Command  <name>  '<what it does>'  { ...any PowerShell, or Compose up -d ... }
#     Alias    <short> <existing command>
#
# Inside a command you can use:  Compose <docker compose arguments>   Up   Down   Say 'text'   Ask 'question'   $Rest (what was typed after the name)

param(
  [Parameter(Position = 0)][string]$Name = 'help',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest = @()
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# ------------------------------------------------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------------------------------------------------
function Say([string]$Text, [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }
function Has([string]$Flag) { return ($Rest -contains $Flag) }
function Args-Without([string[]]$Flags) { return @($Rest | Where-Object { $Flags -notcontains $_ }) }

function Ask([string]$Question) {
  if (Has '--yes') { return $true }
  return ((Read-Host "$Question (y/n)") -match '^(y|yes)$')
}

# A setting: what is in the environment, else in the .env file next to this one, else the default.
function Setting([string]$Key, [string]$Default = '') {
  $fromEnv = [Environment]::GetEnvironmentVariable($Key)
  if ($fromEnv) { return $fromEnv }
  if (Test-Path .env) {
    $line = Get-Content .env | Where-Object { $_ -match "^\s*$Key\s*=" } | Select-Object -Last 1
    if ($line) {
      $v = ($line -replace "^\s*$Key\s*=\s*", '').Trim()
      if ($v) { return $v }
    }
  }
  return $Default
}

function Port { return [int](Setting 'PORT' '3001') }
function Url { return "http://localhost:$(Port)" }
function BackupFolder {
  $d = Setting 'BACKUP_HOST_DIR' './backups'
  if ([IO.Path]::IsPathRooted($d)) { return $d }
  return (Join-Path $PSScriptRoot $d)
}

function Compose { & docker compose @args; if ($LASTEXITCODE -ne 0) { throw "docker compose $($args -join ' ') failed (exit $LASTEXITCODE)" } }

function Need-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is not installed. Install Docker Desktop first: https://www.docker.com/products/docker-desktop' }
  cmd /c "docker info >nul 2>&1"
  if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop, wait until it says it is running, and try again.' }
}

# The first time: make the .env file. The database password is made up now, because Postgres only reads it when it first creates
# the database (unless that database already exists, then the default stays, or Penny could no longer get in).
function Ensure-Env {
  if (Test-Path .env) { return }
  Copy-Item .env.docker.example .env
  $volume = (& docker volume ls -q --filter "name=penny_penny-data") -join ''
  if (-not $volume) {
    $bytes = New-Object byte[] 18
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password = ([BitConverter]::ToString($bytes) -replace '-', '').ToLower()
    (Get-Content .env) -replace '^DB_PASSWORD=.*', "DB_PASSWORD=$password" | Set-Content .env
  }
  Say 'Made .env (change ports, mail and other settings there).' 'DarkGray'
}

# Run a docker compose command and ignore its output and result (used where "nothing to do" is fine).
function Compose-Quiet { cmd /c "docker compose $($args -join ' ') >nul 2>&1" | Out-Null }

function Running([string]$Service) {
  $names = cmd /c "docker compose --profile dev ps --status running --services 2>nul"
  return ($names -contains $Service)
}

# Port 3001 is shared by the old way of running Penny (npm start) and the app container: say who has it.
function Check-Port {
  if ((Running 'app') -or (Running 'api')) { return }
  $p = Port
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    throw "Port $p is already used by $($proc.ProcessName) (process $($c.OwningProcess)). If it is the old Penny (npm start), stop it with:  .\penny stop-local   or choose another port with PORT=... in .env."
  }
}

function Wait-Healthy([int]$Seconds = 90) {
  $health = "http://localhost:$(Port)/api/health"
  $until = (Get-Date).AddSeconds($Seconds)
  Write-Host 'Waiting for Penny to answer' -NoNewline
  while ((Get-Date) -lt $until) {
    try {
      if ((Invoke-WebRequest -Uri $health -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { Write-Host ' - ready.' -ForegroundColor Green; return }
    } catch { }
    Write-Host '.' -NoNewline
    Start-Sleep -Seconds 2
  }
  Write-Host ''
  throw "Penny did not answer within $Seconds seconds. Look at the log:  .\penny logs"
}

function Up {
  Need-Docker; Ensure-Env; Check-Port
  Compose-Quiet --profile dev stop api web
  Compose up -d --build db app
  Wait-Healthy
  Say "Penny is up:  $(Url)" 'Green'
}

function Down {
  Need-Docker
  Compose --profile dev down --remove-orphans
  Say 'Everything is stopped. Your data is kept (it lives in a Docker volume).' 'Green'
}

function Newest-Backup {
  $dir = BackupFolder
  if (-not (Test-Path $dir)) { return $null }
  return (Get-ChildItem $dir -Filter 'penny-*.dump' | Where-Object { $_.Name -notmatch 'pre-restore' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}

# ------------------------------------------------------------------------------------------------------------------------
# The command table
# ------------------------------------------------------------------------------------------------------------------------
$script:Commands = [ordered]@{}
$script:Aliases = [ordered]@{}
function Command([string]$Name, [string]$Help, [scriptblock]$Run) { $script:Commands[$Name] = @{ Help = $Help; Run = $Run } }
function Alias([string]$Short, [string]$Target) { $script:Aliases[$Short] = $Target }

# ------------------------------------------------------------------------------------------------------------------------
# THE COMMANDS
# ------------------------------------------------------------------------------------------------------------------------
Command help 'List the commands' {
  Say ''
  Say 'Usage:  .\penny <command>' 'White'
  Say ''
  foreach ($k in $script:Commands.Keys) {
    $short = ($script:Aliases.Keys | Where-Object { $script:Aliases[$_] -eq $k }) -join ', '
    $label = if ($short) { "$k ($short)" } else { $k }
    Write-Host ('  {0,-22}' -f $label) -NoNewline -ForegroundColor Cyan
    Write-Host $script:Commands[$k].Help
  }
  Say ''
}

Command install 'First time: make .env, build everything and start it' {
  Need-Docker; Ensure-Env
  Up
  Say ''
  Say 'Next: to bring your existing budget over from the old local database, run   .\penny import-local' 'Yellow'
  Say '      (or try it with demo data:   .\penny seed)' 'Yellow'
}

Command up 'Start the database, the backend and the frontend (Penny opens on the port in .env, 3001)' { Up }
Command down 'Stop and remove the containers (your data stays)' { Down }
Command stop 'Pause everything without removing the containers' { Need-Docker; Compose --profile dev stop }
Command restart 'Restart one service (default: app). Services: app, db, api, web' {
  Need-Docker
  $svc = if ($Rest.Count) { $Rest } else { @('app') }
  Compose --profile dev restart @svc
}
Command build 'Build the image again (add --no-cache to build from nothing)' { Need-Docker; Ensure-Env; Compose build @Rest app }
Command rebuild 'Build from nothing and start again' { Need-Docker; Ensure-Env; Compose build --no-cache app; Up }
Command dev 'Hot-reload development: the backend and the frontend as separate containers (frontend on port 5173)' {
  Need-Docker; Ensure-Env; Check-Port
  Compose-Quiet stop app
  Compose --profile dev up -d --build db api web
  Say ''
  Say "Frontend:  http://localhost:$(Setting 'WEB_PORT' '5173')   (use this one while developing)" 'Green'
  Say "Backend:   http://localhost:$(Port)" 'Green'
  Say 'The first start installs the packages inside the containers and takes a minute. Follow it with:  .\penny logs' 'Yellow'
}
Command status 'What is running, whether Penny answers, and the newest backups' {
  Need-Docker
  Compose --profile dev ps
  Say ''
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$(Port)/api/health" -UseBasicParsing -TimeoutSec 3
    Say "Penny answers on port $(Port) (HTTP $($r.StatusCode))." 'Green'
  } catch { Say "Penny does not answer on port $(Port)." 'Red' }
  $b = Newest-Backup
  if ($b) { Say "Newest backup: $($b.Name)  ($($b.LastWriteTime))   in $(BackupFolder)" } else { Say "No backups yet in $(BackupFolder)." 'Yellow' }
}
Command logs 'Follow the log (default: app; or name a service: db, api, web)' {
  Need-Docker
  $svc = if ($Rest.Count) { $Rest } else { @('app') }
  Compose --profile dev logs -f --tail 100 @svc
}
Command open 'Open Penny in the browser' { Start-Process (Url) }
Command shell 'A shell inside a container (default: app)' {
  Need-Docker
  $svc = if ($Rest.Count) { $Rest[0] } else { 'app' }
  Compose --profile dev exec $svc sh
}
Command psql 'Open the database prompt (psql)' { Need-Docker; Compose exec db psql -U penny penny }

Command backup 'Make a backup of the database now (it also happens by itself every day)' {
  Need-Docker
  if (-not (Running 'app')) { throw 'Penny is not running, so there is nothing to ask for a backup. Start it with  .\penny up' }
  Compose exec -T app node scripts/backup.mjs
  Say "Backups are in $(BackupFolder)" 'Green'
}

Command restore 'Put a backup back (replaces the data):  .\penny restore latest   or   .\penny restore <file>' {
  Need-Docker; Ensure-Env
  $target = (Args-Without @('--yes') | Select-Object -First 1)
  if (-not $target) { throw 'Say which backup:  .\penny restore latest   or   .\penny restore penny-2026-10-05-2151.dump' }
  if ($target -ne 'latest') {
    if (Test-Path $target) {
      $dest = Join-Path (BackupFolder) (Split-Path $target -Leaf)
      if ((Resolve-Path $target).Path -ne $dest) { New-Item -ItemType Directory -Force (BackupFolder) | Out-Null; Copy-Item $target $dest -Force }
      $target = Split-Path $target -Leaf
    }
  }
  Say "This REPLACES everything in Penny's database with backup '$target'. A safety copy of what is there now is made first." 'Yellow'
  if (-not (Ask 'Go ahead?')) { Say 'Nothing was changed.'; return }
  Compose up -d --wait db
  Compose-Quiet stop app
  Compose run --rm --no-deps app node scripts/restore.mjs $target --yes
  Up
}

Command import-local 'Move your budget from the old local database (npm start, port 5433) into Docker' {
  Need-Docker; Ensure-Env
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node is needed once for this, to read the old database (it is on this computer already).' }
  cmd /c "node server\scripts\check-db.mjs >nul 2>&1"
  if ($LASTEXITCODE -ne 0) { throw 'The old local database is not running (or does not accept the login in server/.env). Start it with  .\penny db-local start  and try again.' }
  Say 'This copies the data of the OLD local database (the one npm start used) into the Docker database and REPLACES what is in the Docker one.' 'Yellow'
  Say 'The old database is not changed or deleted. Is the old local database running? (.\penny db-local start)' 'DarkGray'
  if (-not (Ask 'Go ahead?')) { Say 'Nothing was changed.'; return }
  New-Item -ItemType Directory -Force (BackupFolder) | Out-Null
  $before = $env:BACKUP_DIR
  $env:BACKUP_DIR = BackupFolder
  try { & node server/scripts/backup.mjs; if ($LASTEXITCODE -ne 0) { throw 'Could not back up the old local database. Is it running?  .\penny db-local start' } } finally { $env:BACKUP_DIR = $before }
  $latest = Newest-Backup
  Compose up -d --wait db
  Compose-Quiet stop app
  Compose run --rm --no-deps app node scripts/restore.mjs $latest.Name --yes
  Up
  Say 'Done. Check that your budget looks right at the address above. Then you can stop the old way:  .\penny stop-local' 'Green'
}

Command seed 'Fill Penny with demo accounts and data (demo logins are in DEMO-LOGINS.md)' {
  Need-Docker
  if (-not (Running 'app')) { Up }
  Compose exec -T app node scripts/seed-demo.mjs
}

# Run a script of the app in its container (the running one, or a one-off one when Penny is stopped).
function App-Script([string]$Script, [string[]]$ScriptArgs) {
  if (Running 'app') { Compose exec -T app node "scripts/$Script" @ScriptArgs }
  else { Compose up -d --wait db; Compose run --rm --no-deps app node "scripts/$Script" @ScriptArgs }
}

Command make-admin 'Make a person an admin of the website (they need an account): .\penny make-admin you@example.com' {
  Need-Docker; Ensure-Env
  $email = (Args-Without @('--force') | Select-Object -First 1)
  if (-not $email) { throw 'Say whose e-mail address:  .\penny make-admin you@example.com   (add --force if their e-mail is not confirmed yet and the account is yours)' }
  App-Script 'make-admin.mjs' (@($email) + @($Rest | Where-Object { $_ -eq '--force' }))
}
Command remove-admin 'Take the admin role away from a person: .\penny remove-admin you@example.com' {
  Need-Docker; Ensure-Env
  $email = (Args-Without @() | Select-Object -First 1)
  if (-not $email) { throw 'Say whose e-mail address:  .\penny remove-admin you@example.com' }
  App-Script 'make-admin.mjs' @($email, '--remove')
}

# ---- the live server (README, "Putting Penny online"): put  DEPLOY_HOST=penny@your.server.address  in .env on this computer
function Deploy-Host {
  $h = Setting 'DEPLOY_HOST'
  if (-not $h) { throw 'Say where the live server is: put DEPLOY_HOST=penny@your.server.address in .env (see the README, "Putting Penny online").' }
  if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { throw 'ssh is not installed. In Windows: Settings, Apps, Optional features, add "OpenSSH Client".' }
  return $h
}

Command deploy 'Update the live site: push to GitHub first, then this makes the server take the new code, back up, rebuild and restart' {
  $h = Deploy-Host
  # through bash, so it does not depend on the file having its "run" permission (files committed from Windows do not carry it)
  & ssh $h 'cd penny && bash deploy/update.sh'
  if ($LASTEXITCODE -ne 0) { throw 'The update failed. Read the message above, or look at the log:  .\penny remote docker compose logs --tail 50 app' }
  Say 'The live site is updated.' 'Green'
}
Command remote 'Run a command on the live server, for example:  .\penny remote docker compose ps' {
  $h = Deploy-Host
  if (-not $Rest.Count) { throw 'Say what to run, for example:  .\penny remote docker compose ps' }
  & ssh $h ("cd penny && " + ($Rest -join ' '))
  if ($LASTEXITCODE -ne 0) { throw 'That command failed on the server.' }
}
Command prod-backup 'Make a backup on the live server now and download all its backups here (folder backups-live)' {
  $h = Deploy-Host
  & ssh $h 'cd penny && docker compose exec -T app node scripts/backup.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'The backup could not be made on the server.' }
  New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'backups-live') | Out-Null
  & scp -r "${h}:penny/backups/*" (Join-Path $PSScriptRoot 'backups-live')
  if ($LASTEXITCODE -ne 0) { throw 'The download failed.' }
  Say 'The live backups are in the folder backups-live. Keep a copy somewhere safe: they hold real financial data.' 'Green'
}

Command replies-setup 'Switch on replies by e-mail on the live site (README, "Replies by e-mail"): sets the two server settings and tells Brevo where to deliver. Asks for a Brevo API key and does not save it' {
  $h = Deploy-Host
  $site = ((& ssh $h "grep '^DOMAIN=' penny/.env | cut -d= -f2") | Out-String).Trim()
  if (-not $site) { throw 'The server .env has no DOMAIN, so I cannot tell which address is yours.' }
  $reply = (Args-Without @() | Select-Object -First 1)
  if (-not $reply) { $reply = "reply.$site" }
  Say "Replies will come to addresses at $reply (its MX records must point at Brevo: README, Replies by e-mail, step 1)."

  # 1. the two settings on the server: the name, and a long random secret (made once, kept if it is already there)
  & ssh $h ("cd penny && sed -i '/^REPLY_DOMAIN=/d' .env && echo 'REPLY_DOMAIN=$reply' >> .env && (grep -q '^INBOUND_SECRET=.' .env || (sed -i '/^INBOUND_SECRET=/d' .env && echo INBOUND_SECRET=`$(openssl rand -hex 24) >> .env)) && docker compose up -d")
  if ($LASTEXITCODE -ne 0) { throw 'Could not set the two settings on the server.' }
  $secret = ((& ssh $h "grep '^INBOUND_SECRET=' penny/.env | cut -d= -f2") | Out-String).Trim()
  if ($secret.Length -lt 20) { throw 'The secret on the server is missing or too short.' }

  # 2. tell Brevo (an API call; the key is asked for, used once and not saved)
  $secure = Read-Host 'Paste the Brevo API key (SMTP & API, API keys; not the SMTP key). Nothing is saved' -AsSecureString
  $key = [System.Net.NetworkCredential]::new('', $secure).Password
  if (-not $key) { throw 'No key was given.' }
  $headers = @{ 'api-key' = $key; 'accept' = 'application/json' }
  $url = "https://$site/api/inbound/mail/$secret"
  # what Brevo already has: it answers "does not exist" when there is no inbound webhook yet, which just means there is nothing to compare with
  $known = $null
  try {
    $known = Invoke-RestMethod -Method Get -Uri 'https://api.brevo.com/v3/webhooks?type=inbound' -Headers $headers
  } catch {
    if ($_.ErrorDetails.Message -notmatch 'document_not_found') { throw "Brevo refused the key: $($_.ErrorDetails.Message)" }
  }
  if ($known -and @($known.webhooks | Where-Object { $_.url -eq $url }).Count -gt 0) { Say 'Brevo already delivers to this address. Nothing more to do.' 'Green'; return }
  try {
    $body = @{ type = 'inbound'; events = @('inboundEmailProcessed'); url = $url; domain = $reply; description = 'Penny: replies to answers' } | ConvertTo-Json
    $made = Invoke-RestMethod -Method Post -Uri 'https://api.brevo.com/v3/webhooks' -Headers $headers -ContentType 'application/json' -Body $body
    Say "Done: Brevo now delivers replies sent to $reply (webhook $($made.id))." 'Green'
    Say 'Try it: send yourself a message through the contact form, answer it in Admin, Messages, then reply to that e-mail.'
  } catch {
    $detail = $_.ErrorDetails.Message
    throw "Brevo refused it: $detail   (If it says inbound parsing is not available, it is not part of this Brevo plan.)"
  }
}

Command test 'Run the server and client tests (against the Docker database)' {
  Need-Docker; Ensure-Env
  Compose up -d --wait db
  $before = $env:TEST_PG_URL
  $env:TEST_PG_URL = "postgres://penny:$(Setting 'DB_PASSWORD' 'penny')@127.0.0.1:$(Setting 'DB_PORT' '5434')"
  try { & npm test; if ($LASTEXITCODE -ne 0) { throw 'Some tests failed.' } } finally { $env:TEST_PG_URL = $before }
}

Command e2e 'Run the browser checks against the app in Docker (it needs demo data: .\penny seed)' {
  Need-Docker; Ensure-Env
  if (-not (Running 'app')) { Up }
  $beforeDb = $env:DATABASE_URL
  $beforeUrl = $env:APP_URL
  $env:DATABASE_URL = "postgres://penny:$(Setting 'DB_PASSWORD' 'penny')@127.0.0.1:$(Setting 'DB_PORT' '5434')/penny"
  $env:APP_URL = Url
  try { & npm run e2e; if ($LASTEXITCODE -ne 0) { throw 'Some browser checks failed.' } } finally { $env:DATABASE_URL = $beforeDb; $env:APP_URL = $beforeUrl }
}

Command deps 'Install the packages on this computer too (only needed to run tests or edit with the editor)' { & npm run setup }

Command stop-local 'Stop the OLD way of running Penny (npm start on this computer)' {
  $p = Port
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  $proc = if ($c) { Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue }
  if (-not $proc -or $proc.ProcessName -ne 'node') { Say "No local Penny (node) is using port $p." 'Green'; return }
  if (Ask "Stop the local Penny server (node, process $($proc.Id)) on port $p?") { Stop-Process -Id $proc.Id -Force; Say 'Stopped.' 'Green' }
}

Command db-local 'The old local database: .\penny db-local start | stop' {
  $action = if ($Rest.Count) { $Rest[0] } else { '' }
  if ($action -notin 'start', 'stop') { throw 'Say start or stop:  .\penny db-local start' }
  & npm run "db:$action"
}

Command wipe 'DELETE the Docker database and every volume (a backup is made first)' {
  Need-Docker
  if (Running 'app') { Compose exec -T app node scripts/backup.mjs } else { Say 'Penny is not running, so no backup can be made now.' 'Yellow' }
  Say 'This deletes the database in Docker for good. The backups in the backup folder stay.' 'Red'
  if ((Read-Host 'Type DELETE to go on') -ne 'DELETE') { Say 'Nothing was deleted.'; return }
  Compose --profile dev down -v --remove-orphans
}

# ------------------------------------------------------------------------------------------------------------------------
# YOUR COMMANDS  (add yours here; this is the part that is yours)
# ------------------------------------------------------------------------------------------------------------------------
Alias bfu up            # "backend + frontend up"
Alias bfd down          # "backend + frontend down"
Alias bfr restart       # "backend + frontend restart"
Alias l logs
Alias s status

# Examples (remove the # to use):
# Command fresh 'Rebuild, start and open the browser' { Up; Start-Process (Url) }
# Command bfu-dev 'Start the hot-reload version' { & $script:Commands['dev'].Run }

# ------------------------------------------------------------------------------------------------------------------------
# Run
# ------------------------------------------------------------------------------------------------------------------------
$key = if ($script:Commands.Contains($Name)) { $Name } elseif ($script:Aliases.Contains($Name)) { $script:Aliases[$Name] } else { $null }
if (-not $key) {
  Say "Unknown command '$Name'." 'Red'
  & $script:Commands['help'].Run
  exit 1
}
try {
  & $script:Commands[$key].Run
} catch {
  Write-Host "penny: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
