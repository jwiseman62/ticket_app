from typing import List
from sqlalchemy import Column, Integer, String, Text, JSON
from pydantic import BaseModel
from database import Base


# ── ORM models ─────────────────────────────────────────────────────── #

class UserDB(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    name          = Column(String, unique=True, index=True, nullable=False)
    role          = Column(String, default="Requester")
    password_hash = Column(String, nullable=False)


class TicketDB(Base):
    __tablename__ = "tickets"

    id          = Column(Integer, primary_key=True, index=True)
    title       = Column(String, nullable=False)
    description = Column(Text, default="")
    status      = Column(String, default="Open")
    priority    = Column(String, default="Medium")
    created_at  = Column(String)
    updated_at  = Column(String)
    requester   = Column(String, default="")
    technician  = Column(String, default="")
    due_date    = Column(String, default="")
    history     = Column(JSON, default=list)


# ── Pydantic schemas ────────────────────────────────────────────────── #

class UserCreate(BaseModel):
    name: str
    password: str
    role: str = "Requester"


class UserPasswordReset(BaseModel):
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    role: str

    class Config:
        from_attributes = True


class TicketCreate(BaseModel):
    title: str
    description: str = ""
    requester: str
    technician: str = ""
    priority: str = "Medium"
    status: str = "Open"
    due_date: str = ""


class TicketUpdate(BaseModel):
    title: str
    description: str = ""
    requester: str
    technician: str = ""
    priority: str = "Medium"
    status: str = "Open"
    due_date: str = ""


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
    history: List[str]

    class Config:
        from_attributes = True
