import csv
import io
import hashlib
import os
import re
import secrets
import shutil
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import (
    Depends, FastAPI, File, Header, HTTPException, Query, Request,
    Response, UploadFile, status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES, LOCKOUT_MINUTES, clear_failed_logins,
    create_access_token, get_current_user, hash_password, is_locked_out,
    register_failed_login, require_admin, require_staff, utc_now, utc_now_iso,
    verify_password,
)
from database import (Base, SessionLocal, describe_backend, engine, get_db,
                      migrate)
from email_utils import email_configured, send_bulk, send_notification
from models import (
    ArticleCreate, ArticleDB, ArticleOut,
    AttachmentDB, AttachmentOut,
    CommentCreate, CommentDB, CommentOut,
    VALID_STATUSES,
    TicketCreate, TicketDB, TicketOut, TicketStatusUpdate, TicketUpdate,
    InviteCodeDB, InviteCreate, InviteOut, InviteRedeem,
    AdminUserCreate, AnnouncementDB, AnnouncementIn, AnnouncementOut,
    ConversationDB, ConversationOut, ConversationStart,
    MessageDB, MessageIn, MessageOut,
    ResendCodeRequest, VerifyRequest,
    UserCreate, UserDB, UserEmailUpdate, UserOut, UserPasswordReset, UserRoleUpdate,
)
from seed_articles import SEED_ARTICLES

# ── Configuration ───────────────────────────────────────────────── #

def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# Origins allowed to call this API from a browser. Comma-separated.
# The localhost defaults cover `npm run dev`; a deployment must set its
# real origin or every request is blocked by CORS.
CORS_ORIGINS = [
    o.strip() for o in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",") if o.strip()
]

# Demo mode relaxes nothing security-wise; it only enables the public demo
# affordances (advertised demo accounts, the scheduled reset endpoint).
DEMO_MODE = _env_flag("DEMO_MODE")
DEMO_RESET_TOKEN = os.environ.get("DEMO_RESET_TOKEN", "")

# Hosts with ephemeral disks (Render's free tier among them) lose anything
# written to backend/uploads/ on restart. Storing bytes in the database
# keeps attachments working without adding object storage.
STORE_UPLOADS_IN_DB = _env_flag("STORE_UPLOADS_IN_DB")

# ── Archive and trash ───────────────────────────────────────────── #
#
# A ticket closed within the grace period stays in the live queue, so work
# doesn't vanish the instant someone marks it done. After that it is only
# reachable from the archive, which keeps closed tickets forever — they are
# the record of what was fixed and how.
CLOSED_GRACE_DAYS = int(os.environ.get("CLOSED_GRACE_DAYS", "1"))

# Deleted tickets are recoverable for this long, then purged for real.
TRASH_RETENTION_DAYS = int(os.environ.get("TRASH_RETENTION_DAYS", "30"))

# ── Email verification ──
# Off by default. The public demo runs with it off so the "Try it instantly"
# buttons keep working; turn it on where real email delivery is configured.
REQUIRE_EMAIL_VERIFICATION = (
    os.environ.get("REQUIRE_EMAIL_VERIFICATION", "false").lower() == "true"
)
VERIFICATION_IDLE_DAYS = int(os.environ.get("VERIFICATION_IDLE_DAYS", "30"))
VERIFY_CODE_TTL_MINUTES = int(os.environ.get("VERIFY_CODE_TTL_MINUTES", "15"))
VERIFY_MAX_ATTEMPTS = int(os.environ.get("VERIFY_MAX_ATTEMPTS", "5"))

# ── Startup ─────────────────────────────────────────────────────── #

Base.metadata.create_all(bind=engine)
migrate()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
if not STORE_UPLOADS_IN_DB:
    os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "10")) * 1024 * 1024
ALLOWED_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
    ".pdf", ".txt", ".log", ".csv",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip",
}


def _seed_articles_once() -> None:
    db = next(get_db())
    try:
        if db.query(ArticleDB).count() == 0:
            now = utc_now_iso()
            for a in SEED_ARTICLES:
                db.add(ArticleDB(**a, created_at=now, updated_at=now))
            db.commit()
    finally:
        db.close()


_seed_articles_once()

