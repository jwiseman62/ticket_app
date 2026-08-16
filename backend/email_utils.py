import os
import smtplib
import threading
from email.mime.text import MIMEText


def _smtp_cfg() -> dict:
    return {
        "host":      os.environ.get("SMTP_HOST", ""),
        "port":      int(os.environ.get("SMTP_PORT", "587")),
        "user":      os.environ.get("SMTP_USER", ""),
        "password":  os.environ.get("SMTP_PASSWORD", ""),
        "from_addr": os.environ.get("SMTP_FROM", os.environ.get("SMTP_USER", "")),
        "to":        os.environ.get("NOTIFY_EMAIL", ""),
    }


def send_notification(subject: str, body: str) -> None:
    """Fire-and-forget email; silently skips when SMTP env vars are not set."""
    cfg = _smtp_cfg()
    if not cfg["host"] or not cfg["to"]:
        return

    def _send():
        try:
            msg            = MIMEText(body, "plain")
            msg["Subject"] = subject
            msg["From"]    = cfg["from_addr"]
            msg["To"]      = cfg["to"]
            with smtplib.SMTP(cfg["host"], cfg["port"]) as s:
                s.ehlo()
                s.starttls()
                if cfg["user"] and cfg["password"]:
                    s.login(cfg["user"], cfg["password"])
                s.sendmail(cfg["from_addr"], [cfg["to"]], msg.as_string())
        except Exception as exc:
            print(f"Email notification failed: {exc}")

    threading.Thread(target=_send, daemon=True).start()
