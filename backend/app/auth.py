from fastapi import HTTPException
from jose import jwt
from pydantic import BaseModel

SECRET_KEY = "41bbd87b957b7261457a5cb438974dd9f9131cc1f9a1099afb314cbd843ee642"
ALGORITHM = "HS256"
ADMIN_USER = "HAZ"
ADMIN_PASS = "INBDgXLqXC6GPikU8P/+ichtP"
# SUPER_PASS is used for /mkadmin and /rmadmin admin commands (not for login)
SUPER_PASS = "71060481"
SERVER_PASSWORD = "securepass32x1"

class Login(BaseModel):
    username: str
    server_password: str

class Token(BaseModel):
    access_token: str
    token_type: str

def login_user(data: Login):
    # Normalize inputs
    username = (data.username or "").strip()
    server_password = (data.server_password or "").strip()

    # If the provided password matches ADMIN_PASS, grant admin regardless of username
    if server_password == ADMIN_PASS:
        tok = jwt.encode({"sub": username, "role": "admin"}, SECRET_KEY, algorithm=ALGORITHM)
        return {"access_token": tok, "token_type": "bearer"}

    # Otherwise require the regular server password and grant user role
    if server_password != SERVER_PASSWORD:
        raise HTTPException(status_code=401)

    tok = jwt.encode({"sub": username, "role": "user"}, SECRET_KEY, algorithm=ALGORITHM)
    return {"access_token": tok, "token_type": "bearer"}

