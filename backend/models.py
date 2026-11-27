import re
from typing import List, Optional, Dict, Any

from pydantic import BaseModel, field_validator
from sqlalchemy import ForeignKey, Integer, JSON, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base

# ══════════════════════ Validation rules ══════════════════════ #

VALID_ROLES = ("Requester", "Technician", "Both")
VALID_STATUSES = ("Open", "In Progress", "Closed")
MIN_PASSWORD_LENGTH = 8
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_password(value: str) -> str:
    if value is None or len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"
        )
    if value.strip() == "":
        raise ValueError("Password cannot be blank")
    return value


def validate_username(value: str) -> str:
    value = (value or "").strip()
    if len(value) < 2:
        raise ValueError("Name must be at least 2 characters long")
    if len(value) > 60:
        raise ValueError("Name must be 60 characters or fewer")
    return value


def validate_email(value: str) -> str:
    value = (value or "").strip().lower()
    if not _EMAIL_RE.match(value):
        raise ValueError("Enter a valid email address")
    return value


# ══════════════════════ ORM models ══════════════════════ #
#
# These use SQLAlchemy 2.0's Mapped[] / mapped_column() style rather than the
# older bare Column() assignments.
#
# WHY: with plain `name = Column(String)`, a type checker sees the attribute as
# `Column[str]` instead of `str`. That made Pylance flag roughly 75 false
# errors — "Column[str] is not assignable to str" on every read, and
# "cannot assign to attribute" on every write — even though the code runs
# perfectly, because SQLAlchemy swaps in the real value at runtime.
#
# Mapped[str] tells the checker what the attribute actually is. The database
# schema produced is identical, so no migration is needed.


class UserDB(Base):
    __tablename__ = "users"

    id:            Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name:          Mapped[str] = mapped_column(String, unique=True, index=True)
    email:         Mapped[str] = mapped_column(String, default="")
    role:          Mapped[str] = mapped_column(String, default="Requester")
    password_hash: Mapped[str] = mapped_column(String)
    created_at:    Mapped[str] = mapped_column(String, default="")

    # Set when someone signs up asking to be a Technician. Their actual role
    # stays "Requester" until an admin issues a code and they redeem it.
    requested_role: Mapped[str] = mapped_column(String, default="")

    # Brute-force protection
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until:  Mapped[str] = mapped_column(String, default="")

    # ── Email verification ──
    # Timestamp of the last successful verification; empty means never.
    email_verified_at: Mapped[str] = mapped_column(String, default="")
    # SHA-256 of the current 6-digit code, never the code itself.
    verify_code_hash:  Mapped[str] = mapped_column(String, default="")
    verify_expires_at: Mapped[str] = mapped_column(String, default="")
    verify_attempts:   Mapped[int] = mapped_column(Integer, default=0)
    # Drives the "hasn't signed in for 30+ days" re-check.
    last_login:        Mapped[str] = mapped_column(String, default="")

    # ── Terms of service ──
    # The TERMS_VERSION this account has accepted. Empty means never, which
    # is also what every pre-existing row migrates to — so bumping the
    # version and adding the column have the same effect: everyone is asked
    # again on their next request.
    terms_version:     Mapped[str] = mapped_column(String, default="")
    terms_accepted_at: Mapped[str] = mapped_column(String, default="")


class TicketDB(Base):
    __tablename__ = "tickets"

    id:          Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title:       Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text, default="")
    status:      Mapped[str] = mapped_column(String, default="Open")
    priority:    Mapped[str] = mapped_column(String, default="Medium")
    created_at:  Mapped[str] = mapped_column(String, default="")
    updated_at:  Mapped[str] = mapped_column(String, default="")
    requester:   Mapped[str] = mapped_column(String, default="")
    technician:  Mapped[str] = mapped_column(String, default="")
    due_date:    Mapped[str] = mapped_column(String, default="")
    category:    Mapped[str] = mapped_column(String, default="")

    # ── Archive / trash ──
    #
    # Human-facing reference, e.g. "TK-AC43". Separate from the primary key
    # because people read these aloud and quote them in email, and a
    # sequential id leaks how many tickets exist.
    ref: Mapped[str] = mapped_column(String, default="", index=True)

    # closed_at is deliberately NOT updated_at: editing a closed ticket moves
    # updated_at, but the archive needs to know when the work was actually
    # finished, because that is what the date filter ranges over.
    # Cleared if a ticket is reopened.
    closed_at: Mapped[str] = mapped_column(String, default="", index=True)

    # Soft delete. Empty string means live — matching the convention used by
    # locked_until and requested_role, which avoids the NULL-comparison
    # differences between SQLite and Postgres.
    #
    # IMPORTANT: every list query must exclude these. Go through _live() in
    # main.py rather than querying TicketDB directly.
    deleted_at: Mapped[str] = mapped_column(String, default="", index=True)
    deleted_by: Mapped[str] = mapped_column(String, default="")

    # JSON columns are Optional because rows created before these existed
    # can hold NULL. Reading code guards with `or []` / `or {}`.
    history: Mapped[Optional[List[str]]]      = mapped_column(JSON, default=list)
    survey:  Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, default=dict)


