"""Outbound email.

Sends over Resend's HTTPS API rather than SMTP. Render's free web services
block outbound traffic to ports 25, 465 and 587 (since September 2025), so
smtplib can never connect from the deployed backend — it just times out.
An HTTP API goes over 443 and is unaffected.

SMTP is still supported for anyone running this somewhere without that
restriction: set SMTP_HOST instead of RESEND_API_KEY.

With neither configured, every send is a silent no-op, so local development
and the public demo work with no mail setup at all.
"""

import json
import os
import smtplib
import threading
import urllib.error
import urllib.request
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Iterable, List, Optional

RESEND_ENDPOINT = "https://api.resend.com/emails"

# Resend accepts at most 50 recipients per request.
RESEND_MAX_RECIPIENTS = 50


def _cfg() -> dict:
    return {
        "resend_key": os.environ.get("RESEND_API_KEY", ""),
        # Until a domain is verified with Resend, the only usable sender is
        # onboarding@resend.dev, and it will only deliver to the address on
        # your own Resend account. Everything else comes back 403.
        "from_addr": os.environ.get("MAIL_FROM", "Tech Help <onboarding@resend.dev>"),
        "smtp_host": os.environ.get("SMTP_HOST", ""),
        "smtp_port": int(os.environ.get("SMTP_PORT", "587")),
        "smtp_user": os.environ.get("SMTP_USER", ""),
        "smtp_password": os.environ.get("SMTP_PASSWORD", ""),
        "smtp_from": os.environ.get("SMTP_FROM", os.environ.get("SMTP_USER", "")),
        # Optional address that receives a copy of everything (ops inbox).
        "admin_copy": os.environ.get("NOTIFY_EMAIL", ""),
    }


def email_configured() -> bool:
    """Whether anything would actually be sent.

    Callers use this to avoid promising a user an email that can't arrive —
    an unverifiable account is worse than no verification step.
    """
    cfg = _cfg()
    return bool(cfg["resend_key"] or cfg["smtp_host"])


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


def _send_via_resend(cfg: dict, subject: str, body: str,
                     recipients: List[str]) -> None:
    """POST to Resend, one request per batch of recipients.

    Recipients go one-per-request so nobody sees anyone else's address —
    putting them all in `to` would expose the whole user list to everyone on
    an announcement email.
    """
    for addr in recipients:
        payload = json.dumps({
            "from": cfg["from_addr"],
            "to": [addr],
            "subject": subject,
            "text": body,
        }).encode("utf-8")

        req = urllib.request.Request(
            RESEND_ENDPOINT,
            data=payload,
            headers={
                "Authorization": f"Bearer {cfg['resend_key']}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            if exc.code == 403 and "testing emails" in detail:
                print(
                    f"Email to {addr} refused: Resend only delivers to your own "
                    f"account address until a domain is verified. "
                    f"See https://resend.com/domains"
                )
            else:
                print(f"Email to {addr} failed ({exc.code}): {detail}")
        except Exception as exc:
            print(f"Email to {addr} failed: {exc}")


def _send_via_smtp(cfg: dict, subject: str, body: str,
                   recipients: List[str]) -> None:
    try:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = formataddr(("Tech Help", cfg["smtp_from"]))
        # Recipients go in Bcc so people can't see each other's addresses
        msg["To"] = cfg["smtp_from"]

        with smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"], timeout=15) as s:
            s.ehlo()
            s.starttls()
            if cfg["smtp_user"] and cfg["smtp_password"]:
                s.login(cfg["smtp_user"], cfg["smtp_password"])
            s.sendmail(cfg["smtp_from"], recipients, msg.as_string())
    except Exception as exc:
        print(f"Email notification failed: {exc}")


def send_notification(
    subject: str,
    body: str,
    to: Optional[Iterable[Optional[str]]] = None,
) -> None:
    """Fire-and-forget email to the people who care about an event.

    Returns immediately; delivery happens on a background thread so a slow
    or failing mail provider never holds up an API response.
    """
    cfg = _cfg()
    recipients = _clean_recipients(list(to or []) + [cfg["admin_copy"]])
    if not recipients:
        return

    if cfg["resend_key"]:
        sender = lambda: _send_via_resend(cfg, subject, body, recipients)  # noqa: E731
    elif cfg["smtp_host"]:
        sender = lambda: _send_via_smtp(cfg, subject, body, recipients)    # noqa: E731
    else:
        return  # nothing configured; stay quiet

    threading.Thread(target=sender, daemon=True).start()


def send_bulk(subject: str, body: str,
              recipients: Iterable[Optional[str]]) -> int:
    """Send the same message to many people. Returns how many will be tried.

    Used for announcements. Each recipient still gets their own message, so
    the user list is never disclosed.
    """
    cfg = _cfg()
    clean = _clean_recipients(recipients)
    if not clean or not (cfg["resend_key"] or cfg["smtp_host"]):
        return 0

    def _run():
        if cfg["resend_key"]:
            _send_via_resend(cfg, subject, body, clean)
        else:
            # One SMTP message with everyone bcc'd, which is how the SMTP
            # path has always worked.
            _send_via_smtp(cfg, subject, body, clean)

    threading.Thread(target=_run, daemon=True).start()
    return len(clean)