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

# Start cloudflared tunnel in background and capture output
echo -e "${YELLOW}Starting cloudflared tunnel...${NC}"
sudo -u chatapp cloudflared tunnel --url http://localhost:8000 >tunnel_output.log 2>&1 &
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

# Update the HTML file with the new URL
sed -i "s|window.location.href = \"[^\"]*\";|window.location.href = \"$TUNNEL_URL\";|g" index.html

# Commit and push changes
echo -e "${YELLOW}Updating GitHub repository...${NC}"
git add index.html
git commit -m "Update tunnel URL to $TUNNEL_URL"
git push

echo -e "${GREEN}✅ ChatLink updated successfully!${NC}"
echo -e "${GREEN}GitHub Pages: https://hmznasry.github.io/chatlink/${NC}"
echo -e "${GREEN}Tunnel URL: $TUNNEL_URL${NC}"
echo -e "${YELLOW}Tunnel PID: $TUNNEL_PID${NC}"

# Clean up log file
rm -f tunnel_output.log

echo -e "${YELLOW}Script completed. Tunnel is running in background with PID $TUNNEL_PID${NC}"
echo -e "${YELLOW}To stop the tunnel, run: kill $TUNNEL_PID${NC}"