class CommentDB(Base):
    __tablename__ = "comments"

    id:          Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticket_id:   Mapped[int] = mapped_column(Integer, ForeignKey("tickets.id"), index=True)
    author:      Mapped[str] = mapped_column(String)
    author_role: Mapped[str] = mapped_column(String, default="")
    body:        Mapped[str] = mapped_column(Text)
    created_at:  Mapped[str] = mapped_column(String, default="")


class ConversationDB(Base):
    """A live chat thread between one requester and the helpdesk.

    Conversations start unclaimed and sit in a queue; the first technician to
    answer owns it. The technician column doubles as the claim marker, so
    there is no separate state to keep in sync with it.
    """

    __tablename__ = "conversations"

    id:         Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # "helpdesk" — opened by a requester, unclaimed, any technician may take
    # it. "direct" — between two named people of any role.
    kind:       Mapped[str] = mapped_column(String, default="helpdesk", index=True)

    # These two hold the participants. The names date from when every thread
    # was requester-to-helpdesk; in a direct thread `requester` is whoever
    # opened it and `technician` is the other person, whatever their roles.
    # Code reads them through _participants() rather than by name, so the
    # misnomer stays in one place.
    requester:  Mapped[str] = mapped_column(String, index=True)
    # Empty on a helpdesk thread until a technician picks it up.
    technician: Mapped[str] = mapped_column(String, default="", index=True)
    subject:    Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[str] = mapped_column(String, default="")
    # Bumped on every message, so "most recent activity" sorts without a join.
    updated_at: Mapped[str] = mapped_column(String, default="", index=True)
    closed_at:  Mapped[str] = mapped_column(String, default="", index=True)

    # Read markers, one per *position* rather than per role: two technicians
    # talking are both staff, so keying these off role would give them a
    # single shared marker and break both their unread counts.
    requester_read_at:  Mapped[str] = mapped_column(String, default="")
    technician_read_at: Mapped[str] = mapped_column(String, default="")


class MessageDB(Base):
    __tablename__ = "messages"

    id:              Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    conversation_id: Mapped[int] = mapped_column(Integer, index=True)
    sender:          Mapped[str] = mapped_column(String)
    body:            Mapped[str] = mapped_column(Text)
    created_at:      Mapped[str] = mapped_column(String, default="", index=True)


class AnnouncementDB(Base):
    """A notice from the helpdesk to everyone with an account.

    Exactly one announcement is pinned to the dashboard at a time: the most
    recent row whose retired_at is empty. Posting a new one retires the
    previous, so the pinned slot can never hold two. Retired rows stay as
    history rather than being deleted, so "what did they say about the
    migration last month?" is still answerable.
    """

    __tablename__ = "announcements"

    id:         Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title:      Mapped[str] = mapped_column(String, default="")
    body:       Mapped[str] = mapped_column(Text)
    # info | warning | critical — drives the banner's colour, nothing else.
    level:      Mapped[str] = mapped_column(String, default="info")
    author:     Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default="", index=True)
    updated_at: Mapped[str] = mapped_column(String, default="")
    # Empty means this is the pinned one. Non-empty is history.
    retired_at: Mapped[str] = mapped_column(String, default="", index=True)


