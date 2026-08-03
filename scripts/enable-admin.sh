#!/bin/bash
# Enable admin web portal with interactive password input
echo "=== Enable Admin Web Portal ==="
echo "Enter admin password (min 16 chars, will not be displayed):"
read -s PASSWORD
echo ""
if [ -z "$PASSWORD" ] || [ ${#PASSWORD} -lt 16 ]; then
    echo "ERROR: Password must be at least 16 characters"
    exit 1
fi

cd /opt/obsidian-e2ee-sync/deploy/commercial-sts

# Update .env
sed -i "s/^ADMIN_ENABLED=.*/ADMIN_ENABLED=true/" .env
sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${PASSWORD}/" .env

# Restart backend
docker compose up -d
sleep 3

# Verify
curl -fsS http://127.0.0.1:8788/healthz
echo ""

# Check admin page
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8788/admin)
echo "Admin page HTTP code: ${HTTP_CODE}"
echo ""
echo "=== Admin portal enabled ==="
echo "URL: https://sync.e2note.com/admin"
