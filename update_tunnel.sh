#!/bin/bash
# This script updates the GitHub Pages with the current cloudflare tunnel URL

echo "[$(date)] Starting tunnel URL update..."

# Wait longer for cloudflared to fully initialize and stabilize
sleep 10

# Wait for tunnel to be ready and extract URL
TUNNEL_URL=""
PREV_URL=""
STABLE_COUNT=0
for i in {1..40}; do
    # Get tunnel URL from systemd journal - look for the "INF |" format which is the final URL
    TUNNEL_URL=$(sudo journalctl -u ca-tunnel.service -n 100 --no-pager | grep 'INF |' | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' | tail -1)
    
    if [ ! -z "$TUNNEL_URL" ]; then
        # Wait to see if URL changes (cloudflared sometimes outputs multiple URLs)
        if [ "$TUNNEL_URL" == "$PREV_URL" ]; then
            STABLE_COUNT=$((STABLE_COUNT + 1))
            if [ $STABLE_COUNT -ge 3 ]; then
                echo "[$(date)] Found stable tunnel URL after $STABLE_COUNT checks: $TUNNEL_URL"
                break
            fi
        else
            STABLE_COUNT=0
        fi
        PREV_URL="$TUNNEL_URL"
        echo "[$(date)] Found tunnel URL (checking stability $STABLE_COUNT/3): $TUNNEL_URL"
    fi
    
    echo "[$(date)] Waiting for tunnel URL... (attempt $i/40)"
    sleep 2
done

if [ -z "$TUNNEL_URL" ]; then
    echo "[$(date)] ERROR: Could not find tunnel URL in logs"
    exit 1
fi

# Update the HTML file
cd /data/ca/calink || exit 1

export GIT_SSH_COMMAND="ssh -i /home/hzr/.ssh/id_rsa -o IdentitiesOnly=yes -o StrictHostKeyChecking=no"

git config --add safe.directory /data/ca/calink

# Fetch and reset to remote
git fetch origin master || exit 1
git reset --hard origin/master || exit 1

# Update HTML with new tunnel URL
sed -i "s|https://[a-zA-Z0-9-]*\.trycloudflare\.com|$TUNNEL_URL|g" index.html

# Commit and push
git add index.html
if git commit -m "Update tunnel URL to $TUNNEL_URL"; then
    git push origin master --force || exit 1
    echo "[$(date)] ✅ Successfully updated GitHub Pages with $TUNNEL_URL"
else
    echo "[$(date)] No changes needed"
fi

# Cleanup
ssh-agent -k > /dev/null 2>&1

exit 0
