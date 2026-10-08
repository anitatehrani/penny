#!/usr/bin/env bash
# Update the live site: take the newest code from GitHub, rebuild and restart. Run on the server in the penny folder, or from your computer
# with   .\penny deploy   The database and the backups are not touched. A backup is made first, so an update can always be undone.
set -euo pipefail
cd "$(dirname "$0")/.."

# the server user's ids, so the app can write the backups folder
export APP_UID="$(id -u)" APP_GID="$(id -g)"
mkdir -p backups

echo "==> A backup before the update"
docker compose exec -T app node scripts/backup.mjs || echo "(no backup: the site is not running yet, that is fine the first time)"

echo "==> The newest code"
git pull --ff-only

echo "==> Rebuilding and restarting"
docker compose up -d --build

echo "==> Tidying old images"
docker image prune -f >/dev/null

echo "==> Now running:"
docker compose ps
