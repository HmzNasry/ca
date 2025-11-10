#!/bin/bash

# Check if tunnel service was recently started (within last 30 seconds)
TUNNEL_START=$(systemctl show chatapp-tunnel.service -p ActiveEnterTimestamp --value)
TUNNEL_START_SEC=$(date -d "$TUNNEL_START" +%s 2>/dev/null || echo 0)
NOW_SEC=$(date +%s)
TIME_SINCE_START=$((NOW_SEC - TUNNEL_START_SEC))

if [ $TIME_SINCE_START -lt 30 ]; then
    echo "[$(date)] Tunnel service started $TIME_SINCE_START seconds ago - skipping health check (too soon)"
    exit 0
fi

# Extract current cloudflare link from the chatlink HTML file
LINK=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' /data/chatapp/chatlink/index.html 2>/dev/null | head -1)

# If no link found in HTML, exit
if [ -z "$LINK" ]; then
    echo "[$(date)] ERROR: No Cloudflare link found in index.html"
    echo "[$(date)] Restarting tunnel service and updating link..."
    sudo systemctl restart chatapp-tunnel.service
    sleep 10
    /data/chatapp/update_tunnel.sh
    exit 0
fi

echo "[$(date)] Checking health of: $LINK"

# Test the link with a 10-second timeout
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$LINK")

if [ "$HTTP_CODE" -ne 200 ]; then
    echo "[$(date)] ❌ Health check FAILED - HTTP $HTTP_CODE"
    echo "[$(date)] Restarting tunnel service and updating link..."
    sudo systemctl restart chatapp-tunnel.service
    sudo systemctl start chatapp-tunnel-update.service
else
    echo "[$(date)] ✅ Health check PASSED - HTTP $HTTP_CODE"
fi
