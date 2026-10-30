#!/usr/bin/env bash
set -euo pipefail

# Configuration
APP_DIR="/var/www/tkrp"
BRANCH="main"
REMOTE_URL="https://github.com/StrAnnIk60RUS/TKRP.git"
SERVICE_NAME="tkrp-api"
HEALTH_URL_API="http://127.0.0.1:3001/api/health"
HEALTH_URL_ROOT="http://127.0.0.1:3001/health"
HEALTH_URL_WEB="http://127.0.0.1/"
MAX_HEALTH_ATTEMPTS=15
HEALTH_SLEEP=2

echo "=== [TKRP Deploy] Starting deployment at $(date -u '+%Y-%m-%d %H:%M:%SZ') ==="

cd "$APP_DIR"

# 1. Ensure git repository is initialized and points to remote
if [ ! -d ".git" ]; then
    echo "[TKRP Deploy] Initializing git repository..."
    git init
    git remote add origin "$REMOTE_URL" || true
fi

# 2. Backup sensitive configuration
if [ -f ".env" ]; then
    echo "[TKRP Deploy] Backing up .env..."
    cp -n .env .env.backup-$(date +%Y%m%d%H%M%S) 2>/dev/null || true
fi

# 3. Fetch latest changes from remote main
echo "[TKRP Deploy] Fetching from origin/$BRANCH..."
git fetch origin "$BRANCH"

# 4. Safe hard reset to origin/main (tracked files only; untracked and .gitignore files preserved)
echo "[TKRP Deploy] Resetting working tree to origin/$BRANCH..."
git checkout -B "$BRANCH" -f "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

# Remove legacy untracked single-user session files if still lingering on disk
rm -rf apps/web/src/pages/in-process \
       apps/web/src/app/SessionGate.jsx \
       apps/web/src/app/providers/SingleUserSessionContext.jsx \
       apps/web/src/shared/api/sessionService.js \
       apps/api/src/modules/session \
       apps/api/tests/singleUserSession.test.js \
       tools/cloudflared

COMMIT_HASH=$(git rev-parse --short HEAD)
echo "[TKRP Deploy] Deployed commit: $COMMIT_HASH"

# 5. Install root and API npm dependencies
echo "[TKRP Deploy] Installing npm dependencies..."
# Running npm ci in root triggers postinstall (which installs apps/api dependencies)
npm ci --prefer-offline --no-audit

# 6. Apply database migrations if any new ones exist
if [ -f "apps/api/scripts/apply-migrations.js" ]; then
    echo "[TKRP Deploy] Applying database migrations..."
    node apps/api/scripts/apply-migrations.js || echo "[TKRP Deploy] Warning: Migration script completed with non-zero status or skipped."
fi

# 7. Install Python dependencies
if [ -f "requirements.txt" ]; then
    echo "[TKRP Deploy] Checking/installing Python dependencies..."
    pip3 install -r requirements.txt --quiet
fi

# 8. Build frontend assets
echo "[TKRP Deploy] Building frontend with Vite..."
npm run build

# 9. Restart backend systemd service
echo "[TKRP Deploy] Restarting $SERVICE_NAME..."
systemctl restart "$SERVICE_NAME"

# 10. Healthcheck verification
echo "[TKRP Deploy] Verifying service health..."
HEALTHY=false

for i in $(seq 1 $MAX_HEALTH_ATTEMPTS); do
    echo "  Attempt $i/$MAX_HEALTH_ATTEMPTS: Checking API health..."
    if curl -fsS "$HEALTH_URL_API" > /dev/null 2>&1 || curl -fsS "$HEALTH_URL_ROOT" > /dev/null 2>&1; then
        echo "  API health check passed!"
        HEALTHY=true
        break
    fi
    sleep "$HEALTH_SLEEP"
done

if [ "$HEALTHY" = false ]; then
    echo "[TKRP Deploy] ERROR: API failed health check after restart!"
    echo "=== Service Status ==="
    systemctl status "$SERVICE_NAME" --no-pager || true
    echo "=== Recent Service Logs ==="
    journalctl -u "$SERVICE_NAME" -n 50 --no-pager || true
    exit 1
fi

# Verify frontend web server responds
if curl -fsS "$HEALTH_URL_WEB" > /dev/null 2>&1; then
    echo "  Web frontend check passed!"
fi

echo "=== [TKRP Deploy] Deployment successfully completed for commit $COMMIT_HASH at $(date -u '+%Y-%m-%d %H:%M:%SZ') ==="
