import re
from typing import List, Optional, Dict, Any

from pydantic import BaseModel, field_validator
from sqlalchemy import ForeignKey, Integer, JSON, String, Text
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

    # Rows written before these columns existed can hold NULL; coerce so the
    # response schema stays a predictable shape for the frontend.
    @field_validator("history", "survey", mode="before")
    @classmethod
    def _no_nulls(cls, v, info):
        if v is None:
            return [] if info.field_name == "history" else {}
        return v

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