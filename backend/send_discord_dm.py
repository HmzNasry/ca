#!/usr/bin/env python3
"""send_discord_dm.py
Reads:
  - DISCORD_BOT_TOKEN (env)
  - TUNNEL_URL (env)
  - TARGET_USER_IDS (env, comma-separated)
Sends the tunnel URL to each listed user via DM.
"""

import os
import sys
import asyncio
import logging
from typing import List

# optional dotenv support if installed
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import discord
from discord import HTTPException, Forbidden, NotFound

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

SLEEP_BETWEEN_MSGS = float(os.environ.get("SLEEP_BETWEEN_MSGS", "1.2"))
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "3"))
RETRY_BASE_DELAY = float(os.environ.get("RETRY_BASE_DELAY", "2.0"))

def parse_targets(env_val: str) -> List[int]:
    if not env_val:
        return []
    parts = [p.strip() for p in env_val.replace(" ", "").split(",") if p.strip()]
    ids = []
    for p in parts:
        try:
            ids.append(int(p))
        except ValueError:
            logging.warning("Skipping invalid user id: %s", p)
    return ids

async def send_dm_with_retries(user: discord.User, message: str):
    delay = RETRY_BASE_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            await user.send(message)
            return True
        except Forbidden:
            logging.warning("Forbidden: cannot DM user %s. DMs closed or blocked.", user.id)
            return False
        except NotFound:
            logging.warning("User not found: %s", user.id)
            return False
        except HTTPException as e:
            logging.warning("HTTPException sending DM to %s: %s (attempt %d)", user.id, e, attempt)
            if attempt < MAX_RETRIES:
                await asyncio.sleep(delay)
                delay *= 2
                continue
            return False
        except Exception as e:
            logging.exception("Unexpected error sending DM to %s: %s", getattr(user, "id", "unknown"), e)
            return False

async def main(token: str, targets: List[int], tunnel_url: str):
    if not token:
        logging.error("DISCORD_BOT_TOKEN not set. Export it before running.")
        return 1
    if not tunnel_url:
        logging.error("TUNNEL_URL not set. Export it before running.")
        return 1
    if not targets:
        logging.error("No TARGET_USER_IDS provided (env).")
        return 1

    intents = discord.Intents.none()
    client = discord.Client(intents=intents)

    @client.event
    async def on_ready():
        logging.info("Logged in as %s. Sending DMs to %d users.", client.user, len(targets))
        msg_text = f"ChatLink is live: {tunnel_url}"
        for uid in targets:
            try:
                user = await client.fetch_user(uid)
            except Exception as e:
                logging.warning("Failed to fetch user %s: %s", uid, e)
                continue

            ok = await send_dm_with_retries(user, msg_text)
            if ok:
                logging.info("Sent DM to %s (%s)", uid, getattr(user, "name", ""))
            else:
                logging.warning("Failed to send DM to %s", uid)

            await asyncio.sleep(SLEEP_BETWEEN_MSGS)

        await client.close()
        logging.info("Done. Client closed.")

    try:
        await client.start(token)
    except KeyboardInterrupt:
        logging.info("Interrupted, closing.")
        await client.close()
    except Exception as e:
        logging.exception("Client error: %s", e)
        return 1
    return 0

if __name__ == "__main__":
    token = os.environ.get("DISCORD_BOT_TOKEN")
    tunnel_url = os.environ.get("TUNNEL_URL")
    target_env = os.environ.get("TARGET_USER_IDS", "")
    targets = parse_targets(target_env)
    res = asyncio.run(main(token, targets, tunnel_url))
    sys.exit(res)

