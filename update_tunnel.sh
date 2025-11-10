#!/bin/bash
# This script updates the GitHub Pages with the current cloudflare tunnel URL

echo "[$(date)] Starting tunnel URL update..."

# Wait for tunnel to be ready and extract URL
TUNNEL_URL=""
for i in {1..30}; do
    # Get tunnel URL from systemd journal
    TUNNEL_URL=$(sudo journalctl -u chatapp-tunnel.service -n 50 --no-pager | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' | tail -1)
    
    if [ ! -z "$TUNNEL_URL" ]; then
        echo "[$(date)] Found tunnel URL: $TUNNEL_URL"
        break
    fi
    
    echo "[$(date)] Waiting for tunnel URL... (attempt $i/30)"
    sleep 2
done

if [ -z "$TUNNEL_URL" ]; then
    echo "[$(date)] ERROR: Could not find tunnel URL in logs"
    exit 1
fi

# Update the HTML file
cd /data/chatapp/chatlink || exit 1

export GIT_SSH_COMMAND="ssh -i /home/hzr/.ssh/id_rsa -o IdentitiesOnly=yes -o StrictHostKeyChecking=no"
eval $(ssh-agent -s) > /dev/null 2>&1
ssh-add /home/hzr/.ssh/id_rsa > /dev/null 2>&1
git config --add safe.directory /data/chatapp/chatlink

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
