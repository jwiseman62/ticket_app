#!/usr/bin/env python3
"""Command-line admin tool.

For when you're locked out, forgot which username you used, or need to
promote someone to admin without going through the web UI.

Run from the backend/ folder with your virtualenv active:

    python manage.py list
    python manage.py whoami
    python manage.py reset <username>
    python manage.py promote <username>
    python manage.py unlock <username>
    python manage.py create-admin <username> <email>

Passwords are hashed with PBKDF2 and cannot be read back — "reset" sets a
new one rather than revealing the old one.
"""

import getpass
import sys

from auth import MAX_FAILED_LOGINS, hash_password, is_locked_out, utc_now_iso
from database import Base, SessionLocal, engine, migrate
from models import (
    MIN_PASSWORD_LENGTH, VALID_ROLES, InviteCodeDB, TicketDB, UserDB,
)

Base.metadata.create_all(bind=engine)
migrate()


# ── Output helpers ──────────────────────────────────────────────── #

def ok(msg):    print(f"  \033[32m✓\033[0m {msg}")
def warn(msg):  print(f"  \033[33m!\033[0m {msg}")
def fail(msg):  print(f"  \033[31m✗\033[0m {msg}")


def find_user(db, name):
    """Case-insensitive lookup so 'Jeff' finds 'jeff'."""
    user = db.query(UserDB).filter(UserDB.name == name).first()
    if user:
        return user
    for u in db.query(UserDB).all():
        if u.name.lower() == name.lower():
            return u
    return None


def prompt_new_password() -> str:
    while True:
        pw = getpass.getpass("  New password: ")
        if len(pw) < MIN_PASSWORD_LENGTH:
            fail(f"Must be at least {MIN_PASSWORD_LENGTH} characters.")
            continue
        if pw != getpass.getpass("  Confirm password: "):
            fail("Passwords don't match.")
            continue
        return pw


# ── Commands ────────────────────────────────────────────────────── #

def cmd_list():
    """Show every account, its role, email, and lock status."""
    db = SessionLocal()
    try:
        users = db.query(UserDB).order_by(UserDB.id).all()
        if not users:
            warn("No accounts exist yet.")
            print("\n  The database is empty, so the NEXT account registered")
            print("  through the web app automatically becomes the admin.")
            return

        print(f"\n  {len(users)} account(s):\n")
        print(f"  {'ID':<4} {'USERNAME':<20} {'ROLE':<12} {'EMAIL':<28} STATUS")
        print(f"  {'-'*4} {'-'*20} {'-'*12} {'-'*28} {'-'*16}")

        for u in users:
            locked = is_locked_out(u)
            if locked:
                statuses = [f"LOCKED {max(1, locked//60)}m"]
            else:
                statuses = []
                if (u.failed_logins or 0) > 0:
                    statuses.append(f"{u.failed_logins}/{MAX_FAILED_LOGINS} failed")
            if not u.email:
                statuses.append("no email")
            status = ", ".join(statuses) or "ok"

            marker = " *" if u.role == "Both" else "  "
            print(f"  {u.id:<4} {u.name:<20} {u.role:<12} "
                  f"{(u.email or '—'):<28} {status}{marker}")

        admins = [u.name for u in users if u.role == "Both"]
        print(f"\n  * = admin. Admins: {', '.join(admins) if admins else 'NONE'}")

        if not admins:
            warn("No admin account exists.")
            print("    Fix with:  python manage.py promote <username>")
    finally:
        db.close()


def cmd_whoami():
    """Best-effort guess at which account is yours, based on ticket activity."""
    db = SessionLocal()
    try:
        users = db.query(UserDB).order_by(UserDB.id).all()
        if not users:
            warn("No accounts exist yet.")
            return

        print("\n  Accounts, most-likely-yours first:\n")
        scored = []
        for u in users:
            filed = db.query(TicketDB).filter(TicketDB.requester == u.name).count()
            assigned = db.query(TicketDB).filter(TicketDB.technician == u.name).count()
            score = (u.role == "Both") * 100 + filed + assigned - u.id
            scored.append((score, u, filed, assigned))

        for _s, u, filed, assigned in sorted(scored, key=lambda x: -x[0]):
            bits = []
            if u.role == "Both":
                bits.append("ADMIN")
            if filed:
                bits.append(f"filed {filed}")
            if assigned:
                bits.append(f"assigned {assigned}")
            print(f"  {u.name:<20} {u.role:<12} {', '.join(bits) or 'no activity'}")

        print("\n  Passwords can't be recovered — they're hashed one-way.")
        print("  Set a new one with:  python manage.py reset <username>")
    finally:
        db.close()


def cmd_reset(name):
    """Set a new password and clear any lockout."""
    db = SessionLocal()
    try:
        user = find_user(db, name)
        if not user:
            fail(f"No account named '{name}'.")
            print("     Run 'python manage.py list' to see valid usernames.")
            return 1

        print(f"\n  Resetting password for '{user.name}' (role: {user.role})")
        pw = prompt_new_password()

        user.password_hash = hash_password(pw)
        user.failed_logins = 0
        user.locked_until = ""
        db.commit()

        ok(f"Password updated for '{user.name}'. Any lockout was cleared.")
        if user.role != "Both":
            warn(f"Note: '{user.name}' is a {user.role}, not an admin.")
            print(f"     To make them admin:  python manage.py promote {user.name}")
    finally:
        db.close()
    return 0


