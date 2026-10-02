# Start/stop the project's own Postgres cluster (data in ../.pgdata, port 5433).
param([Parameter(Mandatory = $true)][ValidateSet('start', 'stop', 'status')][string]$Action)
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root '.pgdata'
$pg = if ($env:PG_BIN) { $env:PG_BIN } else { 'C:\Program Files\PostgreSQL\17\bin' }
if (-not (Test-Path $data)) { Write-Error "No cluster at $data. See README (Database section)."; exit 1 }
& "$pg\pg_ctl.exe" -D $data -l (Join-Path $data 'server.log') $Action
