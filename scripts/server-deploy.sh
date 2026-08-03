#!/bin/bash
set -e

echo "=== 1. Adding SSH deploy key ==="
mkdir -p /root/.ssh
cp /opt/obsidian-e2ee-sync/scripts/deploy_pubkey.txt /root/.ssh/authorized_keys
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys
echo "SSH key added"

echo "=== 2. Unbanning Fail2ban ==="
fail2ban-client unban all 2>/dev/null || true
echo "Fail2ban cleared"

echo "=== 3. Git pull ==="
cd /opt/obsidian-e2ee-sync
git pull --ff-only origin master
echo "Code updated"

echo "=== 4. Compose config check ==="
cd /opt/obsidian-e2ee-sync/deploy/commercial-sts
docker compose --env-file .env config --quiet
echo "Compose config OK"

echo "=== 5. Docker build ==="
docker compose build --pull backend
echo "Build complete"

echo "=== 6. Docker up ==="
docker compose up -d
echo "Containers started"

echo "=== 7. Health checks ==="
sleep 3
curl -fsS http://127.0.0.1:8788/healthz
echo ""
curl -fsS http://127.0.0.1:8788/readyz
echo ""

echo "=== DEPLOY DONE ==="
