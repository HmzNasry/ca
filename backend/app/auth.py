from fastapi import HTTPException
from jose import jwt
from pydantic import BaseModel

SECRET_KEY = "41bbd87b957b7261457a5cb438974dd9f9131cc1f9a1099afb314cbd843ee642"
ALGORITHM = "HS256"
ADMIN_USER = "HAZ"
ADMIN_PASS = "71060481"
# SUPER_PASS is used for /mkadmin and /rmadmin admin commands
# Defaulting to ADMIN_PASS so the logged-in admin can use the same secret
SUPER_PASS = ADMIN_PASS
SERVER_PASSWORD = "securepass32x1"

class Login(BaseModel):
    username: str
    server_password: str

class Token(BaseModel):
    access_token: str
    token_type: str

def login_user(data: Login):
    role = "user"
    if data.username == ADMIN_USER and data.server_password == ADMIN_PASS:
        role = "admin"
    elif data.server_password != SERVER_PASSWORD:
        raise HTTPException(status_code=401)
    tok = jwt.encode({"sub": data.username, "role": role}, SECRET_KEY, algorithm=ALGORITHM)
    return {"access_token": tok, "token_type": "bearer"}