class AttachmentDB(Base):
    __tablename__ = "attachments"

    id:           Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticket_id:    Mapped[int] = mapped_column(Integer, ForeignKey("tickets.id"), index=True)
    filename:     Mapped[str] = mapped_column(String)
    stored_name:  Mapped[str] = mapped_column(String)
    content_type: Mapped[str] = mapped_column(String, default="")
    size:         Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by:  Mapped[str] = mapped_column(String, default="")
    uploaded_at:  Mapped[str] = mapped_column(String, default="")

    # File bytes, used when STORE_UPLOADS_IN_DB is enabled. Hosts like
    # Render's free tier have no persistent disk, so anything written to
    # backend/uploads/ disappears on the next restart. Keeping the bytes in
    # the database is the simplest way to make uploads survive a deploy
    # without adding an object-storage dependency.
    #
    # When storing on disk (the default), this stays NULL and stored_name
    # points at the file.
    data: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True, default=None)


class InviteCodeDB(Base):
    """A one-time code that upgrades whoever redeems it to a given role.

    Issued by an admin and delivered out of band (QR code, message, in person).
    The role only takes effect when the recipient redeems it, so possession of
    the code is the proof of authorisation.
    """
    __tablename__ = "invite_codes"

    id:           Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code:         Mapped[str] = mapped_column(String, unique=True, index=True)
    role:         Mapped[str] = mapped_column(String, default="Technician")
    note:         Mapped[str] = mapped_column(String, default="")
    created_by:   Mapped[str] = mapped_column(String, default="")
    created_at:   Mapped[str] = mapped_column(String, default="")
    expires_at:   Mapped[str] = mapped_column(String, default="")
    max_uses:     Mapped[int] = mapped_column(Integer, default=1)
    uses:         Mapped[int] = mapped_column(Integer, default=0)
    revoked:      Mapped[int] = mapped_column(Integer, default=0)  # SQLite has no bool

    # Optional: ties the code to the account that requested the upgrade
    target_user:  Mapped[str] = mapped_column(String, default="")
    last_used_by: Mapped[str] = mapped_column(String, default="")
    last_used_at: Mapped[str] = mapped_column(String, default="")


class ArticleDB(Base):
    __tablename__ = "articles"

    id:         Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title:      Mapped[str] = mapped_column(String)
    category:   Mapped[str] = mapped_column(String, default="")
    summary:    Mapped[str] = mapped_column(Text, default="")
    body:       Mapped[str] = mapped_column(Text, default="")
    keywords:   Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[str] = mapped_column(String, default="")
    updated_at: Mapped[str] = mapped_column(String, default="")


# ══════════════════════ Pydantic schemas ══════════════════════ #

# ── Users ── #

class UserCreate(BaseModel):
    """Self-service signup.

    Note there is deliberately NO role field. Roles are assigned by an admin
    after the fact — otherwise anyone could sign themselves up as "Both" and
    gain admin powers. The only exception is the very first account created
    on a fresh install, which the server promotes to admin so the system is
    usable at all.
    """
    name: str
    email: str
    password: str
    # A request, not a grant. The server always creates the account as a
    # Requester; this only records what they asked for so an admin can see it.
    requested_role: str = ""

    @field_validator("requested_role")
    @classmethod
    def _check_requested(cls, v: str) -> str:
        return v if v == "Technician" else ""

    _v_name  = field_validator("name")(validate_username)
    _v_email = field_validator("email")(validate_email)
    _v_pass  = field_validator("password")(validate_password)


class InviteCreate(BaseModel):
    role: str = "Technician"
    note: str = ""
    expires_days: int = 14
    max_uses: int = 1
    target_user: str = ""

    @field_validator("role")
    @classmethod
    def _check_role(cls, v: str) -> str:
        # Requester is the default for everyone, so a code for it is pointless
        if v not in ("Technician", "Both"):
            raise ValueError("Invite role must be Technician or Both")
        return v

    @field_validator("expires_days")
    @classmethod
    def _check_expiry(cls, v: int) -> int:
        if not 1 <= v <= 365:
            raise ValueError("Expiry must be between 1 and 365 days")
        return v

    @field_validator("max_uses")
    @classmethod
    def _check_uses(cls, v: int) -> int:
        if not 1 <= v <= 50:
            raise ValueError("Max uses must be between 1 and 50")
        return v


class InviteRedeem(BaseModel):
    code: str


class InviteOut(BaseModel):
    id: int
    code: str
    role: str
    note: str
    created_by: str
    created_at: str
    expires_at: str
    max_uses: int
    uses: int
    revoked: int
    target_user: str
    last_used_by: str
    last_used_at: str

    class Config:
        from_attributes = True


class UserPasswordReset(BaseModel):
    password: str

    _v_pass = field_validator("password")(validate_password)


class UserEmailUpdate(BaseModel):
    email: str

    _v_email = field_validator("email")(validate_email)


