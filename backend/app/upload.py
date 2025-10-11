from fastapi import APIRouter, UploadFile, File, Form, HTTPException
import os, uuid, re

router = APIRouter()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "..", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

_safe = re.compile(r"[^a-zA-Z0-9_.-]+")

def _safe_name(s: str) -> str:
  return _safe.sub("_", s or "")

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    thread: str | None = Form(default=None),
    peer: str | None = Form(default=None),
    user: str | None = Form(default=None),
):
    mime = file.content_type or "application/octet-stream"
    ext = os.path.splitext(file.filename or "")[1] or ""
    if not ext:
        if mime.startswith("image/"): ext = ".png"
        elif mime.startswith("video/"): ext = ".mp4"
        elif mime.startswith("audio/"): ext = ".mp3"
        else: ext = ".bin"

    # Per-thread folder strategy:
    # - main: uploads/main/
    # - dm: uploads/dm/<sorted_userA__userB>/
    subdir = ""
    if thread == "dm" and peer and user:
        a, b = sorted([_safe_name(user), _safe_name(peer)])
        subdir = os.path.join("dm", f"{a}__{b}")
    elif thread == "main":
        subdir = "main"
    target_dir = os.path.join(UPLOAD_DIR, subdir) if subdir else UPLOAD_DIR
    os.makedirs(target_dir, exist_ok=True)

    fname = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(target_dir, fname)
    try:
        # Stream to disk in chunks instead of reading entire file into memory
        chunk_size = 1024 * 1024  # 1MB
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                out.write(chunk)
    except Exception as e:
        # Clean up partial file on error
        try:
            if os.path.exists(dest):
                os.remove(dest)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e))

    # Build URL reflecting nesting
    url_path = f"/files/{fname}" if not subdir else f"/files/{subdir.replace(os.sep,'/')}/{fname}"
    return {"url": url_path, "mime": mime}

