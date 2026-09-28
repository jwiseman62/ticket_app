import os
import smtplib
import threading
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Iterable, List, Optional


def _smtp_cfg() -> dict:
    return {
        "host":      os.environ.get("SMTP_HOST", ""),
        "port":      int(os.environ.get("SMTP_PORT", "587")),
        "user":      os.environ.get("SMTP_USER", ""),
        "password":  os.environ.get("SMTP_PASSWORD", ""),
        "from_addr": os.environ.get("SMTP_FROM", os.environ.get("SMTP_USER", "")),
        # Optional address that receives a copy of everything (ops inbox).
        "admin_copy": os.environ.get("NOTIFY_EMAIL", ""),
    }


def _clean_recipients(recipients: Iterable[Optional[str]]) -> List[str]:
    """Deduplicate, drop blanks, and normalise case."""
    seen, out = set(), []
    for r in recipients:
        if not r:
            continue
        addr = r.strip().lower()
        if "@" not in addr or addr in seen:
            continue
        seen.add(addr)
        out.append(addr)
    return out


def send_notification(
    subject: str,
    body: str,
    to: Optional[Iterable[Optional[str]]] = None,
) -> None:
    """Fire-and-forget email.

    `to` is the list of people who actually care about this event — normally
    the ticket's requester and assigned technician. Previously every message
    went to a single hardcoded NOTIFY_EMAIL address, which meant the people
    involved in a ticket were never told anything.

    NOTIFY_EMAIL is still honoured, but now only as an optional bcc-style
    copy for an ops inbox.

    Silently does nothing when SMTP is unconfigured, so local development
    works without any mail setup.
    """
    cfg = _smtp_cfg()
    recipients = _clean_recipients(list(to or []) + [cfg["admin_copy"]])

    if not cfg["host"] or not recipients:
        return

    def _send():
        try:
            msg = MIMEText(body, "plain", "utf-8")
            msg["Subject"] = subject
            msg["From"] = formataddr(("IT Ticket System", cfg["from_addr"]))
            # Recipients go in Bcc so people can't see each other's addresses
            msg["To"] = cfg["from_addr"]

            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=15) as s:
                s.ehlo()
                s.starttls()
                if cfg["user"] and cfg["password"]:
                    s.login(cfg["user"], cfg["password"])
                s.sendmail(cfg["from_addr"], recipients, msg.as_string())
        except Exception as exc:
            print(f"Email notification failed: {exc}")

    threading.Thread(target=_send, daemon=True).start()