MAX_MESSAGE_LENGTH = 2000


class MessageIn(BaseModel):
    body: str

    @field_validator("body")
    @classmethod
    def _not_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Type a message first")
        if len(v) > MAX_MESSAGE_LENGTH:
            raise ValueError(f"Messages are limited to {MAX_MESSAGE_LENGTH} characters")
        return v


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    sender: str
    body: str
    created_at: str = ""

    model_config = {"from_attributes": True}


class ConversationStart(BaseModel):
    """Opening a thread.

    `to` empty means the shared helpdesk queue, which only a requester can
    post to. Anyone can name a person instead.
    """
    body: str
    subject: str = ""
    to: str = ""

    @field_validator("body")
    @classmethod
    def _not_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Type a message first")
        if len(v) > MAX_MESSAGE_LENGTH:
            raise ValueError(f"Messages are limited to {MAX_MESSAGE_LENGTH} characters")
        return v


class ConversationOut(BaseModel):
    id: int
    kind: str = "helpdesk"
    requester: str
    technician: str = ""
    subject: str = ""
    # Who the viewer is talking to, worked out per request — "Helpdesk" when
    # a queue thread hasn't been picked up yet.
    other: str = ""
    other_role: str = ""
    created_at: str = ""
    updated_at: str = ""
    closed_at: str = ""
    # Filled in by the endpoint, not stored.
    unread: int = 0
    last_message: str = ""
    last_sender: str = ""

    model_config = {"from_attributes": True}

    @field_validator("kind", "technician", "subject", "created_at",
                     "updated_at", "closed_at", mode="before")
    @classmethod
    def _no_nulls(cls, v):
        return "" if v is None else v


class VerifyRequest(BaseModel):
    username: str
    code: str

    @field_validator("code")
    @classmethod
    def _six_digits(cls, v: str) -> str:
        v = (v or "").strip().replace(" ", "")
        if not (len(v) == 6 and v.isdigit()):
            raise ValueError("Enter the 6-digit code from your email")
        return v


class ResendCodeRequest(BaseModel):
    username: str


VALID_ANNOUNCEMENT_LEVELS = ("info", "warning", "critical")


class AnnouncementIn(BaseModel):
    """What a technician or admin submits."""
    title: str = ""
    body: str
    level: str = "info"

    @field_validator("body")
    @classmethod
    def _body_not_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("An announcement needs a message")
        if len(v) > 4000:
            raise ValueError("Announcements are limited to 4000 characters")
        return v

    @field_validator("title")
    @classmethod
    def _title_length(cls, v: str) -> str:
        v = (v or "").strip()
        if len(v) > 120:
            raise ValueError("Title is limited to 120 characters")
        return v

    @field_validator("level")
    @classmethod
    def _check_level(cls, v: str) -> str:
        if v not in VALID_ANNOUNCEMENT_LEVELS:
            raise ValueError(
                f"Level must be one of: {', '.join(VALID_ANNOUNCEMENT_LEVELS)}"
            )
        return v


class AnnouncementOut(BaseModel):
    id: int
    title: str = ""
    body: str
    level: str = "info"
    author: str
    created_at: str = ""
    updated_at: str = ""
    retired_at: str = ""

    model_config = {"from_attributes": True}

    @field_validator("title", "level", "created_at", "updated_at", "retired_at",
                     mode="before")
    @classmethod
    def _no_nulls(cls, v):
        return "" if v is None else v


class AdminUserCreate(BaseModel):
    """An account created by an admin on someone else's behalf.

    Unlike UserCreate this one *does* carry a role. Self-signup must never
    take a role from the client, but this path is reached only through a
    dependency that has already established the caller is an admin, so
    granting one here is the deliberate act the signup lockdown pushes
    people towards.
    """
    name: str
    email: str
    password: str
    role: str = "Requester"

    @field_validator("role")
    @classmethod
    def _check_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(VALID_ROLES)}")
        return v

    _v_name  = field_validator("name")(validate_username)
    _v_email = field_validator("email")(validate_email)
    _v_pass  = field_validator("password")(validate_password)


class UserRoleUpdate(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def _check_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(VALID_ROLES)}")
        return v


class UserOut(BaseModel):
    id: int
    name: str
    role: str
    email: Optional[str] = ""
    requested_role: Optional[str] = ""

    class Config:
        from_attributes = True


# ── Tickets ── #

