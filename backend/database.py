from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = "sqlite:///./tickets.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _columns(conn, table: str) -> set:
    return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}


def migrate() -> None:
    """Add columns introduced after the first release, without dropping data.

    SQLAlchemy's create_all() only creates missing *tables*, never missing
    columns, so existing tickets.db files need this nudge.
    """
    with engine.connect() as conn:
        tickets = _columns(conn, "tickets")
        if "category" not in tickets:
            conn.execute(text("ALTER TABLE tickets ADD COLUMN category VARCHAR DEFAULT ''"))
        if "survey" not in tickets:
            conn.execute(text("ALTER TABLE tickets ADD COLUMN survey JSON"))

        users = _columns(conn, "users")
        if users:  # table exists
            if "email" not in users:
                conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR DEFAULT ''"))
            if "created_at" not in users:
                conn.execute(text("ALTER TABLE users ADD COLUMN created_at VARCHAR DEFAULT ''"))
            if "failed_logins" not in users:
                conn.execute(text("ALTER TABLE users ADD COLUMN failed_logins INTEGER DEFAULT 0"))
            if "locked_until" not in users:
                conn.execute(text("ALTER TABLE users ADD COLUMN locked_until VARCHAR DEFAULT ''"))
            if "requested_role" not in users:
                conn.execute(text("ALTER TABLE users ADD COLUMN requested_role VARCHAR DEFAULT ''"))

        conn.commit()