from pydantic import BaseModel

class Login(BaseModel):
    username: str
    server_password: str

class Token(BaseModel):
    access_token: str
    token_type: str