class TicketCreate(BaseModel):
    title: str
    description: str = ""
    requester: str
    technician: str = ""
    priority: str = "Medium"
    status: str = "Open"
    due_date: str = ""
    category: str = ""
    survey: Dict[str, Any] = {}


class TicketUpdate(BaseModel):
    title: str
    description: str = ""
    requester: str
    technician: str = ""
    priority: str = "Medium"
    status: str = "Open"
    due_date: str = ""
    category: str = ""
    survey: Dict[str, Any] = {}


class TicketStatusUpdate(BaseModel):
    status: str



class TicketOut(BaseModel):
    id: int
    title: str
    description: str
    status: str
    priority: str
    created_at: str
    updated_at: str
    requester: str
    technician: str
    due_date: str
    history: List[str] = []
    category: Optional[str] = ""
    survey: Dict[str, Any] = {}

    # Archive and trash bookkeeping. Empty string means "not closed" and
    # "not deleted" respectively, which keeps every filter a plain string
    # comparison instead of a NULL check.
    ref: str = ""
    closed_at: str = ""
    deleted_at: str = ""
    deleted_by: str = ""

    # Rows written before these columns existed can hold NULL; coerce so the
    # response schema stays a predictable shape for the frontend.
    @field_validator("history", "survey", mode="before")
    @classmethod
    def _no_nulls(cls, v, info):
        if v is None:
            return [] if info.field_name == "history" else {}
        return v

    @field_validator("category", "ref", "closed_at", "deleted_at", "deleted_by",
                     mode="before")
    @classmethod
    def _no_null_strings(cls, v):
        return "" if v is None else v

    class Config:
        from_attributes = True


# ── Comments ── #

class CommentCreate(BaseModel):
    body: str


class CommentOut(BaseModel):
    id: int
    ticket_id: int
    author: str
    author_role: str
    body: str
    created_at: str

    class Config:
        from_attributes = True


# ── Attachments ── #

class AttachmentOut(BaseModel):
    id: int
    ticket_id: int
    filename: str
    content_type: str
    size: int
    uploaded_by: str
    uploaded_at: str

    class Config:
        from_attributes = True


# ── Knowledge base ── #

class ArticleCreate(BaseModel):
    title: str
    category: str = ""
    summary: str = ""
    body: str = ""
    keywords: str = ""


class ArticleOut(BaseModel):
    id: int
    title: str
    category: str
    summary: str
    body: str
    keywords: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ══════════════════════════ Careers ══════════════════════════ #
#
# Two tables for one application, on purpose.
#
# ApplicationDB holds what a hiring manager is allowed to read. The voluntary
# EEO self-identification goes in ApplicationEEODB instead, keyed by the same
# id but never joined into the reviewer's view. Real employers are expected to
# keep self-identification apart from the hiring decision, and the honest way
# to express "apart" in a schema is a different table that the review endpoint
# simply does not query — not a column the UI politely scrolls past.
#
# Things deliberately NOT collected here, and why:
#   SSN            — post-offer only (I-9, background check). On a public demo
#                    it is a liability with no upside.
#   Date of birth  — age-discrimination exposure; "18 or over" does the job.
#   Criminal record— Illinois JOQAA bars asking at the application stage.
#   Disability     — ADA bars pre-offer disability inquiries. What is asked
#                    instead is whether they can perform the essential
#                    functions, and whether they need accommodation to
#                    interview.


class JobPostingDB(Base):
    __tablename__ = "job_postings"

    id:              Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    slug:            Mapped[str] = mapped_column(String, unique=True, index=True)
    title:           Mapped[str] = mapped_column(String)
    # The role this posting hires INTO, in the app's own vocabulary, so a hire
    # can issue the right invite code without anyone mapping it by hand.
    grants_role:     Mapped[str] = mapped_column(String, default="Technician")
    level:           Mapped[str] = mapped_column(String, default="")
    location:        Mapped[str] = mapped_column(String, default="")
    employment_type: Mapped[str] = mapped_column(String, default="Full-time")
    salary_range:    Mapped[str] = mapped_column(String, default="")
    summary:         Mapped[str] = mapped_column(Text, default="")
    description:     Mapped[str] = mapped_column(Text, default="")
    responsibilities: Mapped[str] = mapped_column(Text, default="")
    requirements:    Mapped[str] = mapped_column(Text, default="")
    created_by:      Mapped[str] = mapped_column(String, default="")
    created_at:      Mapped[str] = mapped_column(String, default="")
    updated_at:      Mapped[str] = mapped_column(String, default="")
    # Empty means the posting is open. Same derived-state habit as the rest of
    # the app: no bool that could disagree with the timestamp beside it.
    closed_at:       Mapped[str] = mapped_column(String, default="")


