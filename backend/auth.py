import hashlib
import os
import secrets
import stat
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from database import get_db
from models import UserDB

# ── Secret key ──────────────────────────────────────────────────── #
# Previously this fell back to a fresh random key on every start, which
# silently invalidated every token whenever the server restarted — users
# were logged out mid-session for no visible reason. Now an unset env var
# generates a key ONCE and persists it beside the database.

_SECRET_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".jwt_secret")


def _load_or_create_secret() -> str:
    env = os.environ.get("JWT_SECRET_KEY")
    if env:
        return env
    if os.path.exists(_SECRET_FILE):
        with open(_SECRET_FILE) as f:
            saved = f.read().strip()
            if saved:
                return saved
    generated = secrets.token_hex(32)
    with open(_SECRET_FILE, "w") as f:
        f.write(generated)
    try:
        os.chmod(_SECRET_FILE, stat.S_IRUSR | stat.S_IWUSR)  # owner read/write only
    except OSError:
        pass
    print(
        "NOTE: JWT_SECRET_KEY was not set. A key was generated and saved to "
        f"{_SECRET_FILE}. Set JWT_SECRET_KEY in production instead."
    )
    return generated


SECRET_KEY = _load_or_create_secret()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8  # 8 hours

# ── Brute-force protection ──────────────────────────────────────── #

MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15

# ── Terms of service ────────────────────────────────────────────── #

# Bump this whenever the terms change in a way people should see. Every
# account whose stored terms_version differs is asked to accept again on
# their next request — which includes accounts that have never accepted,
# since those store an empty string.
#
# Keep it in step with LAST_UPDATED in frontend/src/pages/TermsContent.jsx.
# The page shows the date; this decides who gets stopped.
TERMS_VERSION = os.environ.get("TERMS_VERSION", "2026-11-25")

# Endpoints that must keep working while someone is being asked to accept,
# or they could never get out of it: who am I, what do I owe, and accepting.
# Everything else is closed until the current version is on the account.
TERMS_EXEMPT_PATHS = frozenset({
    "/auth/me",
    "/terms/status",
    "/terms/accept",
})


def terms_outstanding(user: UserDB) -> bool:
    return str(user.terms_version or "") != TERMS_VERSION


# ── Password hashing ────────────────────────────────────────────── #

_PBKDF2_ITERS = 260_000
_PBKDF2_PREFIX = "pbkdf2:sha256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    """Timezone-aware UTC timestamp. Stored everywhere so the app behaves
    correctly across timezones and on a server in a different region."""
    return utc_now().isoformat(timespec="seconds")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _PBKDF2_ITERS)
    return f"{_PBKDF2_PREFIX}:{_PBKDF2_ITERS}:{salt}:{dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if stored.startswith(_PBKDF2_PREFIX + ":"):
        try:
            _, _, iters_s, salt, expected = stored.split(":")
            dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iters_s))
            return secrets.compare_digest(dk.hex(), expected)
        except Exception:
            return False
    # Legacy plain-SHA-256 (no salt) — accepted once, upgraded on next login
    return secrets.compare_digest(
        hashlib.sha256(password.encode("utf-8")).hexdigest(), stored
    )


def is_locked_out(user: UserDB) -> Optional[int]:
    """Return remaining lockout seconds, or None if the account is usable."""
    if not user.locked_until:
        return None
    try:
        until = datetime.fromisoformat(user.locked_until)
    except ValueError:
        return None
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    remaining = (until - utc_now()).total_seconds()
    return int(remaining) if remaining > 0 else None


def register_failed_login(db: Session, user: UserDB) -> None:
    user.failed_logins = (user.failed_logins or 0) + 1
    if user.failed_logins >= MAX_FAILED_LOGINS:
        user.locked_until = (
            utc_now() + timedelta(minutes=LOCKOUT_MINUTES)
        ).isoformat(timespec="seconds")
        user.failed_logins = 0
    db.commit()


def clear_failed_logins(db: Session, user: UserDB) -> None:
    if user.failed_logins or user.locked_until:
        user.failed_logins = 0
        user.locked_until = ""
        db.commit()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    to_encode["exp"] = utc_now() + (expires_delta or timedelta(minutes=15))
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> UserDB:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise exc
    except JWTError:
        raise exc

    user = db.query(UserDB).filter(UserDB.name == username).first()
    if not user:
        raise exc

    # Every authenticated route in the application resolves through this
    # dependency, so one check here closes all of them at once rather than
    # relying on 40-odd routes each remembering to ask. The frontend shows
    # the acceptance screen before it gets this far; this is the backstop
    # that makes the screen more than a suggestion.
    if request.url.path not in TERMS_EXEMPT_PATHS and terms_outstanding(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "terms_acceptance_required",
                "version": TERMS_VERSION,
                "message": "The terms of service have been updated. "
                           "Please review and accept them to continue.",
            },
        )
    return user


def require_staff(current_user: UserDB = Depends(get_current_user)) -> UserDB:
    """Dependency for routes open to technicians and admins but not requesters.

    Role "Both" is this app's name for an admin, who is also a technician, so
    the check is framed as "not a Requester" rather than listing the two
    roles that qualify.
    """
    if current_user.role == "Requester":
        raise HTTPException(
            status_code=403, detail="Technician or admin access required"
        )
    return current_user


def require_admin(current_user: UserDB = Depends(get_current_user)) -> UserDB:
    """Dependency for admin-only routes."""
    if current_user.role != "Both":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user