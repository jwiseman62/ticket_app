import hashlib
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from database import get_db
from models import UserDB

SECRET_KEY = os.environ.get("JWT_SECRET_KEY", secrets.token_hex(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8  # 8 hours

_PBKDF2_ITERS  = 260_000
_PBKDF2_PREFIX = "pbkdf2:sha256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk   = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _PBKDF2_ITERS)
    return f"{_PBKDF2_PREFIX}:{_PBKDF2_ITERS}:{salt}:{dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if stored.startswith(_PBKDF2_PREFIX + ":"):
        try:
            _, _, iters_s, salt, expected = stored.split(":")
            dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iters_s))
            return dk.hex() == expected
        except Exception:
            return False
    # Legacy plain-SHA-256 (no salt) – accepted, upgraded on next save
    return hashlib.sha256(password.encode("utf-8")).hexdigest() == stored


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire    = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db:    Session = Depends(get_db),
) -> UserDB:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload  = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise exc
    except JWTError:
        raise exc

    user = db.query(UserDB).filter(UserDB.name == username).first()
    if not user:
        raise exc
    return user
