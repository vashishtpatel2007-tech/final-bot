"""
Authentication module — signup, login, forgot-password, JWT tokens.
Uses bcrypt directly (passlib has issues with Python 3.13).
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
import bcrypt
from jose import JWTError, jwt
from datetime import datetime, timedelta
import os

from database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer()

JWT_SECRET = os.getenv("JWT_SECRET", "change-this-to-a-random-secret")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 72


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


# ── Pydantic Models ──────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    name: str
    password: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class UserResponse(BaseModel):
    id: int
    email: str
    name: str


# ── Helper Functions ──────────────────────────────────────────

def create_token(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Decode JWT token and return user info. Use as a dependency."""
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, email, name FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="User not found")
        return {
            "id": row[0],
            "email": row[1],
            "name": row[2],
        }
    finally:
        await db.close()


# ── Routes ────────────────────────────────────────────────────

@router.post("/signup")
async def signup(req: SignupRequest):
    hashed = hash_password(req.password)
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO users (email, name, hashed_password) VALUES (?, ?, ?)",
            (req.email, req.name, hashed),
        )
        await db.commit()
        cursor = await db.execute("SELECT last_insert_rowid()")
        row = await cursor.fetchone()
        user_id = row[0]
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=400, detail="Email already registered")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await db.close()

    token = create_token(user_id, req.email)
    return {"token": token, "user": {"id": user_id, "email": req.email, "name": req.name}}


@router.post("/login")
async def login(req: LoginRequest):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, email, name, hashed_password FROM users WHERE email = ?", (req.email,))
        row = await cursor.fetchone()
    finally:
        await db.close()

    if not row or not verify_password(req.password, row[3]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user_id, email, name = row[0], row[1], row[2]
    token = create_token(user_id, email)
    return {"token": token, "user": {"id": user_id, "email": email, "name": name}}


@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest):
    """MVP version: resets password to a temporary one and returns it."""
    import secrets
    temp_password = secrets.token_urlsafe(8)
    hashed = hash_password(temp_password)

    db = await get_db()
    try:
        cursor = await db.execute("SELECT id FROM users WHERE email = ?", (req.email,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No account with this email")
        await db.execute("UPDATE users SET hashed_password = ? WHERE email = ?", (hashed, req.email))
        await db.commit()
    finally:
        await db.close()

    return {"message": f"Password has been reset. Your temporary password is: {temp_password}. Please login and change it."}


@router.get("/me")
async def get_me(user=Depends(get_current_user)):
    return user
