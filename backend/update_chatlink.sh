#!/bin/bash
# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting ChatLink updater...${NC}"

# Change to chatlink directory
cd ../chatlink || {
  echo -e "${RED}Error: chatlink directory not found${NC}"
  exit 1
}

# Clean up any previous failed rebases or merges
if [ -f .git/REBASE_HEAD ] || [ -d .git/rebase-merge ]; then
  echo -e "${YELLOW}Cleaning up previous rebase...${NC}"
  git rebase --abort 2>/dev/null
fi

# Reset any unmerged files
git reset --hard HEAD 2>/dev/null

# Start cloudflared tunnel in background and capture output
echo -e "${YELLOW}Starting cloudflared tunnel...${NC}"
sudo -u chatapp cloudflared tunnel --url http://localhost:8080 >tunnel_output.log 2>&1 &
TUNNEL_PID=$!

# Wait a moment for tunnel to establish
sleep 5

# Extract the tunnel URL from the output
TUNNEL_URL=""
for i in {1..10}; do
  if [ -f tunnel_output.log ]; then
    TUNNEL_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' tunnel_output.log | head -1)
    if [ ! -z "$TUNNEL_URL" ]; then
      break
    fi
  fi
  echo -e "${YELLOW}Waiting for tunnel URL... (attempt $i/10)${NC}"
  sleep 2
done

if [ -z "$TUNNEL_URL" ]; then
  echo -e "${RED}Error: Could not extract tunnel URL${NC}"
  kill $TUNNEL_PID 2>/dev/null
  exit 1
fi

echo -e "${GREEN}Tunnel URL found: $TUNNEL_URL${NC}"

export TUNNEL_URL="$TUNNEL_URL"
export DISCORD_BOT_TOKEN="MTQzMTA0MzI3MjQ5MDQ4MzgwNg.GOuYau.NBoRAkd1MsosJdgwoFtxMKXZiTpXBK6wJOKIjg"
export TARGET_USER_IDS="1399272040002752594,976002531945762876, 872191822221418516"
python3 ./send_discord_dm.py

# Update the HTML file with the new URL (replace all Cloudflare URLs)
sed -i "s|https://[a-zA-Z0-9-]*\.trycloudflare\.com|$TUNNEL_URL|g" index.html

# Pull latest changes first
echo -e "${YELLOW}Pulling latest changes from remote...${NC}"
git pull origin master --strategy-option=theirs || {
  echo -e "${RED}Error: Failed to pull changes${NC}"
  kill $TUNNEL_PID 2>/dev/null
  exit 1
}

# Update the HTML file again (in case remote had changes)
sed -i "s|https://[a-zA-Z0-9-]*\.trycloudflare\.com|$TUNNEL_URL|g" index.html

# Commit and push changes
echo -e "${YELLOW}Updating GitHub repository...${NC}"
git add index.html
git commit -m "Update tunnel URL to $TUNNEL_URL" || {
  # No changes to commit (file already up to date)
  echo -e "${YELLOW}No changes to commit${NC}"
}

# Push changes
git push origin master || {
  echo -e "${RED}Error: Failed to push changes${NC}"
  kill $TUNNEL_PID 2>/dev/null
  exit 1
}

echo -e "${GREEN}✅ ChatLink updated successfully!${NC}"
echo -e "${GREEN}GitHub Pages: https://hmznasry.github.io/chatlink/${NC}"
echo -e "${GREEN}Tunnel URL: $TUNNEL_URL${NC}"
echo -e "${YELLOW}Tunnel PID: $TUNNEL_PID${NC}"

# Clean up log file
rm -f tunnel_output.log

echo -e "${YELLOW}Script completed. Tunnel is running in background with PID $TUNNEL_PID${NC}"
echo -e "${YELLOW}To stop the tunnel, run: kill $TUNNEL_PID${NC}"
