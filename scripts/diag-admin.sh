#!/bin/bash
# Diagnose admin portal issue
echo "=== Admin Portal Diagnostics ==="
cd /opt/obsidian-e2ee-sync/deploy/commercial-sts

echo ""
echo "--- 1. Raw .env file (password masked) ---"
cat .env | sed 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=***HIDDEN***/'
echo ""

echo "--- 2. Docker compose config (env vars passed to container) ---"
docker compose config 2>/dev/null | grep -A 2 -E 'ADMIN_|env_file' || echo "No ADMIN vars found in compose config"
echo ""

echo "--- 3. Env vars inside running container ---"
docker compose exec backend env | grep -E 'ADMIN|NODE_ENV|HOST|PORT|STORE|PROVIDER|OSS|STS|TOKEN|DEVICE|SEED|RATE' | sort
echo ""

echo "--- 4. Admin endpoint test ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8788/admin)
echo "Admin HTTP code: ${HTTP_CODE}"
echo ""

echo "--- 5. Server logs (last 15 lines) ---"
docker compose logs backend --tail 15