class ApplicationDB(Base):
    __tablename__ = "applications"

    id:         Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ref:        Mapped[str] = mapped_column(String, default="", index=True)
    job_id:     Mapped[int] = mapped_column(Integer, index=True)
    job_title:  Mapped[str] = mapped_column(String, default="")

    # ── Contact ──
    first_name:   Mapped[str] = mapped_column(String, default="")
    middle_initial: Mapped[str] = mapped_column(String, default="")
    last_name:    Mapped[str] = mapped_column(String, default="")
    address:      Mapped[str] = mapped_column(String, default="")
    city:         Mapped[str] = mapped_column(String, default="")
    state:        Mapped[str] = mapped_column(String, default="")
    postal_code:  Mapped[str] = mapped_column(String, default="")
    phone_mobile: Mapped[str] = mapped_column(String, default="")
    phone_home:   Mapped[str] = mapped_column(String, default="")
    email:        Mapped[str] = mapped_column(String, default="", index=True)

    # Replaces date of birth: the only thing an employer needs pre-offer.
    is_adult:     Mapped[int] = mapped_column(Integer, default=0)
    work_authorized: Mapped[int] = mapped_column(Integer, default=0)

    # ── Emergency contact ──
    ec_name:     Mapped[str] = mapped_column(String, default="")
    ec_relation: Mapped[str] = mapped_column(String, default="")
    ec_phone:    Mapped[str] = mapped_column(String, default="")
    ec_email:    Mapped[str] = mapped_column(String, default="")

    # ── Background ──
    heard_about:   Mapped[str] = mapped_column(String, default="")
    about_you:     Mapped[str] = mapped_column(Text, default="")
    it_experience: Mapped[str] = mapped_column(Text, default="")

    # ── Education ──
    highschool:        Mapped[str] = mapped_column(String, default="")
    highschool_year:   Mapped[str] = mapped_column(String, default="")
    college:           Mapped[str] = mapped_column(String, default="")
    college_major:     Mapped[str] = mapped_column(String, default="")
    college_year:      Mapped[str] = mapped_column(String, default="")
    still_attending:   Mapped[int] = mapped_column(Integer, default=0)

    # ── Employment history ──
    no_prior_employment: Mapped[int] = mapped_column(Integer, default=0)
    prev_employer:   Mapped[str] = mapped_column(String, default="")
    prev_title:      Mapped[str] = mapped_column(String, default="")
    prev_from:       Mapped[str] = mapped_column(String, default="")
    prev_to:         Mapped[str] = mapped_column(String, default="")
    prev_reason:     Mapped[str] = mapped_column(Text, default="")

    # ── ADA-safe job-fitness questions (permitted pre-offer) ──
    can_perform_functions: Mapped[int] = mapped_column(Integer, default=0)
    needs_interview_accommodation: Mapped[str] = mapped_column(Text, default="")

    # ── Agreement ──
    signature:     Mapped[str] = mapped_column(String, default="")
    signed_at:     Mapped[str] = mapped_column(String, default="")
    certified:     Mapped[int] = mapped_column(Integer, default=0)

    # ── Review ──
    status:        Mapped[str] = mapped_column(String, default="New", index=True)
    reviewer_notes: Mapped[str] = mapped_column(Text, default="")
    reviewed_by:   Mapped[str] = mapped_column(String, default="")
    reviewed_at:   Mapped[str] = mapped_column(String, default="")
    submitted_at:  Mapped[str] = mapped_column(String, default="", index=True)
    hired_invite_code: Mapped[str] = mapped_column(String, default="")


class ApplicationEEODB(Base):
    """Voluntary self-identification, stored apart from the application.

    Never returned by the review endpoints. It exists so the demo can show the
    aggregate reporting such data is actually for, without putting it in front
    of whoever decides who gets hired.
    """
    __tablename__ = "application_eeo"

    id:             Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    application_id: Mapped[int] = mapped_column(Integer, index=True)
    gender:         Mapped[str] = mapped_column(String, default="Decline to self-identify")
    race:           Mapped[str] = mapped_column(String, default="Decline to self-identify")
    veteran_status: Mapped[str] = mapped_column(String, default="Decline to self-identify")
    submitted_at:   Mapped[str] = mapped_column(String, default="")


