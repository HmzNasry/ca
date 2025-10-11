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

@app.websocket("/ws/{token}")
async def websocket_endpoint(ws: WebSocket, token: str):
    await ws_handler(ws, token)