def cmd_promote(name, role="Both"):
    """Change a user's role. Defaults to admin."""
    if role not in VALID_ROLES:
        fail(f"Role must be one of: {', '.join(VALID_ROLES)}")
        return 1

    db = SessionLocal()
    try:
        user = find_user(db, name)
        if not user:
            fail(f"No account named '{name}'.")
            return 1
        old = user.role
        user.role = role
        db.commit()
        ok(f"'{user.name}': {old} → {role}")
    finally:
        db.close()
    return 0


def cmd_unlock(name):
    """Clear a lockout caused by too many failed logins."""
    db = SessionLocal()
    try:
        user = find_user(db, name)
        if not user:
            fail(f"No account named '{name}'.")
            return 1
        user.failed_logins = 0
        user.locked_until = ""
        db.commit()
        ok(f"'{user.name}' unlocked. You can sign in again immediately.")
    finally:
        db.close()
    return 0


def cmd_invite(role="Technician", target=""):
    """Mint an access code from the terminal."""
    import secrets as _secrets
    from datetime import timedelta
    from auth import utc_now

    if role not in ("Technician", "Both"):
        fail("Role must be Technician or Both")
        return 1

    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    db = SessionLocal()
    try:
        if target:
            if not find_user(db, target):
                fail(f"No account named '{target}'.")
                return 1
        for _ in range(5):
            body = "".join(_secrets.choice(alphabet) for _ in range(8))
            code = f"TECH-{body[:4]}-{body[4:]}"
            if not db.query(InviteCodeDB).filter(InviteCodeDB.code == code).first():
                break
        expires = (utc_now() + timedelta(days=14)).isoformat(timespec="seconds")
        db.add(InviteCodeDB(
            code=code, role=role, note="issued via manage.py",
            created_by="cli", created_at=utc_now_iso(), expires_at=expires,
            max_uses=1, uses=0, revoked=0, target_user=target,
        ))
        db.commit()
        ok(f"Code created: {code}")
        print(f"     grants : {role}")
        print(f"     for    : {target or 'anyone'}")
        print(f"     expires: {expires[:10]}")
        print(f"\n     They redeem it at /redeem after signing in.")
    finally:
        db.close()
    return 0


def cmd_pending():
    """Show accounts waiting for technician approval."""
    db = SessionLocal()
    try:
        rows = (db.query(UserDB)
                  .filter(UserDB.requested_role != "", UserDB.role == "Requester")
                  .all())
        if not rows:
            ok("Nobody is waiting for approval.")
            return 0
        print(f"\n  {len(rows)} pending request(s):\n")
        for u in rows:
            print(f"  {u.name:<20} wants {u.requested_role:<12} {u.email or '(no email)'}")
        print(f"\n  Approve with:  python manage.py invite Technician <username>")
    finally:
        db.close()
    return 0


def cmd_create_admin(name, email):
    """Create a brand-new admin account."""
    db = SessionLocal()
    try:
        if find_user(db, name):
            fail(f"'{name}' already exists. Use 'promote' or 'reset' instead.")
            return 1

        print(f"\n  Creating admin account '{name}' <{email}>")
        pw = prompt_new_password()

        db.add(UserDB(
            name=name, email=email.strip().lower(), role="Both",
            password_hash=hash_password(pw), created_at=utc_now_iso(),
        ))
        db.commit()
        ok(f"Admin account '{name}' created. You can sign in now.")
    finally:
        db.close()
    return 0


# ── Entry point ─────────────────────────────────────────────────── #

USAGE = """
IT Ticket System — admin tool

  python manage.py list                      Show all accounts
  python manage.py whoami                    Guess which account is yours
  python manage.py reset <username>          Set a new password
  python manage.py promote <username> [role] Change role (default: Both/admin)
  python manage.py unlock <username>         Clear a login lockout
  python manage.py create-admin <name> <email>   Make a new admin account
  python manage.py pending                   Show technician requests
  python manage.py invite [role] [username]  Mint an access code

Locked out entirely? Start with:  python manage.py list
"""


def main():
    if len(sys.argv) < 2:
        print(USAGE)
        return 0

    cmd, args = sys.argv[1], sys.argv[2:]
    try:
        if cmd == "list":
            return cmd_list() or 0
        if cmd == "whoami":
            return cmd_whoami() or 0
        if cmd == "reset" and len(args) == 1:
            return cmd_reset(args[0])
        if cmd == "promote" and len(args) in (1, 2):
            return cmd_promote(*args)
        if cmd == "unlock" and len(args) == 1:
            return cmd_unlock(args[0])
        if cmd == "create-admin" and len(args) == 2:
            return cmd_create_admin(args[0], args[1])
        if cmd == "pending" and not args:
            return cmd_pending()
        if cmd == "invite" and len(args) <= 2:
            return cmd_invite(*args)
    except KeyboardInterrupt:
        print("\n  Cancelled.")
        return 1

    print(USAGE)
    return 1


if __name__ == "__main__":
    sys.exit(main())