# ── Careers schemas ──
#
# Note what ApplicationOut does NOT contain: there is no eeo field. The
# reviewer's view cannot leak self-identification data because the shape it
# is serialised into has nowhere to put it.


class JobPostingIn(BaseModel):
    title: str
    grants_role: str = "Technician"
    level: str = ""
    location: str = ""
    employment_type: str = "Full-time"
    salary_range: str = ""
    summary: str = ""
    description: str = ""
    responsibilities: str = ""
    requirements: str = ""

    @field_validator("title")
    @classmethod
    def _title_required(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("A job posting needs a title.")
        return v.strip()

    @field_validator("grants_role")
    @classmethod
    def _role_known(cls, v: str) -> str:
        if v not in ("Technician", "Both"):
            raise ValueError("A posting can only hire into Technician or Both.")
        return v


class JobPostingOut(BaseModel):
    id: int
    slug: str
    title: str
    grants_role: str
    level: str
    location: str
    employment_type: str
    salary_range: str
    summary: str
    description: str
    responsibilities: str
    requirements: str
    created_at: str
    updated_at: str
    closed_at: str

    model_config = {"from_attributes": True}


class ApplicationEEOIn(BaseModel):
    """Every field defaults to declining. Answering is optional by design."""
    gender: str = "Decline to self-identify"
    race: str = "Decline to self-identify"
    veteran_status: str = "Decline to self-identify"


class ApplicationIn(BaseModel):
    job_slug: str

    first_name: str
    middle_initial: str = ""
    last_name: str
    address: str = ""
    city: str = ""
    state: str = ""
    postal_code: str = ""
    phone_mobile: str = ""
    phone_home: str = ""
    email: str
    confirm_email: str

    is_adult: bool = False
    work_authorized: bool = False

    ec_name: str = ""
    ec_relation: str = ""
    ec_phone: str = ""
    ec_email: str = ""

    heard_about: str = ""
    about_you: str = ""
    it_experience: str = ""

    highschool: str = ""
    highschool_year: str = ""
    college: str = ""
    college_major: str = ""
    college_year: str = ""
    still_attending: bool = False

    no_prior_employment: bool = False
    prev_employer: str = ""
    prev_title: str = ""
    prev_from: str = ""
    prev_to: str = ""
    prev_reason: str = ""

    can_perform_functions: bool = False
    needs_interview_accommodation: str = ""

    signature: str
    certified: bool = False

    eeo: ApplicationEEOIn = ApplicationEEOIn()

    @field_validator("first_name", "last_name", "signature")
    @classmethod
    def _required(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("This field is required.")
        return v.strip()

    @field_validator("email")
    @classmethod
    def _email_shape(cls, v: str) -> str:
        v = v.strip()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("That doesn't look like an email address.")
        return v


class ApplicationSummary(BaseModel):
    """The list row. Deliberately thin — a reviewer scanning a list has no
    business loading everyone's home address."""
    id: int
    ref: str
    job_id: int
    job_title: str
    first_name: str
    last_name: str
    email: str
    status: str
    submitted_at: str
    reviewed_by: str

    model_config = {"from_attributes": True}


class ApplicationOut(BaseModel):
    id: int
    ref: str
    job_id: int
    job_title: str
    first_name: str
    middle_initial: str
    last_name: str
    address: str
    city: str
    state: str
    postal_code: str
    phone_mobile: str
    phone_home: str
    email: str
    is_adult: int
    work_authorized: int
    ec_name: str
    ec_relation: str
    ec_phone: str
    ec_email: str
    heard_about: str
    about_you: str
    it_experience: str
    highschool: str
    highschool_year: str
    college: str
    college_major: str
    college_year: str
    still_attending: int
    no_prior_employment: int
    prev_employer: str
    prev_title: str
    prev_from: str
    prev_to: str
    prev_reason: str
    can_perform_functions: int
    needs_interview_accommodation: str
    signature: str
    signed_at: str
    certified: int
    status: str
    reviewer_notes: str
    reviewed_by: str
    reviewed_at: str
    submitted_at: str
    hired_invite_code: str

    model_config = {"from_attributes": True}


class ApplicationReviewIn(BaseModel):
    status: Optional[str] = None
    reviewer_notes: Optional[str] = None