app = FastAPI(title="Tech Help API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print(f"Database : {describe_backend()}")
print(f"CORS     : {', '.join(CORS_ORIGINS)}")
print(f"Uploads  : {'database' if STORE_UPLOADS_IN_DB else UPLOAD_DIR}")
if DEMO_MODE:
    print("Demo mode: ON")


@app.get("/health")
def health():
    """Liveness probe.

    Render uses this for health checks, and the frontend pings it on load so
    it can show a 'waking up' notice during a free-tier cold start instead of
    appearing broken.
    """
    return {"status": "ok", "demo_mode": DEMO_MODE}


# ── Helpers ─────────────────────────────────────────────────────── #

def fmt_id(ticket) -> str:
    """The reference people quote: "TK-AC43".

    Accepts a ticket or a bare id. Tickets created before refs existed, and
    the handful of call sites that only have an id to hand, fall back to the
    old TKT-### form rather than showing nothing.
    """
    ref = getattr(ticket, "ref", "")
    if ref:
        return str(ref)
    ticket_id = ticket if isinstance(ticket, int) else getattr(ticket, "id", 0)
    return f"TKT-{ticket_id:03d}"


def _apply_filters(tickets, search, status_filter, priority_filter, view,
                   current_name, hide_archived: bool = True):
    """Filter the live queue.

    hide_archived drops tickets closed longer ago than the grace period —
    except when the caller has explicitly asked for status=Closed, because
    then they have said what they want and should get all of it.
    """
    query = search.strip().lower()
    show_all_closed = status_filter == "Closed"
    result = []
    for t in tickets:
        if hide_archived and not show_all_closed and _is_archived(t):
            continue
        if view == "My Tickets" and t.requester.lower() != current_name:
            continue
        if view == "Assigned To Me" and t.technician.lower() != current_name:
            continue
        if view == "Unassigned" and (t.technician or "").strip():
            continue
        if status_filter != "All" and t.status != status_filter:
            continue
        if priority_filter != "All" and t.priority != priority_filter:
            continue
        if query:
            hay = f"{t.title} {t.requester} {t.technician} {t.description}".lower()
            if query not in hay:
                continue
        result.append(t)
    return result


# ── Ticket references ───────────────────────────────────────────── #
#
# "TK-AC43" rather than "TKT-001". People read these aloud and type them from
# memory, so the alphabet leaves out the characters that get confused: 0/O,
# 1/I/L. That leaves 31 symbols and 31^4 = 923,521 combinations.

REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
REF_LENGTH = 4
REF_PREFIX = "TK-"


def _random_ref() -> str:
    return REF_PREFIX + "".join(
        secrets.choice(REF_ALPHABET) for _ in range(REF_LENGTH)
    )


def generate_ticket_ref(db: Session, attempts: int = 12) -> str:
    """A reference not already in use.

    Random rather than sequential, so collisions are possible: by the
    birthday bound a few thousand tickets give a real chance of one. Checking
    and retrying costs an indexed lookup and removes the problem entirely.
    """
    for _ in range(attempts):
        candidate = _random_ref()
        exists = (db.query(TicketDB.id)
                    .filter(TicketDB.ref == candidate).first())
        if not exists:
            return candidate

    # Astronomically unlikely unless the space is nearly full. Falling back to
    # the row id keeps ticket creation working rather than failing outright.
    fallback = db.query(TicketDB).count() + 1
    return f"{REF_PREFIX}{fallback:04d}"


def backfill_ticket_refs(db: Session) -> int:
    """Give a reference to any ticket created before refs existed."""
    missing = db.query(TicketDB).filter(
        (TicketDB.ref == "") | (TicketDB.ref.is_(None))
    ).all()
    for ticket in missing:
        ticket.ref = generate_ticket_ref(db)
        # Flush so the next generate_ticket_ref sees this one and can't
        # hand out the same code twice inside a single backfill.
        db.flush()
    if missing:
        db.commit()
    return len(missing)


def _live(db: Session):
    """Base query for tickets that have not been soft-deleted.

    Every list-level query goes through this. Querying TicketDB directly
    anywhere else will leak deleted tickets back into the list, the stats,
    or the CSV export — the usual failure mode of soft deletion, and the
    reason there is exactly one place here to get it right.
    """
    return db.query(TicketDB).filter(TicketDB.deleted_at == "")


def _deleted(db: Session):
    """Base query for tickets currently in the trash."""
    return db.query(TicketDB).filter(TicketDB.deleted_at != "")


def _days_ago_iso(days: int) -> str:
    return (utc_now() - timedelta(days=days)).isoformat(timespec="seconds")


def _is_archived(ticket: TicketDB) -> bool:
    """Closed longer ago than the grace period, so hidden from the live queue."""
    if str(ticket.status) != "Closed":
        return False
    closed = str(ticket.closed_at or "")
    if not closed:
        # Closed before closed_at existed; treat as archived rather than
        # letting undated history sit in the live queue forever.
        return True
    return closed < _days_ago_iso(CLOSED_GRACE_DAYS)


def _get_ticket_or_404(db: Session, ticket_id: int,
                       include_deleted: bool = False) -> TicketDB:
    """Fetch one ticket.

    Deleted tickets are invisible by default; only restore and permanent
    delete pass include_deleted=True.
    """
    query = db.query(TicketDB) if include_deleted else _live(db)
    ticket = query.filter(TicketDB.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


def _hard_delete(db: Session, ticket: TicketDB) -> None:
    """Remove a ticket and everything hanging off it, for real.

    Attachments stored on disk need their file removed too; ones held in the
    database go with the row.
    """
    ticket_id = ticket.id
    for att in db.query(AttachmentDB).filter(AttachmentDB.ticket_id == ticket_id).all():
        if att.data is None:
            path = os.path.join(UPLOAD_DIR, str(att.stored_name))
            if os.path.exists(path):
                os.remove(path)
        db.delete(att)
    for c in db.query(CommentDB).filter(CommentDB.ticket_id == ticket_id).all():
        db.delete(c)
    db.delete(ticket)


def _purge_expired(db: Session) -> int:
    """Permanently remove trash older than the retention window."""
    cutoff = _days_ago_iso(TRASH_RETENTION_DAYS)
    expired = (_deleted(db)
               .filter(TicketDB.deleted_at < cutoff)
               .all())
    for ticket in expired:
        _hard_delete(db, ticket)
    if expired:
        db.commit()
    return len(expired)


def _require_admin(user: UserDB) -> None:
    if user.role != "Both":
        raise HTTPException(status_code=403, detail="Admin (Both role) required")


def _emails_for(db: Session, *names: str) -> list:
    """Look up email addresses for the given usernames.

    Ticket.requester / .technician store display names, so a lookup is needed
    to reach an actual address. Unknown names and users without an email are
    skipped silently.
    """
    wanted = {n.strip() for n in names if n and n.strip()}
    if not wanted:
        return []
    rows = db.query(UserDB).filter(UserDB.name.in_(wanted)).all()
    return [u.email for u in rows if u.email]


# ── Email verification ──────────────────────────────────────────── #
#
# Requesters confirm their address at signup, and again after a long gap.
# Technicians and admins are exempt: they're staff the admin created or
# approved, and locking a technician out of an incident because a code
# didn't arrive is worse than the risk it guards against.


def _hash_code(code: str) -> str:
    """Codes are stored hashed so a database dump doesn't hand out live ones."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def verification_available() -> bool:
    """Whether the gate can be enforced at all.

    Requires both the flag and a working mail provider. Enforcing it without
    somewhere to send the code would lock every new user out permanently,
    so the absence of email silently disables the gate rather than bricking
    signup.
    """
    return REQUIRE_EMAIL_VERIFICATION and email_configured()


def user_needs_verification(user: UserDB) -> bool:
    """Whether this user must enter a code before being let in."""
    if not verification_available():
        return False
    # Staff are exempt by design.
    if user.role != "Requester":
        return False
    # Demo accounts keep the public demo one click away.
    if DEMO_MODE and str(user.name or "").startswith("demo."):
        return False
    if not str(user.email or "").strip():
        # Nowhere to send a code; don't strand them.
        return False

    if not str(user.email_verified_at or ""):
        return True

    # Verified once, but away long enough that we re-check.
    last = str(user.last_login or "")
    if not last:
        return True
    return last < _days_ago_iso(VERIFICATION_IDLE_DAYS)


def issue_verification_code(db: Session, user: UserDB) -> str:
    """Generate, store and email a fresh code. Returns it (for tests/logs)."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    user.verify_code_hash = _hash_code(code)
    user.verify_expires_at = (
        utc_now() + timedelta(minutes=VERIFY_CODE_TTL_MINUTES)
    ).isoformat(timespec="seconds")
    user.verify_attempts = 0
    db.commit()

    send_notification(
        subject=f"Your Tech Help verification code: {code}",
        body=(
            f"Hi {user.name},\n\n"
            f"Your verification code is {code}\n\n"
            f"It expires in {VERIFY_CODE_TTL_MINUTES} minutes. If you didn't "
            f"try to sign in, you can ignore this message.\n"
        ),
        to=[user.email],
    )
    return code


def _mark_signed_in(db: Session, user: UserDB) -> dict:
    """Record the login and mint a token."""
    user.last_login = utc_now_iso()
    db.commit()
    token = create_access_token(
        {"sub": user.name, "role": user.role},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": token, "token_type": "bearer",
            "role": user.role, "name": user.name}


# ═══════════════════════════ AUTH ═══════════════════════════ #

@app.post("/auth/register", response_model=UserOut, status_code=201)
def register(body: UserCreate, db: Session = Depends(get_db)):
    """Create an account.

    SECURITY: the role is decided by the server, never the client. Previously
    the signup form let anyone pick "Both" and hand themselves admin rights
    over the whole system.

    The one exception is bootstrapping: on a completely empty database the
    first account becomes the admin, because otherwise nobody could ever
    promote anyone.
    """
    if db.query(UserDB).filter(UserDB.name == body.name).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    if db.query(UserDB).filter(UserDB.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    is_first_user = db.query(UserDB).count() == 0
    role = "Both" if is_first_user else "Requester"

    user = UserDB(
        name=body.name,
        email=body.email,
        role=role,
        password_hash=hash_password(body.password),
        created_at=utc_now_iso(),
        # Recorded, not granted — an admin still has to issue a code.
        requested_role="" if is_first_user else body.requested_role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    if user_needs_verification(user):
        issue_verification_code(db, user)

    return user


@app.post("/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Authenticate.

    Wrong credentials always return the same message whether or not the
    username exists, so the endpoint can't be used to discover valid accounts.
    After repeated failures the account locks temporarily, which makes
    password guessing impractical.
    """
    bad_credentials = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect username or password",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user = db.query(UserDB).filter(UserDB.name == form.username).first()
    if not user:
        raise bad_credentials

    locked_for = is_locked_out(user)
    if locked_for is not None:
        minutes = max(1, locked_for // 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Too many failed attempts. Try again in about {minutes} "
                f"minute{'s' if minutes != 1 else ''}."
            ),
        )

    if not verify_password(form.password, user.password_hash):
        register_failed_login(db, user)
        raise bad_credentials

    clear_failed_logins(db, user)

    # Upgrade a legacy unsalted hash now that we know the plaintext
    if not user.password_hash.startswith("pbkdf2:sha256:"):
        user.password_hash = hash_password(form.password)
        db.commit()

    # Password was right. If this account still owes us a code, don't issue a
    # token — hand back a challenge and email a fresh code instead.
    if user_needs_verification(user):
        issue_verification_code(db, user)
        masked = _mask_email(user.email)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "verification_required",
                "username": user.name,
                "email_hint": masked,
                "message": f"We sent a 6-digit code to {masked}.",
            },
        )

    return _mark_signed_in(db, user)


def _mask_email(addr: str) -> str:
    """j•••@example.com — enough to recognise, not enough to harvest."""
    addr = (addr or "").strip()
    if "@" not in addr:
        return "your email"
    local, _, domain = addr.partition("@")
    head = local[0] if local else ""
    return f"{head}{'•' * max(2, len(local) - 1)}@{domain}"


@app.post("/auth/verify")
def verify_email(body: VerifyRequest, db: Session = Depends(get_db)):
    """Exchange a 6-digit code for a token.

    Deliberately vague on failure: the same message covers a wrong code, an
    expired one and an unknown username, so this can't be used to discover
    which accounts exist or whether a code is still live.
    """
    invalid = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="That code isn't right, or it has expired. Request a new one.",
    )

    user = db.query(UserDB).filter(UserDB.name == body.username).first()
    if not user or not str(user.verify_code_hash or ""):
        raise invalid

    if int(user.verify_attempts or 0) >= VERIFY_MAX_ATTEMPTS:
        # Burn the code rather than leaving it guessable.
        user.verify_code_hash = ""
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect codes. Request a new one.",
        )

    expires = str(user.verify_expires_at or "")
    if not expires or expires < utc_now_iso():
        raise invalid

    if not secrets.compare_digest(_hash_code(body.code), str(user.verify_code_hash)):
        user.verify_attempts = int(user.verify_attempts or 0) + 1
        db.commit()
        raise invalid

    # Correct. Clear the challenge and let them in.
    user.email_verified_at = utc_now_iso()
    user.verify_code_hash = ""
    user.verify_expires_at = ""
    user.verify_attempts = 0
    db.commit()
    return _mark_signed_in(db, user)


@app.post("/auth/resend-code")
def resend_verification_code(body: ResendCodeRequest, db: Session = Depends(get_db)):
    """Send another code.

    Always reports success, whether or not the username exists, so this
    can't be used to enumerate accounts.
    """
    user = db.query(UserDB).filter(UserDB.name == body.username).first()
    if user and user_needs_verification(user):
        issue_verification_code(db, user)
    return {"ok": True, "message": "If that account needs a code, one is on its way."}


@app.get("/auth/me", response_model=UserOut)
def get_me(current_user: UserDB = Depends(get_current_user)):
    return current_user


# ═══════════════════════════ USERS ═══════════════════════════ #

@app.get("/users", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db),
               current_user: UserDB = Depends(get_current_user)):
    """List users. Email addresses are visible to admins only — everyone else
    needs the names (for assignment dropdowns) but not the contact details."""
    users = db.query(UserDB).all()
    if current_user.role == "Both":
        return users
    return [
        UserOut(id=u.id, name=u.name, role=u.role, email="")
        for u in users
    ]


@app.post("/users", response_model=UserOut, status_code=201)
def create_user(body: AdminUserCreate, db: Session = Depends(get_db),
                current_user: UserDB = Depends(require_admin)):
    """Create an account for someone. Admin only.

    The duplicate check is deliberately case-insensitive, which is stricter
    than self-signup. Tickets record people by *name*, not by id, so "sam"
    and "Sam" would be two accounts competing for one identity in the
    assignment dropdown and in every ticket's history.
    """
    clash = db.query(UserDB).filter(func.lower(UserDB.name) == body.name.lower()).first()
    if clash:
        raise HTTPException(status_code=400, detail="That username is already taken")
    if db.query(UserDB).filter(UserDB.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = UserDB(
        name=body.name,
        email=body.email,
        role=body.role,
        password_hash=hash_password(body.password),
        created_at=utc_now_iso(),
        # Created directly, so there is no pending request to record.
        requested_role="",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    print(f"[admin] {current_user.name} created account '{user.name}' ({user.role})")
    return user


@app.put("/users/{user_id}/email", response_model=UserOut)
def update_user_email(user_id: int, body: UserEmailUpdate,
                      db: Session = Depends(get_db),
                      current_user: UserDB = Depends(get_current_user)):
    """Set a user's email. Admins can set anyone's; everyone else only their own.

    Needed because accounts created before notifications existed have no
    address on file, and would otherwise never be told anything.
    """
    if current_user.role != "Both" and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    user = db.query(UserDB).filter(UserDB.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    clash = (db.query(UserDB)
               .filter(UserDB.email == body.email, UserDB.id != user_id)
               .first())
    if clash:
        raise HTTPException(status_code=400, detail="Email already in use")

    user.email = body.email
    db.commit()
    db.refresh(user)
    return user


@app.put("/users/{user_id}/role", response_model=UserOut)
def update_user_role(user_id: int, body: UserRoleUpdate,
                     db: Session = Depends(get_db),
                     current_user: UserDB = Depends(require_admin)):
    """Promote or demote a user. Admin only.

    This is the counterpart to locking down self-registration: roles now have
    to be granted deliberately by someone who already has admin rights.
    """
    user = db.query(UserDB).filter(UserDB.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_user.id and body.role != "Both":
        admin_count = db.query(UserDB).filter(UserDB.role == "Both").count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="You are the only admin — promote someone else first",
            )

    user.role = body.role
    db.commit()
    db.refresh(user)
    return user


@app.put("/users/me/password")
def change_my_password(body: UserPasswordReset, db: Session = Depends(get_db),
                       current_user: UserDB = Depends(get_current_user)):
    current_user.password_hash = hash_password(body.password)
    db.commit()
    return {"ok": True}


@app.put("/users/{user_id}/password")
def reset_user_password(user_id: int, body: UserPasswordReset, db: Session = Depends(get_db),
                        current_user: UserDB = Depends(get_current_user)):
    if current_user.role != "Both" and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    user = db.query(UserDB).filter(UserDB.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(body.password)
    db.commit()
    return {"ok": True}


@app.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db),
                current_user: UserDB = Depends(require_admin)):
    """Delete a user and tidy up after them.

    Tickets reference people by name, so deleting a user used to leave tickets
    pointing at somebody who no longer existed — and worse, a new account
    registering under the same name would silently inherit them.

    Now any ticket assigned to the departing user is unassigned (with a history
    entry explaining why). Requester names are left in place deliberately:
    they're a historical record of who reported the issue.
    """
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = db.query(UserDB).filter(UserDB.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role == "Both":
        admin_count = db.query(UserDB).filter(UserDB.role == "Both").count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=400, detail="Cannot delete the only remaining admin"
            )

    now = utc_now_iso()
    # Deliberately not _live(): a trashed ticket can be restored later, and it
    # shouldn't come back assigned to an account that no longer exists.
    assigned = db.query(TicketDB).filter(TicketDB.technician == user.name).all()
    for t in assigned:
        t.technician = ""
        t.updated_at = now
        t.history = (t.history or []) + [
            f"[{now}] Unassigned automatically: user '{user.name}' was deleted"
        ]

    requested_count = _live(db).filter(TicketDB.requester == user.name).count()

    db.delete(user)
    db.commit()
    return {
        "ok": True,
        "unassigned_tickets": len(assigned),
        "requested_tickets_kept": requested_count,
    }


# ═══════════════════════ DEMO CONTROLS ═══════════════════════ #

@app.post("/admin/reset-demo")
def reset_demo(
    x_reset_token: str = Header(default=""),
    db: Session = Depends(get_db),
):
    """Wipe and reseed the demo. Intended for a nightly scheduled job.

    A public demo accumulates deleted tickets, junk accounts and whatever
    else visitors get up to. Rather than locking the app down and making it
    boring to try, let people change anything and put it back every night.

    Returns 404 rather than 401/403 when demo mode is off or the token is
    wrong, so the endpoint's existence isn't advertised to scanners.
    """
    not_found = HTTPException(status_code=404, detail="Not Found")

    if not DEMO_MODE or not DEMO_RESET_TOKEN:
        raise not_found
    if not secrets.compare_digest(x_reset_token or "", DEMO_RESET_TOKEN):
        raise not_found

    from seed_demo import reseed          # imported lazily: demo-only dependency

    counts = reseed(db)
    return {"ok": True, "reseeded": counts}


# ═══════════════════════ INVITE CODES ═══════════════════════ #

# Unambiguous alphabet — no 0/O/1/I/L, so a code read off a screen or spoken
# aloud can't be mistyped.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

# Redeem attempts per user, to stop anyone grinding through the code space.
# In-memory is fine for a single-process server; it resets on restart.
_redeem_attempts: dict = {}
MAX_REDEEM_ATTEMPTS = 10
REDEEM_WINDOW_MINUTES = 15


def _generate_code() -> str:
    body = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
    return f"TECH-{body[:4]}-{body[4:]}"


def _normalise_code(raw: str) -> str:
    """Accept sloppy input: lowercase, missing dashes, stray spaces."""
    cleaned = "".join(ch for ch in (raw or "").upper() if ch.isalnum())
    if cleaned.startswith("TECH"):
        cleaned = cleaned[4:]
    if len(cleaned) != 8:
        return (raw or "").strip().upper()
    return f"TECH-{cleaned[:4]}-{cleaned[4:]}"


def _invite_state(invite: InviteCodeDB) -> str:
    if invite.revoked:
        return "revoked"
    if invite.uses >= invite.max_uses:
        return "used"
    if invite.expires_at and invite.expires_at < utc_now_iso():
        return "expired"
    return "active"


@app.get("/invites", response_model=List[InviteOut])
def list_invites(db: Session = Depends(get_db),
                 _: UserDB = Depends(require_admin)):
    return db.query(InviteCodeDB).order_by(InviteCodeDB.id.desc()).all()


@app.post("/invites", response_model=InviteOut, status_code=201)
def create_invite(body: InviteCreate, db: Session = Depends(get_db),
                  current_user: UserDB = Depends(require_admin)):
    """Mint a code that upgrades whoever redeems it."""
    # Retry on the astronomically unlikely collision
    for _ in range(5):
        code = _generate_code()
        if not db.query(InviteCodeDB).filter(InviteCodeDB.code == code).first():
            break
    else:
        raise HTTPException(status_code=500, detail="Could not generate a unique code")

    expires = (utc_now() + timedelta(days=body.expires_days)).isoformat(timespec="seconds")

    invite = InviteCodeDB(
        code=code, role=body.role, note=body.note.strip(),
        created_by=current_user.name, created_at=utc_now_iso(),
        expires_at=expires, max_uses=body.max_uses, uses=0, revoked=0,
        target_user=body.target_user.strip(),
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    # Tell the recipient a code is waiting, without putting it in the email
    if body.target_user.strip():
        send_notification(
            subject="Your technician access code is ready",
            body=("An administrator has approved your request for Technician "
                  "access.\n\nThey will send you a code or QR code separately. "
                  "Sign in and go to the Redeem page to enter it.\n"),
            to=_emails_for(db, body.target_user.strip()),
        )
    return invite


@app.delete("/invites/{invite_id}")
def revoke_invite(invite_id: int, db: Session = Depends(get_db),
                  _: UserDB = Depends(require_admin)):
    invite = db.query(InviteCodeDB).filter(InviteCodeDB.id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Code not found")
    invite.revoked = 1
    db.commit()
    return {"ok": True}


@app.post("/invites/redeem", response_model=UserOut)
def redeem_invite(body: InviteRedeem, db: Session = Depends(get_db),
                  current_user: UserDB = Depends(get_current_user)):
    """Redeem a code to upgrade your own role.

    Requires being signed in, so a code alone is useless to an anonymous
    attacker, and every redemption is attributable.
    """
    # Rate limit per account
    now = utc_now()
    key = current_user.id
    attempts = [
        t for t in _redeem_attempts.get(key, [])
        if (now - t).total_seconds() < REDEEM_WINDOW_MINUTES * 60
    ]
    if len(attempts) >= MAX_REDEEM_ATTEMPTS:
        _redeem_attempts[key] = attempts
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many attempts. Try again in {REDEEM_WINDOW_MINUTES} minutes.",
        )

    code = _normalise_code(body.code)
    invite = db.query(InviteCodeDB).filter(InviteCodeDB.code == code).first()

    if not invite or _invite_state(invite) != "active":
        attempts.append(now)
        _redeem_attempts[key] = attempts
        detail = "That code is not valid."
        if invite:
            state = _invite_state(invite)
            detail = {
                "revoked": "That code has been revoked.",
                "used":    "That code has already been used.",
                "expired": "That code has expired. Ask your admin for a new one.",
            }.get(state, detail)
        raise HTTPException(status_code=400, detail=detail)

    # If the code names someone, only they may use it
    if invite.target_user and invite.target_user != current_user.name:
        attempts.append(now)
        _redeem_attempts[key] = attempts
        raise HTTPException(
            status_code=403,
            detail="That code was issued to a different account.",
        )

    if current_user.role == invite.role:
        raise HTTPException(status_code=400, detail=f"You are already a {invite.role}.")

    old_role = current_user.role
    current_user.role = invite.role
    current_user.requested_role = ""

    invite.uses += 1
    invite.last_used_by = current_user.name
    invite.last_used_at = utc_now_iso()

    db.commit()
    db.refresh(current_user)

    send_notification(
        subject=f"{current_user.name} redeemed a {invite.role} code",
        body=(f"{current_user.name} upgraded from {old_role} to {invite.role} "
              f"using code {invite.code}.\n"),
        to=_emails_for(db, invite.created_by),
    )
    # The caller must sign in again for their token to carry the new role
    return current_user


@app.get("/users/pending", response_model=List[UserOut])
def list_pending_requests(db: Session = Depends(get_db),
                          _: UserDB = Depends(require_admin)):
    """Accounts that asked for Technician access at signup and are still Requesters."""
    return (db.query(UserDB)
              .filter(UserDB.requested_role != "", UserDB.role == "Requester")
              .order_by(UserDB.id.desc())
              .all())


# ═══════════════════════ KNOWLEDGE BASE ═══════════════════════ #
# Declared before /tickets/{id} routes is not required here, but the
# /articles/suggest route must precede /articles/{article_id}.

@app.get("/articles/suggest", response_model=List[ArticleOut])
def suggest_articles(
    category: str = Query(""),
    text: str = Query(""),
    limit: int = Query(3, ge=1, le=10),
    db: Session = Depends(get_db),
    _: UserDB = Depends(get_current_user),
):
    """Rank articles against a category and a blob of free text."""
    articles = db.query(ArticleDB).all()
    words = {w for w in re.split(r"[^a-z0-9]+", text.lower()) if len(w) > 2}

    scored = []
    for a in articles:
        score = 0
        if category and a.category == category:
            score += 5
        haystack = f"{a.title} {a.keywords} {a.summary}".lower()
        kw = {k.strip() for k in a.keywords.lower().split(",") if k.strip()}
        for w in words:
            if w in kw:
                score += 3
            elif w in haystack:
                score += 1
        if score > 0:
            scored.append((score, a))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [a for _score, a in scored[:limit]]


@app.get("/articles", response_model=List[ArticleOut])
def list_articles(
    search: str = Query(""),
    category: str = Query("All"),
    db: Session = Depends(get_db),
    _: UserDB = Depends(get_current_user),
):
    articles = db.query(ArticleDB).all()
    q = search.strip().lower()
    result = []
    for a in articles:
        if category != "All" and a.category != category:
            continue
        if q and q not in f"{a.title} {a.summary} {a.keywords} {a.body}".lower():
            continue
        result.append(a)
    return sorted(result, key=lambda a: a.title.lower())


@app.get("/articles/{article_id}", response_model=ArticleOut)
def get_article(article_id: int, db: Session = Depends(get_db),
                _: UserDB = Depends(get_current_user)):
    a = db.query(ArticleDB).filter(ArticleDB.id == article_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Article not found")
    return a


@app.post("/articles", response_model=ArticleOut, status_code=201)
def create_article(body: ArticleCreate, db: Session = Depends(get_db),
                   current_user: UserDB = Depends(get_current_user)):
    _require_admin(current_user)
    now = utc_now_iso()
    a = ArticleDB(**body.model_dump(), created_at=now, updated_at=now)
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@app.put("/articles/{article_id}", response_model=ArticleOut)
def update_article(article_id: int, body: ArticleCreate, db: Session = Depends(get_db),
                   current_user: UserDB = Depends(get_current_user)):
    _require_admin(current_user)
    a = db.query(ArticleDB).filter(ArticleDB.id == article_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Article not found")
    for field, value in body.model_dump().items():
        setattr(a, field, value)
    a.updated_at = utc_now_iso()
    db.commit()
    db.refresh(a)
    return a


@app.delete("/articles/{article_id}")
def delete_article(article_id: int, db: Session = Depends(get_db),
                   current_user: UserDB = Depends(get_current_user)):
    _require_admin(current_user)
    a = db.query(ArticleDB).filter(ArticleDB.id == article_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Article not found")
    db.delete(a)
    db.commit()
    return {"ok": True}


# ═══════════════════════════ STATS ═══════════════════════════ #

@app.get("/stats")
def get_stats(db: Session = Depends(get_db), _: UserDB = Depends(get_current_user)):
    everything = _live(db).all()

    # A ticket that has moved to the archive is out of the working set, so it
    # leaves every counter here rather than just the Closed one. Draining only
    # Closed would leave Total disagreeing with its own breakdown, which reads
    # as a bug. The archived figure is reported separately so the history is
    # still visible from the dashboard.
    tickets  = [t for t in everything if not _is_archived(t)]
    archived = len(everything) - len(tickets)
    today    = utc_now_iso()[:10]

    by_status   = {"Open": 0, "In Progress": 0, "Closed": 0}
    by_priority = {"High": 0, "Medium": 0, "Low": 0}
    by_category = {}
    overdue = 0

    for t in tickets:
        if t.status   in by_status:   by_status[t.status]     += 1
        if t.priority in by_priority: by_priority[t.priority] += 1
        if t.category:
            by_category[t.category] = by_category.get(t.category, 0) + 1
        if t.due_date and t.due_date < today and t.status != "Closed":
            overdue += 1

    recent = sorted(tickets, key=lambda x: x.updated_at or "", reverse=True)[:8]

    return {
        "total":       len(tickets),
        "archived":    archived,
        "grace_days":  CLOSED_GRACE_DAYS,
        "by_status":   by_status,
        "by_priority": by_priority,
        "by_category": by_category,
        "overdue":     overdue,
        "recent": [
            {
                # ref must be here: the dashboard formats ticket names with
                # the same helper as everywhere else, and without it that
                # helper silently falls back to the old TKT-### form.
                "id": t.id, "ref": t.ref, "title": t.title, "status": t.status,
                "priority": t.priority, "requester": t.requester,
                "technician": t.technician, "updated_at": t.updated_at,
                "due_date": t.due_date, "category": t.category,
            }
            for t in recent
        ],
    }


# ═══════════════════════════ TICKETS ═══════════════════════════ #

@app.get("/tickets/export/csv")
def export_csv(search: str = Query(""), status_filter: str = Query("All"),
               priority_filter: str = Query("All"), view: str = Query("All Tickets"),
               db: Session = Depends(get_db), current_user: UserDB = Depends(get_current_user)):
    tickets = _apply_filters(_live(db).all(), search, status_filter,
                             priority_filter, view, current_user.name.lower())
    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(["reference", "title", "description", "status", "priority", "category",
                "created_at", "updated_at", "requester", "technician", "due_date",
                "survey", "history"])
    for t in tickets:
        survey_txt = "; ".join(f"{k}: {v}" for k, v in (t.survey or {}).items() if v)
        w.writerow([fmt_id(t), t.title, t.description, t.status, t.priority,
                    t.category or "", t.created_at, t.updated_at, t.requester,
                    t.technician, t.due_date, survey_txt, " | ".join(t.history or [])])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=tickets.csv"})


# ═══════════════════════════ Chat ═══════════════════════════ #
#
# Live chat between a requester and whichever technician picks the thread up.
# Delivery is by polling rather than WebSockets: Render's free tier sleeps
# after 15 minutes of silence, which drops every open socket, and a couple of
# seconds of latency is imperceptible in a helpdesk conversation. Each poll
# doubles as the keep-alive that a socket would otherwise need a heartbeat
# for.


def _is_staff(user: UserDB) -> bool:
    return user.role != "Requester"


def _visible_conversations(db: Session, user: UserDB):
    """Threads this person is allowed to see.

    Staff see everything, which matches the ticket list — handover between
    technicians is normal and a thread nobody can read is a thread nobody can
    pick up. Requesters see only their own.
    """
    q = db.query(ConversationDB)
    if _is_staff(user):
        return q
    return q.filter(ConversationDB.requester == user.name)


def _get_conversation_or_404(db: Session, conversation_id: int,
                             user: UserDB) -> ConversationDB:
    convo = (_visible_conversations(db, user)
             .filter(ConversationDB.id == conversation_id).first())
    if not convo:
        # 404 rather than 403 for someone else's thread: a requester probing
        # ids shouldn't be able to learn which ones exist.
        raise HTTPException(status_code=404, detail="Conversation not found")
    return convo


def _unread_for(db: Session, convo: ConversationDB, user: UserDB) -> int:
    """Messages from the other side since this user last looked."""
    mark = (convo.technician_read_at if _is_staff(user)
            else convo.requester_read_at) or ""
    q = (db.query(MessageDB)
           .filter(MessageDB.conversation_id == convo.id)
           .filter(MessageDB.sender != user.name))
    if mark:
        q = q.filter(MessageDB.created_at > mark)
    return q.count()


def _decorate(db: Session, convo: ConversationDB, user: UserDB) -> ConversationOut:
    last = (db.query(MessageDB)
              .filter(MessageDB.conversation_id == convo.id)
              .order_by(MessageDB.created_at.desc(), MessageDB.id.desc())
              .first())
    out = ConversationOut.model_validate(convo)
    out.unread = _unread_for(db, convo, user)
    if last:
        out.last_message = (last.body[:120] + "…") if len(last.body) > 120 else last.body
        out.last_sender = last.sender
    return out


@app.get("/chat/conversations", response_model=List[ConversationOut])
def list_conversations(include_closed: bool = Query(False),
                       db: Session = Depends(get_db),
                       current_user: UserDB = Depends(get_current_user)):
    """Threads, most recently active first."""
    q = _visible_conversations(db, current_user)
    if not include_closed:
        q = q.filter(ConversationDB.closed_at == "")
    rows = q.order_by(ConversationDB.updated_at.desc()).limit(100).all()
    return [_decorate(db, c, current_user) for c in rows]


@app.post("/chat/conversations", response_model=ConversationOut, status_code=201)
def start_conversation(body: ConversationStart, db: Session = Depends(get_db),
                       current_user: UserDB = Depends(get_current_user)):
    """Open a thread and post its first message.

    A requester opens one for themselves and it lands unclaimed in the queue.
    A technician opens one *for* a requester and owns it from the start,
    since they're the one reaching out.
    """
    now = utc_now_iso()

    if _is_staff(current_user):
        target = (body.requester or "").strip()
        if not target:
            raise HTTPException(
                status_code=400, detail="Choose who you want to message")
        other = db.query(UserDB).filter(UserDB.name == target).first()
        if not other:
            raise HTTPException(status_code=404, detail="No such user")
        if _is_staff(other):
            raise HTTPException(
                status_code=400,
                detail="Chat threads are between the helpdesk and a requester",
            )
        convo = ConversationDB(
            requester=other.name, technician=current_user.name,
            subject=body.subject.strip()[:120], created_at=now, updated_at=now,
            technician_read_at=now,
        )
    else:
        # Reuse an open thread rather than stacking duplicates in the queue
        # every time the widget is reopened.
        existing = (db.query(ConversationDB)
                      .filter(ConversationDB.requester == current_user.name)
                      .filter(ConversationDB.closed_at == "")
                      .order_by(ConversationDB.updated_at.desc()).first())
        convo = existing or ConversationDB(
            requester=current_user.name, technician="",
            subject=body.subject.strip()[:120], created_at=now, updated_at=now,
            requester_read_at=now,
        )

    db.add(convo)
    db.flush()

    db.add(MessageDB(conversation_id=convo.id, sender=current_user.name,
                     body=body.body, created_at=now))
    convo.updated_at = now
    db.commit()
    db.refresh(convo)
    return _decorate(db, convo, current_user)


@app.get("/chat/conversations/{conversation_id}/messages",
         response_model=List[MessageOut])
def list_messages(conversation_id: int, after_id: int = Query(0, ge=0),
                  db: Session = Depends(get_db),
                  current_user: UserDB = Depends(get_current_user)):
    """Messages in a thread. `after_id` fetches only what's new, for polling.

    Paged by id rather than timestamp on purpose. Timestamps here have
    one-second granularity, so two messages sent in the same second are
    indistinguishable — a timestamp cursor would either repeat one or skip
    one. Ids are monotonic and unambiguous, and they survive a URL without
    encoding, which an ISO string with its "+00:00" offset does not.
    """
    convo = _get_conversation_or_404(db, conversation_id, current_user)

    q = db.query(MessageDB).filter(MessageDB.conversation_id == convo.id)
    if after_id:
        q = q.filter(MessageDB.id > after_id)
    rows = q.order_by(MessageDB.id).limit(500).all()

    # Opening a thread marks it read for this side.
    now = utc_now_iso()
    if _is_staff(current_user):
        convo.technician_read_at = now
    else:
        convo.requester_read_at = now
    db.commit()
    return rows


@app.post("/chat/conversations/{conversation_id}/messages",
          response_model=MessageOut, status_code=201)
def post_message(conversation_id: int, body: MessageIn,
                 db: Session = Depends(get_db),
                 current_user: UserDB = Depends(get_current_user)):
    """Send a message. A technician replying to an unclaimed thread takes it."""
    convo = _get_conversation_or_404(db, conversation_id, current_user)
    if str(convo.closed_at or ""):
        raise HTTPException(status_code=400, detail="This conversation is closed")

    now = utc_now_iso()

    # First staff reply claims the thread, so answering and claiming are the
    # same action — nobody has to remember to press a button first.
    if _is_staff(current_user) and not str(convo.technician or ""):
        convo.technician = current_user.name

    msg = MessageDB(conversation_id=convo.id, sender=current_user.name,
                    body=body.body, created_at=now)
    db.add(msg)
    convo.updated_at = now
    if _is_staff(current_user):
        convo.technician_read_at = now
    else:
        convo.requester_read_at = now
    db.commit()
    db.refresh(msg)
    return msg


@app.post("/chat/conversations/{conversation_id}/close",
          response_model=ConversationOut)
def close_conversation(conversation_id: int, db: Session = Depends(get_db),
                       current_user: UserDB = Depends(require_staff)):
    """End a thread. Staff only; the history stays readable."""
    convo = _get_conversation_or_404(db, conversation_id, current_user)
    convo.closed_at = utc_now_iso()
    db.commit()
    db.refresh(convo)
    return _decorate(db, convo, current_user)


@app.get("/chat/poll")
def chat_poll(db: Session = Depends(get_db),
              current_user: UserDB = Depends(get_current_user)):
    """One small request the widget can call on a timer.

    Returns just enough to drive the badge and the thread list, so an idle
    widget costs a single query rather than one per conversation.
    """
    rows = (_visible_conversations(db, current_user)
            .filter(ConversationDB.closed_at == "")
            .order_by(ConversationDB.updated_at.desc()).limit(100).all())

    conversations = [_decorate(db, c, current_user) for c in rows]
    waiting = sum(1 for c in rows if not str(c.technician or "")) \
        if _is_staff(current_user) else 0

    return {
        "unread": sum(c.unread for c in conversations),
        "waiting": waiting,
        "conversations": conversations,
    }


# ══════════════════════ Announcements ══════════════════════ #
#
# Exactly one announcement is pinned at a time. Rather than a flag that two
# rows could both hold, "pinned" is derived: the newest row with an empty
# retired_at. Posting a new one retires whatever was pinned, so the invariant
# is maintained at the one place that can break it.


def _pinned(db: Session) -> Optional[AnnouncementDB]:
    return (db.query(AnnouncementDB)
              .filter(AnnouncementDB.retired_at == "")
              .order_by(AnnouncementDB.created_at.desc(), AnnouncementDB.id.desc())
              .first())


def _retire_pinned(db: Session, when: str) -> None:
    """Retire every currently-pinned announcement.

    Written as "every" rather than "the one" deliberately: if a past bug or a
    hand-edited database ever left two unretired, this quietly repairs it
    instead of leaving a second notice to surface later.
    """
    for row in (db.query(AnnouncementDB)
                  .filter(AnnouncementDB.retired_at == "").all()):
        row.retired_at = when


@app.get("/announcements/current", response_model=Optional[AnnouncementOut])
def get_current_announcement(db: Session = Depends(get_db),
                             _: UserDB = Depends(get_current_user)):
    """The pinned announcement, or null. Everyone with an account can read it."""
    return _pinned(db)


@app.get("/announcements", response_model=List[AnnouncementOut])
def list_announcements(limit: int = Query(50, ge=1, le=200),
                       db: Session = Depends(get_db),
                       _: UserDB = Depends(get_current_user)):
    """Every announcement, newest first — the pinned one and the history."""
    return (db.query(AnnouncementDB)
              .order_by(AnnouncementDB.created_at.desc(), AnnouncementDB.id.desc())
              .limit(limit).all())


@app.post("/announcements", response_model=AnnouncementOut, status_code=201)
def create_announcement(body: AnnouncementIn, db: Session = Depends(get_db),
                        current_user: UserDB = Depends(require_staff)):
    """Post a new announcement, retiring whatever was pinned before it."""
    now = utc_now_iso()
    _retire_pinned(db, now)

    row = AnnouncementDB(
        title=body.title, body=body.body, level=body.level,
        author=current_user.name, created_at=now, updated_at=now,
        retired_at="",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # Tell everyone with an address. Sent in the background, one message per
    # person, so a slow mail provider never holds up this response and
    # nobody sees the rest of the user list.
    recipients = [u.email for u in db.query(UserDB).all() if str(u.email or "").strip()]
    heading = body.title or "New announcement"
    sent = send_bulk(
        subject=f"[Tech Help] {heading}",
        body=(
            f"{heading}\n\n{body.body}\n\n"
            f"— posted by {current_user.name}\n"
        ),
        recipients=recipients,
    )
    if sent:
        print(f"[announcement] emailing {sent} recipient(s)")

    return row


@app.put("/announcements/{announcement_id}", response_model=AnnouncementOut)
def update_announcement(announcement_id: int, body: AnnouncementIn,
                        db: Session = Depends(get_db),
                        _: UserDB = Depends(require_staff)):
    """Correct an announcement in place, without disturbing what is pinned.

    Editing is for fixing a typo or adding detail, so a retired announcement
    stays retired and a pinned one stays pinned.
    """
    row = db.query(AnnouncementDB).filter(
        AnnouncementDB.id == announcement_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Announcement not found")

    row.title = body.title
    row.body = body.body
    row.level = body.level
    row.updated_at = utc_now_iso()
    db.commit()
    db.refresh(row)
    return row


@app.post("/announcements/{announcement_id}/retire", response_model=AnnouncementOut)
def retire_announcement(announcement_id: int, db: Session = Depends(get_db),
                        _: UserDB = Depends(require_staff)):
    """Take an announcement off the dashboard, keeping it in the history."""
    row = db.query(AnnouncementDB).filter(
        AnnouncementDB.id == announcement_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Announcement not found")
    if str(row.retired_at or ""):
        raise HTTPException(status_code=400, detail="That announcement is already retired")

    row.retired_at = utc_now_iso()
    db.commit()
    db.refresh(row)
    return row


@app.delete("/announcements/{announcement_id}")
def delete_announcement(announcement_id: int, db: Session = Depends(get_db),
                        _: UserDB = Depends(require_admin)):
    """Remove an announcement from the history for good. Admin only."""
    row = db.query(AnnouncementDB).filter(
        AnnouncementDB.id == announcement_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Announcement not found")
    db.delete(row)
    db.commit()
    return {"ok": True, "deleted": announcement_id}


@app.get("/tickets/archive", response_model=List[TicketOut])
def list_archive(
    search: str = Query(""),
    category: str = Query("All"),
    date_from: str = Query("", description="YYYY-MM-DD, inclusive"),
    date_to: str = Query("", description="YYYY-MM-DD, inclusive"),
    technician: str = Query("All"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: UserDB = Depends(get_current_user),
):
    """Closed tickets, kept forever and searchable.

    This is the "didn't we fix this before?" tool, so it ranges over
    closed_at rather than updated_at: editing a closed ticket shouldn't
    move it in the timeline.
    """
    q = _live(db).filter(TicketDB.status == "Closed")

    if category != "All":
        q = q.filter(TicketDB.category == category)
    if technician != "All":
        q = q.filter(TicketDB.technician == technician)

    if date_from:
        # "2026-11-01" sorts before "2026-11-01T08:00:00", so a plain
        # string comparison is correct for the lower bound.
        q = q.filter(TicketDB.closed_at >= date_from)
    if date_to:
        # The upper bound must cover the whole day, so compare against the
        # start of the next one rather than truncating every row's timestamp.
        try:
            next_day = (
                datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
            ).date().isoformat()
            q = q.filter(TicketDB.closed_at < next_day)
        except ValueError:
            raise HTTPException(status_code=400, detail="date_to must be YYYY-MM-DD")

    tickets = q.order_by(TicketDB.closed_at.desc()).limit(limit).all()

    term = search.strip().lower()
    if term:
        tickets = [
            t for t in tickets
            if term in f"{t.title} {t.description} {t.requester} "
                       f"{t.technician} {t.category}".lower()
        ]
    return tickets


@app.get("/tickets/trash", response_model=List[TicketOut])
def list_trash(db: Session = Depends(get_db),
               current_user: UserDB = Depends(get_current_user)):
    """Soft-deleted tickets, newest first.

    Purges anything past its retention window first, so the promise that
    trash empties itself holds without depending on a scheduled job.
    """
    if current_user.role == "Requester":
        raise HTTPException(
            status_code=403, detail="Only technicians and admins can view the trash"
        )
    _purge_expired(db)
    return _deleted(db).order_by(TicketDB.deleted_at.desc()).all()


@app.post("/tickets/{ticket_id}/restore", response_model=TicketOut)
def restore_ticket(ticket_id: int, db: Session = Depends(get_db),
                   current_user: UserDB = Depends(get_current_user)):
    """Take a ticket out of the trash, with its comments and attachments."""
    if current_user.role == "Requester":
        raise HTTPException(status_code=403, detail="Requesters cannot restore tickets")

    ticket = _get_ticket_or_404(db, ticket_id, include_deleted=True)
    if not str(ticket.deleted_at or ""):
        raise HTTPException(status_code=400, detail="That ticket is not in the trash")

    now = utc_now_iso()
    ticket.deleted_at = ""
    ticket.deleted_by = ""
    ticket.updated_at = now
    ticket.history = (ticket.history or []) + [
        f"[{now}] Restored from trash by {current_user.name}"
    ]
    db.commit()
    db.refresh(ticket)
    return ticket


@app.delete("/tickets/{ticket_id}/permanent")
def delete_ticket_permanently(ticket_id: int, db: Session = Depends(get_db),
                              current_user: UserDB = Depends(require_admin)):
    """Remove a ticket for real. Admin only, and irreversible.

    Only reachable for tickets already in the trash, so a single mis-click
    can never destroy a live ticket.
    """
    ticket = _get_ticket_or_404(db, ticket_id, include_deleted=True)
    if not str(ticket.deleted_at or ""):
        raise HTTPException(
            status_code=400,
            detail="Move the ticket to the trash before deleting it permanently",
        )
    title = str(ticket.title)
    _hard_delete(db, ticket)
    db.commit()
    return {"ok": True, "deleted": title}


@app.post("/tickets/purge-deleted")
def purge_deleted(db: Session = Depends(get_db),
                  _: UserDB = Depends(require_admin)):
    """Empty everything past its retention window. Admin only."""
    count = _purge_expired(db)
    return {"ok": True, "purged": count, "retention_days": TRASH_RETENTION_DAYS}


@app.get("/tickets", response_model=List[TicketOut])
def list_tickets(search: str = Query(""), status_filter: str = Query("All"),
                 priority_filter: str = Query("All"), view: str = Query("All Tickets"),
                 db: Session = Depends(get_db), current_user: UserDB = Depends(get_current_user)):
    return _apply_filters(_live(db).all(), search, status_filter,
                          priority_filter, view, current_user.name.lower())


@app.post("/tickets", response_model=TicketOut, status_code=201)
def create_ticket(body: TicketCreate, db: Session = Depends(get_db),
                  current_user: UserDB = Depends(get_current_user)):
    if current_user.role == "Requester" and body.status == "Closed":
        raise HTTPException(status_code=403, detail="Requesters cannot close tickets")

    now = utc_now_iso()
    history = [f"[{now}] Created by {current_user.name} (role: {current_user.role})"]
    if body.survey:
        history.append(f"[{now}] Intake survey completed ({len(body.survey)} answers)")

    ticket = TicketDB(
        title=body.title, description=body.description, status=body.status,
        priority=body.priority, created_at=now, updated_at=now,
        requester=body.requester, technician=body.technician, due_date=body.due_date,
        category=body.category, survey=body.survey or {}, history=history,
        ref=generate_ticket_ref(db),
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    send_notification(
        subject=f"New ticket {fmt_id(ticket)}: {body.title}",
        body=(f"New IT ticket created.\n\nID: {fmt_id(ticket)}\nTitle: {body.title}\n"
              f"Category: {body.category or 'Uncategorised'}\n"
              f"Requester: {body.requester}\nPriority: {body.priority}\n"
              f"Status: {body.status}\nTechnician: {body.technician or 'Unassigned'}\n"
              f"Due: {body.due_date or 'Not set'}\n\nDescription:\n{body.description}"),
        to=_emails_for(db, body.requester, body.technician),
    )
    return ticket


@app.get("/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(ticket_id: int, db: Session = Depends(get_db),
               _: UserDB = Depends(get_current_user)):
    return _get_ticket_or_404(db, ticket_id)


@app.put("/tickets/{ticket_id}", response_model=TicketOut)
def update_ticket(ticket_id: int, body: TicketUpdate, db: Session = Depends(get_db),
                  current_user: UserDB = Depends(get_current_user)):
    ticket = _get_ticket_or_404(db, ticket_id)
    if current_user.role == "Requester" and body.status == "Closed":
        raise HTTPException(status_code=403, detail="Requesters cannot close tickets")

    requester = body.requester
    if current_user.role == "Technician" and body.requester != ticket.requester:
        requester = ticket.requester

    changes = []
    if body.title != ticket.title:
        changes.append(f"Title: '{ticket.title}' -> '{body.title}'")
    if body.status != ticket.status:
        changes.append(f"Status: {ticket.status} -> {body.status}")
    if body.priority != ticket.priority:
        changes.append(f"Priority: {ticket.priority} -> {body.priority}")
    if body.technician != ticket.technician:
        changes.append(f"Technician: '{ticket.technician or 'Unassigned'}' -> "
                       f"'{body.technician or 'Unassigned'}'")
    if body.due_date != (ticket.due_date or ""):
        changes.append(f"Due date: '{ticket.due_date or 'none'}' -> '{body.due_date or 'none'}'")
    if body.category != (ticket.category or ""):
        changes.append(f"Category: '{ticket.category or 'none'}' -> '{body.category or 'none'}'")
    if body.description != ticket.description:
        changes.append("Description updated")
    if body.survey != (ticket.survey or {}):
        changes.append("Survey answers updated")

    now = utc_now_iso()
    summary = "; ".join(changes) if changes else "no field changes"
    old_status = ticket.status

    ticket.title       = body.title
    ticket.description = body.description
    ticket.requester   = requester
    ticket.technician  = body.technician
    ticket.priority    = body.priority
    ticket.status      = body.status
    if body.status != old_status:
        ticket.closed_at = now if body.status == "Closed" else ""
    ticket.due_date    = body.due_date
    ticket.category    = body.category
    ticket.survey      = body.survey or {}
    ticket.updated_at  = now
    ticket.history     = (ticket.history or []) + [
        f"[{now}] Updated by {current_user.name} (role: {current_user.role}): {summary}"
    ]
    db.commit()
    db.refresh(ticket)

    if body.status != old_status:
        send_notification(
            subject=f"Ticket {fmt_id(ticket)} status: {old_status} -> {body.status}",
            body=(f"Ticket status changed.\n\nID: {fmt_id(ticket)}\nTitle: {body.title}\n"
                  f"Status: {old_status} -> {body.status}\nUpdated by: {current_user.name}\n"),
            to=_emails_for(db, ticket.requester, ticket.technician),
        )
    return ticket


@app.post("/tickets/{ticket_id}/claim", response_model=TicketOut)
def claim_ticket(ticket_id: int, db: Session = Depends(get_db),
                 current_user: UserDB = Depends(get_current_user)):
    """Assign an unclaimed ticket to yourself in one click.

    Saves a technician from opening the ticket, typing their own name into a
    free-text box, and hitting save.
    """
    if current_user.role == "Requester":
        raise HTTPException(status_code=403, detail="Only technicians can claim tickets")

    ticket = _get_ticket_or_404(db, ticket_id)
    if (ticket.technician or "").strip():
        if ticket.technician == current_user.name:
            return ticket
        raise HTTPException(
            status_code=409,
            detail=f"Already assigned to {ticket.technician}",
        )

    now = utc_now_iso()
    ticket.technician = current_user.name
    ticket.updated_at = now
    ticket.history = (ticket.history or []) + [
        f"[{now}] Claimed by {current_user.name}"
    ]
    if ticket.status == "Open":
        ticket.status = "In Progress"
        ticket.history = ticket.history + [
            f"[{now}] Status: Open -> In Progress (auto, on claim)"
        ]

    db.commit()
    db.refresh(ticket)

    send_notification(
        subject=f"Ticket {fmt_id(ticket)} claimed by {current_user.name}",
        body=(f"{current_user.name} has picked up your ticket.\n\n"
              f"ID: {fmt_id(ticket)}\nTitle: {ticket.title}\n"
              f"Status: {ticket.status}\n"),
        to=_emails_for(db, ticket.requester),
    )
    return ticket


@app.patch("/tickets/{ticket_id}/status", response_model=TicketOut)
def quick_set_status(ticket_id: int, body: TicketStatusUpdate,
                     db: Session = Depends(get_db),
                     current_user: UserDB = Depends(get_current_user)):
    """Change just the status, without sending the whole ticket back.

    Lets the list view offer one-click status changes.
    """
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Status must be one of: {', '.join(VALID_STATUSES)}",
        )
    if current_user.role == "Requester" and body.status == "Closed":
        raise HTTPException(status_code=403, detail="Requesters cannot close tickets")

    ticket = _get_ticket_or_404(db, ticket_id)
    old = ticket.status
    if old == body.status:
        return ticket

    now = utc_now_iso()
    ticket.status = body.status
    ticket.updated_at = now
    # Stamp when the work finished; clear it if the ticket is reopened, so a
    # reopened ticket returns to the live queue instead of staying archived.
    ticket.closed_at = now if body.status == "Closed" else ""
    ticket.history = (ticket.history or []) + [
        f"[{now}] Status: {old} -> {body.status} (by {current_user.name})"
    ]
    db.commit()
    db.refresh(ticket)

    send_notification(
        subject=f"Ticket {fmt_id(ticket)} status: {old} -> {body.status}",
        body=(f"Ticket status changed.\n\nID: {fmt_id(ticket)}\n"
              f"Title: {ticket.title}\nStatus: {old} -> {body.status}\n"
              f"Updated by: {current_user.name}\n"),
        to=_emails_for(db, ticket.requester, ticket.technician),
    )
    return ticket


@app.delete("/tickets/{ticket_id}")
def delete_ticket(ticket_id: int, db: Session = Depends(get_db),
                  current_user: UserDB = Depends(get_current_user)):
    """Move a ticket to the trash.

    This is a soft delete: the row stays, along with its comments and
    attachments, so a restore brings everything back intact. Rows are removed
    for real by the purge, TRASH_RETENTION_DAYS later.
    """
    if current_user.role == "Requester":
        raise HTTPException(status_code=403, detail="Requesters cannot delete tickets")
    ticket = _get_ticket_or_404(db, ticket_id)

    now = utc_now_iso()
    ticket.deleted_at = now
    ticket.deleted_by = current_user.name
    ticket.updated_at = now
    ticket.history = (ticket.history or []) + [
        f"[{now}] Moved to trash by {current_user.name}"
    ]
    db.commit()
    return {
        "ok": True,
        "deleted_at": now,
        "restorable_until": (
            utc_now() + timedelta(days=TRASH_RETENTION_DAYS)
        ).isoformat(timespec="seconds"),
        "retention_days": TRASH_RETENTION_DAYS,
    }


# ═══════════════════════════ COMMENTS ═══════════════════════════ #

@app.get("/tickets/{ticket_id}/comments", response_model=List[CommentOut])
def list_comments(ticket_id: int, db: Session = Depends(get_db),
                  _: UserDB = Depends(get_current_user)):
    _get_ticket_or_404(db, ticket_id)
    return (db.query(CommentDB)
              .filter(CommentDB.ticket_id == ticket_id)
              .order_by(CommentDB.id.asc())
              .all())


@app.post("/tickets/{ticket_id}/comments", response_model=CommentOut, status_code=201)
def add_comment(ticket_id: int, body: CommentCreate, db: Session = Depends(get_db),
                current_user: UserDB = Depends(get_current_user)):
    ticket = _get_ticket_or_404(db, ticket_id)
    if not body.body.strip():
        raise HTTPException(status_code=400, detail="Comment cannot be empty")

    now = utc_now_iso()
    comment = CommentDB(
        ticket_id=ticket_id, author=current_user.name, author_role=current_user.role,
        body=body.body.strip(), created_at=now,
    )
    db.add(comment)

    ticket.updated_at = now
    ticket.history = (ticket.history or []) + [f"[{now}] Comment added by {current_user.name}"]

    db.commit()
    db.refresh(comment)

    # Notify the other party — no point emailing someone their own comment
    others = [
        n for n in (ticket.requester, ticket.technician)
        if n and n != current_user.name
    ]
    send_notification(
        subject=f"New comment on {fmt_id(ticket)}: {ticket.title}",
        body=(f"{current_user.name} commented on ticket {fmt_id(ticket)}.\n\n"
              f"{body.body.strip()}"),
        to=_emails_for(db, *others),
    )
    return comment


@app.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, db: Session = Depends(get_db),
                   current_user: UserDB = Depends(get_current_user)):
    comment = db.query(CommentDB).filter(CommentDB.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.author != current_user.name and current_user.role != "Both":
        raise HTTPException(status_code=403, detail="You can only delete your own comments")
    db.delete(comment)
    db.commit()
    return {"ok": True}


# ═══════════════════════════ ATTACHMENTS ═══════════════════════════ #

@app.get("/tickets/{ticket_id}/attachments", response_model=List[AttachmentOut])
def list_attachments(ticket_id: int, db: Session = Depends(get_db),
                     _: UserDB = Depends(get_current_user)):
    _get_ticket_or_404(db, ticket_id)
    return (db.query(AttachmentDB)
              .filter(AttachmentDB.ticket_id == ticket_id)
              .order_by(AttachmentDB.id.asc())
              .all())


@app.post("/tickets/{ticket_id}/attachments", response_model=AttachmentOut, status_code=201)
def upload_attachment(ticket_id: int, file: UploadFile = File(...),
                      db: Session = Depends(get_db),
                      current_user: UserDB = Depends(get_current_user)):
    ticket = _get_ticket_or_404(db, ticket_id)

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{ext or 'unknown'}' is not allowed",
        )

    stored_name = f"{uuid.uuid4().hex}{ext}"
    limit_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
    size = 0

    if STORE_UPLOADS_IN_DB:
        # Accumulate in memory, then persist as a BLOB. Bounded by the same
        # size limit, so a single request can't balloon past it.
        buf = io.BytesIO()
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds the {limit_mb} MB limit",
                )
            buf.write(chunk)
        blob = buf.getvalue()
    else:
        blob = None
        dest = os.path.join(UPLOAD_DIR, stored_name)
        with open(dest, "wb") as out:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    out.close()
                    os.remove(dest)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds the {limit_mb} MB limit",
                    )
                out.write(chunk)

    now = utc_now_iso()
    att = AttachmentDB(
        ticket_id=ticket_id, filename=file.filename or stored_name,
        stored_name=stored_name, content_type=file.content_type or "",
        size=size, uploaded_by=current_user.name, uploaded_at=now,
        data=blob,
    )
    db.add(att)

    ticket.updated_at = now
    ticket.history = (ticket.history or []) + [
        f"[{now}] Attachment '{file.filename}' uploaded by {current_user.name}"
    ]

    db.commit()
    db.refresh(att)
    return att


@app.get("/attachments/{attachment_id}")
def download_attachment(attachment_id: int, db: Session = Depends(get_db),
                        _: UserDB = Depends(get_current_user)):
    att = db.query(AttachmentDB).filter(AttachmentDB.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    media = str(att.content_type or "application/octet-stream")
    disposition = f'attachment; filename="{att.filename}"'

    # Bytes in the database take precedence; rows written before
    # STORE_UPLOADS_IN_DB was enabled still point at a file on disk.
    if att.data is not None:
        return Response(
            content=att.data,
            media_type=media,
            headers={"Content-Disposition": disposition},
        )

    path = os.path.join(UPLOAD_DIR, str(att.stored_name))
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File missing from disk")
    return FileResponse(path, filename=str(att.filename), media_type=media)


@app.delete("/attachments/{attachment_id}")
def delete_attachment(attachment_id: int, db: Session = Depends(get_db),
                      current_user: UserDB = Depends(get_current_user)):
    att = db.query(AttachmentDB).filter(AttachmentDB.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if att.uploaded_by != current_user.name and current_user.role == "Requester":
        raise HTTPException(status_code=403, detail="You can only delete your own uploads")
    if att.data is None:
        path = os.path.join(UPLOAD_DIR, str(att.stored_name))
        if os.path.exists(path):
            os.remove(path)
    db.delete(att)
    db.commit()
    return {"ok": True}


# ── Deferred startup work ───────────────────────────────────────── #
#
# This runs here rather than beside migrate() at the top because it depends
# on helpers defined further down the file. migrate() adds the ref column;
# this fills it in for tickets that predate it.

with SessionLocal() as _db:
    _backfilled = backfill_ticket_refs(_db)
    if _backfilled:
        print(f"  backfilled {_backfilled} ticket reference(s)")