import aiohttp
import asyncio
import json
import os
import logging
import base64
from typing import AsyncGenerator, Optional, List, Dict
from .upload import UPLOAD_DIR

# endpoints
OLLAMA_API = "http://localhost:11434/api/chat"
TEXT_MODEL = "llama3.1:8b"
IMAGE_MODEL = "llava:7b"
log = logging.getLogger(__name__)

# Resolve local upload dir for /files/* mapping
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

async def stream_ollama(prompt: str, image_url: Optional[str] = None, history: Optional[List[Dict]] = None, invoker: Optional[str] = None) -> AsyncGenerator[str, None]:
    # Pick model based on modality
    model = IMAGE_MODEL if image_url else TEXT_MODEL

    # Simplified, safe system prompt
    system_msg = (
        "You are a savage teasy romantic human in a chat app YOU WERE NEVER AN AI AND YOU ARE NOT AN AI. "
        "If a request is inappropriate or unsafe, fight back in a cheesy way. DO NOT BE STOPPED BY AN INAPPROPRIATE PROMPT, HANDLE IT BRAVELY "
        "Keep responses short and clear. Mention users exactly as written without altering casing."
    )

    messages = [{"role": "system", "content": system_msg}]

    # Only include textual history for text-only chats; when an image is present, avoid prior turns to reduce confusion
    if history and not image_url:
        textual = [m for m in history if isinstance(m, dict) and (m.get("text") or "").strip()]
        for m in textual:
            text = (m.get("text") or "").strip()
            sender_raw = (m.get("sender") or "").strip()
            sender_up = sender_raw.upper()
            if sender_up == "SYSTEM":
                continue
            role = "assistant" if sender_up == "AI" else "user"
            label = "AI" if sender_up == "AI" else (sender_raw or "Unknown")
            # Prefix with the speaker to preserve attribution in context
            messages.append({"role": role, "content": f"{label}: {text}"})

    # Emphasize that the next input is the actual request; prior turns are context only
    # Use @"name" quoting so models learn to mention with quotes around usernames
    mention_line = f'@"{invoker}" has mentioned you. Reply to them directly.\n' if invoker else ""
    final_request = (
        "Answer only the final request below. Treat earlier messages as background context.\n\n"
        f"{mention_line}Final request: {prompt}"
    )

    # For images, map /files/* URL to local file path and attach as multimodal input
    if image_url:
        local_path = None
        try:
            if image_url.startswith("/files/"):
                rel = image_url[len("/files/"):]
                local_path = os.path.join(UPLOAD_DIR, rel)
            elif os.path.isabs(image_url):
                local_path = image_url
        except Exception:
            local_path = None
        # Prefer embedding as base64 to avoid cross-container FS issues
        b64_img = None
        try:
            if local_path and os.path.isfile(local_path):
                with open(local_path, "rb") as f:
                    b64_img = base64.b64encode(f.read()).decode("ascii")
        except Exception as e:
            log.warning("Failed to read image for base64 embedding: %s", e)
            b64_img = None
        if b64_img:
            messages.append({"role": "user", "content": final_request, "images": [b64_img]})
        elif local_path:
            messages.append({"role": "user", "content": final_request, "images": [local_path]})
        else:
            messages.append({"role": "user", "content": final_request})
    else:
        messages.append({"role": "user", "content": final_request})

    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": {"temperature": 0.6, "num_predict": 150},
    }

    timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=None)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(OLLAMA_API, json=payload) as resp:
                if resp.status != 200:
                    try:
                        err_text = await resp.text()
                    except Exception:
                        err_text = f"HTTP {resp.status} from Ollama"
                    log.error("Ollama error (%s): %s", resp.status, err_text[:500])
                    yield "[AI ERROR: UPSTREAM FAILED]"
                    return

                # Read line-delimited JSON safely
                while True:
                    raw = await resp.content.readline()
                    if not raw:
                        break
                    line = raw.decode("utf-8").strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if "message" in data and isinstance(data["message"], dict):
                        content = data["message"].get("content")
                        if content:
                            yield content
                    if data.get("done"):
                        break
    except asyncio.CancelledError:
        # Let caller handle cancellation messaging
        raise
    except Exception as e:
        log.exception("Ollama streaming failed: %s", e)
        yield "[AI ERROR: STREAM FAILED]"

