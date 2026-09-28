import csv
import io
import os
import re
import secrets
import shutil
import uuid
from datetime import datetime, timedelta
from typing import List

from fastapi import (
    Depends, FastAPI, File, HTTPException, Query, UploadFile, status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES, LOCKOUT_MINUTES, clear_failed_logins,
    create_access_token, get_current_user, hash_password, is_locked_out,
    register_failed_login, require_admin, utc_now, utc_now_iso, verify_password,
)
from database import Base, engine, get_db, migrate
from email_utils import send_notification
from models import (
    ArticleCreate, ArticleDB, ArticleOut,
    AttachmentDB, AttachmentOut,
    CommentCreate, CommentDB, CommentOut,
    VALID_STATUSES,
    TicketCreate, TicketDB, TicketOut, TicketStatusUpdate, TicketUpdate,
    InviteCodeDB, InviteCreate, InviteOut, InviteRedeem,
    UserCreate, UserDB, UserEmailUpdate, UserOut, UserPasswordReset, UserRoleUpdate,
)
from seed_articles import SEED_ARTICLES

# ── Startup ─────────────────────────────────────────────────────── #

Base.metadata.create_all(bind=engine)
migrate()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
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

app = FastAPI(title="IT Ticket System API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ─────────────────────────────────────────────────────── #

def fmt_id(ticket_id: int) -> str:
    return f"TKT-{ticket_id:03d}"


def _apply_filters(tickets, search, status_filter, priority_filter, view, current_name):
    query = search.strip().lower()
    result = []
    for t in tickets:
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


def _get_ticket_or_404(db: Session, ticket_id: int) -> TicketDB:
    ticket = db.query(TicketDB).filter(TicketDB.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


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

    token = create_access_token(
        {"sub": user.name, "role": user.role},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": token, "token_type": "bearer", "role": user.role, "name": user.name}


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
    assigned = db.query(TicketDB).filter(TicketDB.technician == user.name).all()
    for t in assigned:
        t.technician = ""
        t.updated_at = now
        t.history = (t.history or []) + [
            f"[{now}] Unassigned automatically: user '{user.name}' was deleted"
        ]

    requested_count = db.query(TicketDB).filter(TicketDB.requester == user.name).count()

    db.delete(user)
    db.commit()
    return {
        "ok": True,
        "unassigned_tickets": len(assigned),
        "requested_tickets_kept": requested_count,
    }


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
    tickets = db.query(TicketDB).all()
    today   = utc_now_iso()[:10]

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
        "by_status":   by_status,
        "by_priority": by_priority,
        "by_category": by_category,
        "overdue":     overdue,
        "recent": [
            {
                "id": t.id, "title": t.title, "status": t.status,
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
    tickets = _apply_filters(db.query(TicketDB).all(), search, status_filter,
                             priority_filter, view, current_user.name.lower())
    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(["id", "title", "description", "status", "priority", "category",
                "created_at", "updated_at", "requester", "technician", "due_date",
                "survey", "history"])
    for t in tickets:
        survey_txt = "; ".join(f"{k}: {v}" for k, v in (t.survey or {}).items() if v)
        w.writerow([fmt_id(t.id), t.title, t.description, t.status, t.priority,
                    t.category or "", t.created_at, t.updated_at, t.requester,
                    t.technician, t.due_date, survey_txt, " | ".join(t.history or [])])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=tickets.csv"})


@app.get("/tickets", response_model=List[TicketOut])
def list_tickets(search: str = Query(""), status_filter: str = Query("All"),
                 priority_filter: str = Query("All"), view: str = Query("All Tickets"),
                 db: Session = Depends(get_db), current_user: UserDB = Depends(get_current_user)):
    return _apply_filters(db.query(TicketDB).all(), search, status_filter,
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
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    send_notification(
        subject=f"New ticket {fmt_id(ticket.id)}: {body.title}",
        body=(f"New IT ticket created.\n\nID: {fmt_id(ticket.id)}\nTitle: {body.title}\n"
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
            subject=f"Ticket {fmt_id(ticket_id)} status: {old_status} -> {body.status}",
            body=(f"Ticket status changed.\n\nID: {fmt_id(ticket_id)}\nTitle: {body.title}\n"
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
        subject=f"Ticket {fmt_id(ticket_id)} claimed by {current_user.name}",
        body=(f"{current_user.name} has picked up your ticket.\n\n"
              f"ID: {fmt_id(ticket_id)}\nTitle: {ticket.title}\n"
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
    ticket.history = (ticket.history or []) + [
        f"[{now}] Status: {old} -> {body.status} (by {current_user.name})"
    ]
    db.commit()
    db.refresh(ticket)

    send_notification(
        subject=f"Ticket {fmt_id(ticket_id)} status: {old} -> {body.status}",
        body=(f"Ticket status changed.\n\nID: {fmt_id(ticket_id)}\n"
              f"Title: {ticket.title}\nStatus: {old} -> {body.status}\n"
              f"Updated by: {current_user.name}\n"),
        to=_emails_for(db, ticket.requester, ticket.technician),
    )
    return ticket


@app.delete("/tickets/{ticket_id}")
def delete_ticket(ticket_id: int, db: Session = Depends(get_db),
                  current_user: UserDB = Depends(get_current_user)):
    if current_user.role == "Requester":
        raise HTTPException(status_code=403, detail="Requesters cannot delete tickets")
    ticket = _get_ticket_or_404(db, ticket_id)

    # Clean up attachments on disk before removing rows
    for att in db.query(AttachmentDB).filter(AttachmentDB.ticket_id == ticket_id).all():
        path = os.path.join(UPLOAD_DIR, att.stored_name)
        if os.path.exists(path):
            os.remove(path)
        db.delete(att)
    for c in db.query(CommentDB).filter(CommentDB.ticket_id == ticket_id).all():
        db.delete(c)

    db.delete(ticket)
    db.commit()
    return {"ok": True}


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
        subject=f"New comment on {fmt_id(ticket_id)}: {ticket.title}",
        body=(f"{current_user.name} commented on ticket {fmt_id(ticket_id)}.\n\n"
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
    dest = os.path.join(UPLOAD_DIR, stored_name)

    size = 0
    with open(dest, "wb") as out:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                out.close()
                os.remove(dest)
                raise HTTPException(status_code=413, detail="File exceeds the 10 MB limit")
            out.write(chunk)

    now = utc_now_iso()
    att = AttachmentDB(
        ticket_id=ticket_id, filename=file.filename or stored_name,
        stored_name=stored_name, content_type=file.content_type or "",
        size=size, uploaded_by=current_user.name, uploaded_at=now,
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
    path = os.path.join(UPLOAD_DIR, att.stored_name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File missing from disk")
    return FileResponse(path, filename=att.filename,
                        media_type=att.content_type or "application/octet-stream")


@app.delete("/attachments/{attachment_id}")
def delete_attachment(attachment_id: int, db: Session = Depends(get_db),
                      current_user: UserDB = Depends(get_current_user)):
    att = db.query(AttachmentDB).filter(AttachmentDB.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if att.uploaded_by != current_user.name and current_user.role == "Requester":
        raise HTTPException(status_code=403, detail="You can only delete your own uploads")
    path = os.path.join(UPLOAD_DIR, att.stored_name)
    if os.path.exists(path):
        os.remove(path)
    db.delete(att)
    db.commit()
    return {"ok": True}