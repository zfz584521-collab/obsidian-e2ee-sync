#!/bin/bash
# Setup admin portal - properly adds ADMIN_ENABLED and ADMIN_PASSWORD to .env
echo "=== Setup Admin Portal ==="
echo "Enter admin password (min 16 chars, will not be displayed):"
read -s PASSWORD
echo ""
if [ -z "$PASSWORD" ] || [ ${#PASSWORD} -lt 16 ]; then
    echo "ERROR: Password must be at least 16 characters"
    exit 1
fi

cd /opt/obsidian-e2ee-sync/deploy/commercial-sts

echo ""
echo "--- Current .env contents (password hidden) ---"
cat .env | sed 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=***HIDDEN***/'
echo ""

# Remove any existing ADMIN lines (could be empty or have wrong value)
sed -i '/^ADMIN_ENABLED=/d' .env
sed -i '/^ADMIN_PASSWORD=/d' .env
sed -i '/^ADMIN_SESSION_TTL_MINUTES=/d' .env

# Append correct values
echo "" >> .env
echo "# Admin portal" >> .env
echo "ADMIN_ENABLED=true" >> .env
echo "ADMIN_PASSWORD=${PASSWORD}" >> .env
echo "ADMIN_SESSION_TTL_MINUTES=480" >> .env

echo "--- Updated .env admin settings ---"
grep '^ADMIN_ENABLED=' .env
grep '^ADMIN_PASSWORD=' .env | sed 's/=.*$/=***HIDDEN***/'
grep '^ADMIN_SESSION_TTL_MINUTES=' .env

# Force-recreate backend container
echo ""
echo "--- Force-recreating backend container ---"
docker compose up -d --force-recreate backend
sleep 5

# Health check
echo ""
echo "--- Health check ---"
curl -fsS http://127.0.0.1:8788/healthz
echo ""

# Check admin page from inside
echo ""
echo "--- Admin page check ---"
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
