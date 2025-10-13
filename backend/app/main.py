from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .auth import login_user, Login, Token
from .upload import router as upload_router, UPLOAD_DIR
from .websocket_handlers import ws_handler

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/files", StaticFiles(directory=UPLOAD_DIR), name="files")
app.include_router(upload_router)

@app.post("/login", response_model=Token)
async def login(data: Login):
    return login_user(data)

# New: username availability check (case-insensitive), uses the WebSocket manager state
try:
    from .sockets.ws import manager as ws_manager  # active connections live here
    @app.get("/user-available")
    async def user_available(name: str):
        low = (name or "").strip().lower()
        taken = any((u or "").lower() == low for u in ws_manager.active.keys())
        return {"available": (not taken)}
except Exception:
    # Fallback if import fails; treat as available to avoid blocking logins
    @app.get("/user-available")
    async def user_available(name: str):
        return {"available": True}

@app.websocket("/ws/{token}")
async def websocket_endpoint(ws: WebSocket, token: str):
    await ws_handler(ws, token)

# Serve frontend SPA (built files) at root so GET / works locally and via Cloudflare
try:
    import os
    from fastapi.staticfiles import StaticFiles
    FRONTEND_DIR = os.environ.get("CHATAPP_FRONTEND_DIR") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))
    if os.path.isdir(FRONTEND_DIR):
        app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="spa")
except Exception:
    pass

