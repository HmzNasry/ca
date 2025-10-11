import aiohttp
import asyncio
import json
import os
import logging
from typing import AsyncGenerator, Optional, List, Dict
from .upload import UPLOAD_DIR

# endpoints
OLLAMA_API = "http://localhost:11434/api/chat"
TEXT_MODEL = "llama3:8b"

log = logging.getLogger(__name__)

# Resolve local upload dir for /files/* mapping
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

async def stream_ollama(prompt: str, image_url: Optional[str] = None, history: Optional[List[Dict]] = None) -> AsyncGenerator[str, None]:
    model = TEXT_MODEL

    system_msg = "You are a concise, helpful assistant. Keep answers under 60 words unless asked to elaborate. respond to the person that prompted you"

    messages = [{"role": "system", "content": system_msg}]

    if history:
        # Use the same chat history provided by the manager (already bounded to 100 in server)
        textual = [m for m in history if isinstance(m, dict) and (m.get("text") or "").strip()]
        for m in textual:
            text = (m.get("text") or "").strip()
            sender = (m.get("sender") or "").upper()
            role = "assistant" if sender == "AI" else "user"
            messages.append({"role": role, "content": text})

    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": {"temperature": 0.6, "num_predict": 200},
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(OLLAMA_API, json=payload, timeout=None) as resp:
            async for raw_line in resp.content:
                line = raw_line.decode("utf-8").strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if "message" in data and "content" in data["message"]:
                        yield data["message"]["content"]
                    if data.get("done"):
                        break
                except json.JSONDecodeError:
                    continue

