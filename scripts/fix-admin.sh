#!/bin/bash
# Fix admin portal: force-recreate container to pick up .env changes
echo "=== Fix Admin Portal ==="

cd /opt/obsidian-e2ee-sync/deploy/commercial-sts

# Show current .env admin settings (mask password)
echo "--- Current .env admin settings ---"
grep '^ADMIN_ENABLED=' .env || echo "ADMIN_ENABLED not found in .env!"
grep '^ADMIN_PASSWORD=' .env | sed 's/=.*$/=***HIDDEN***/' || echo "ADMIN_PASSWORD not found in .env!"

# Force-recreate backend container to pick up new env vars
echo ""
echo "--- Force-recreating backend container ---"
docker compose up -d --force-recreate backend
sleep 5

# Health check
echo ""
echo "--- Health check ---"
curl -fsS http://127.0.0.1:8788/healthz
echo ""

# Check admin page from inside the container
echo ""
echo "--- Admin page check (localhost:8788) ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8788/admin)
echo "Admin page HTTP code: ${HTTP_CODE}"

if [ "$HTTP_CODE" = "200" ]; then
    echo ""
    echo "=== SUCCESS: Admin portal is accessible ==="
    echo "URL: https://sync.e2note.com/admin"
else
    echo ""
    echo "=== STILL FAILING (HTTP $HTTP_CODE) ==="
    echo "Checking docker logs..."
    docker compose logs backend --tail 30
fi
