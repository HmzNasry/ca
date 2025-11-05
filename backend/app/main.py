from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .auth import login_user, Login, Token
from .upload import router as upload_router, UPLOAD_DIR
from .db import init_db
from .websocket_handlers import ws_handler
import os
os.system("/data/chatapp/backend/update_chatlink.sh")

app = FastAPI()
init_db()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/files", StaticFiles(directory=UPLOAD_DIR), name="files")
app.include_router(upload_router)

# Cleanup uploads on server start: remove DM/GC folders and clear main files
try:
    import shutil
    @app.on_event("startup")
    async def _cleanup_uploads_on_start():
        try:
            dm_dir = os.path.join(UPLOAD_DIR, "dm")
            gc_dir = os.path.join(UPLOAD_DIR, "gc")
            main_dir = os.path.join(UPLOAD_DIR, "main")
            # Remove dm and gc folders entirely
            for d in (dm_dir, gc_dir):
                if os.path.isdir(d):
                    try:
                        shutil.rmtree(d)
                    except Exception:
                        pass
            # Recreate empty dm and gc directories
            try:
                os.makedirs(dm_dir, exist_ok=True)
                os.makedirs(gc_dir, exist_ok=True)
            except Exception:
                pass
            # Clear files inside main directory (but keep the folder)
            if os.path.isdir(main_dir):
                try:
                    for name in os.listdir(main_dir):
                        p = os.path.join(main_dir, name)
                        try:
                            if os.path.isfile(p) or os.path.islink(p):
                                os.remove(p)
                            elif os.path.isdir(p):
                                shutil.rmtree(p)
                        except Exception:
                            pass
                except Exception:
                    pass
        except Exception:
            # Never crash server due to cleanup
            pass
except Exception:
    pass

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

