import asyncio
import websockets
import json
import httpx
import sys
import logging

# Basic configuration
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
API_URL = "http://localhost:8000"
WS_URL = "ws://localhost:8000/ws"

# Signs up a user via HTTP POST request.
async def signup(client, username, password):
    logging.info(f"Attempting to sign up user '{username}'...")
    try:
        response = await client.post(f"{API_URL}/signup", json={"username": username, "password": password})
        if response.status_code == 201:
            logging.info(f"User '{username}' created successfully.")
            return True
        elif response.status_code == 400:
            logging.warning(f"User '{username}' already exists. Proceeding to login.")
            return True
        else:
            logging.error(f"Signup failed for '{username}': {response.text}")
            return False
    except httpx.ConnectError:
        logging.error("Connection to the server failed. Is it running?")
        return False

# Logs in a user to get a JWT token.
async def login(client, username, password):
    logging.info(f"Attempting to log in as '{username}'...")
    response = await client.post(f"{API_URL}/token", data={"username": username, "password": password})
    if response.status_code == 200:
        token = response.json()["access_token"]
        logging.info(f"Successfully logged in and received token for '{username}'.")
        return token
    else:
        logging.error(f"Login failed for '{username}': {response.text}")
        return None

# The main WebSocket client logic.
async def chat_client(token: str):
    uri = f"{WS_URL}/{token}"
    try:
        async with websockets.connect(uri) as ws:
            logging.info("WebSocket connection established.")
            
            # Listen for messages
            async for message in ws:
                logging.info(f"<-- Received: {message}")

    except websockets.exceptions.ConnectionClosed as e:
        logging.error(f"WebSocket connection closed: {e.code} {e.reason}")
    except Exception as e:
        logging.error(f"An unexpected error occurred: {e}")

# Main execution block.
async def main():
    if len(sys.argv) != 3:
        print("Usage: python test_client.py <username> <password>")
        sys.exit(1)
        
    username, password = sys.argv[1], sys.argv[2]

    async with httpx.AsyncClient() as client:
        # Ensure user exists, then log in
        if await signup(client, username, password):
            token = await login(client, username, password)
            if token:
                # Start the chat client
                await chat_client(token)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Client shutting down.")
