"""Database engine, session factory, and lightweight migrations.

Works against both SQLite (local development) and PostgreSQL (deployment).
Which one you get is decided entirely by the DATABASE_URL environment
variable, so no code changes are needed to switch.
"""

import os
import re

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# ── Connection URL ──────────────────────────────────────────────── #

DEFAULT_SQLITE_URL = "sqlite:///./tickets.db"


def normalize_db_url(url: str) -> str:
    """Make a hosted Postgres URL usable by SQLAlchemy 2.x + psycopg 3.

    Render, Neon, Supabase and Heroku hand out URLs beginning with
    `postgres://` or `postgresql://`. SQLAlchemy 2 maps the bare
    `postgresql://` prefix to psycopg2, which we don't install, and rejects
    `postgres://` outright. Rewriting the scheme to `postgresql+psycopg://`
    points it at psycopg 3.

    Query strings are preserved, which matters because Neon requires
    `?sslmode=require`.
    """
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    if re.match(r"^postgresql://", url):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = normalize_db_url(os.environ.get("DATABASE_URL", DEFAULT_SQLITE_URL))
IS_SQLITE = DATABASE_URL.startswith("sqlite")


# ── Engine ──────────────────────────────────────────────────────── #

_engine_kwargs: dict = {}

if IS_SQLITE:
    # SQLite-only: allows the connection to be used across FastAPI's
    # threadpool. Passing this to Postgres raises a TypeError.
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    # Serverless Postgres (Neon, Supabase) suspends compute after a few
    # minutes of inactivity, which silently kills pooled connections.
    # Without pre_ping the next request fails with "server closed the
    # connection unexpectedly"; with it, SQLAlchemy tests the connection
    # and transparently reconnects.
    _engine_kwargs["pool_pre_ping"] = True
    _engine_kwargs["pool_recycle"] = 300      # seconds
    _engine_kwargs["pool_size"] = 5
    _engine_kwargs["max_overflow"] = 5

engine = create_engine(DATABASE_URL, **_engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Migrations ──────────────────────────────────────────────────── #
#
# SQLAlchemy's create_all() creates missing *tables* but never missing
# *columns*, so databases created before a column existed need a nudge.
#
# This used to use `PRAGMA table_info(...)`, which is SQLite-only syntax and
# fails on Postgres with `syntax error at or near "PRAGMA"` — at import time,
# before the app serves a single request. SQLAlchemy's inspector asks the same
# question in a way every dialect understands.

# column name -> SQL type used in ALTER TABLE
_TICKET_COLUMNS = {
    "category":   "VARCHAR DEFAULT ''",
    "survey":     "JSON",
    "closed_at":  "VARCHAR DEFAULT ''",
    "deleted_at": "VARCHAR DEFAULT ''",
    "deleted_by": "VARCHAR DEFAULT ''",
}

# Indexes that ALTER TABLE ... ADD COLUMN does not create. Every archive and
# trash query filters on these two, so they matter once the table grows.
_INDEXES = [
    ("ix_tickets_closed_at",  "tickets", "closed_at"),
    ("ix_tickets_deleted_at", "tickets", "deleted_at"),
]

_USER_COLUMNS = {
    "email":          "VARCHAR DEFAULT ''",
    "created_at":     "VARCHAR DEFAULT ''",
    "failed_logins":  "INTEGER DEFAULT 0",
    "locked_until":   "VARCHAR DEFAULT ''",
    "requested_role": "VARCHAR DEFAULT ''",
}

_ATTACHMENT_COLUMNS = {
    # Populated only when STORE_UPLOADS_IN_DB is on; see main.py.
    "data": "BYTEA" if not IS_SQLITE else "BLOB",
}


def _existing_columns(inspector, table: str) -> set:
    if not inspector.has_table(table):
        return set()
    return {col["name"] for col in inspector.get_columns(table)}


def migrate() -> None:
    """Add columns introduced after the first release, without dropping data.

    On a fresh database this is a no-op: create_all() has already made every
    table complete, so the inspector finds nothing missing.
    """
    inspector = inspect(engine)

    plan: list[tuple[str, str, str]] = []
    for table, columns in (
        ("tickets",     _TICKET_COLUMNS),
        ("users",       _USER_COLUMNS),
        ("attachments", _ATTACHMENT_COLUMNS),
    ):
        present = _existing_columns(inspector, table)
        if not present:
            continue  # table absent entirely; create_all() will handle it
        for name, sql_type in columns.items():
            if name not in present:
                plan.append((table, name, sql_type))

    if plan:
        with engine.begin() as conn:
            for table, name, sql_type in plan:
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {sql_type}'))
                print(f"  migrated: {table}.{name} added")

    # Create indexes separately. IF NOT EXISTS is supported by both SQLite
    # and PostgreSQL, so this is safe to run on every start.
    with engine.begin() as conn:
        for index_name, table, column in _INDEXES:
            if not inspect(engine).has_table(table):
                continue
            conn.execute(text(
                f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} ({column})"
            ))


def describe_backend() -> str:
    """Human-readable summary for startup logs, with credentials stripped."""
    if IS_SQLITE:
        return f"SQLite ({DATABASE_URL})"
    safe = re.sub(r"://[^@]*@", "://***@", DATABASE_URL)
    return f"PostgreSQL ({safe})"