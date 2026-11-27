#!/usr/bin/env python3
"""Populate the database with realistic demo content.

An empty ticket list makes a terrible first impression, and the dashboard
charts have nothing to draw. This creates a help desk that looks like it has
been running for a month: tickets across every category, status and priority,
some unassigned so the Claim button has something to claim, some overdue, and
comment threads on the ones a visitor is most likely to open.

    python seed_demo.py            # seed only if the database is empty
    python seed_demo.py --reset    # wipe everything and reseed

All timestamps are relative to the moment it runs, so the demo never looks
stale no matter how long ago it was deployed.
"""

import argparse
import random
import sys
from datetime import datetime, timedelta, timezone

from auth import TERMS_VERSION, hash_password
from database import Base, SessionLocal, engine, migrate
from models import (
    AnnouncementDB, ArticleDB, AttachmentDB, CommentDB, ConversationDB,
    InviteCodeDB, MessageDB,
    TicketDB, UserDB,
    JobPostingDB, ApplicationDB, ApplicationEEODB,
)
from seed_articles import SEED_ARTICLES

# Deterministic, so a reset always produces the same demo.
random.seed(20260101)

DEMO_PASSWORD = "demo1234"

# ── Accounts ────────────────────────────────────────────────────── #
# The first three are advertised on the login page. The rest exist so
# tickets have varied, believable requesters and assignees.

USERS = [
    # (username, email, role, advertised on login page)
    ("demo.admin",  "admin@demo.local",   "Both",       True),
    ("demo.tech",   "tech@demo.local",    "Technician", True),
    ("demo.user",   "user@demo.local",    "Requester",  True),
    ("sarah.chen",  "s.chen@demo.local",  "Technician", False),
    ("marcus.webb", "m.webb@demo.local",  "Technician", False),
    ("priya.n",     "p.nair@demo.local",  "Requester",  False),
    ("tom.alvarez", "t.alvarez@demo.local", "Requester", False),
    ("dana.okoro",  "d.okoro@demo.local", "Requester",  False),
]

TECHS = ["demo.tech", "sarah.chen", "marcus.webb"]
REQUESTERS = ["demo.user", "priya.n", "tom.alvarez", "dana.okoro"]

# ── Tickets ─────────────────────────────────────────────────────── #
# (title, category, priority, status, requester, technician, days_ago,
#  due_in_days or None, description, survey)
#
# technician="" leaves it unassigned, which is what gives the Unassigned
# queue and the one-click Claim button something to demonstrate.

TICKETS = [
    (
        "Laptop won't power on after Windows update",
        "hardware", "High", "In Progress", "priya.n", "sarah.chen", 2, 1,
        "Installed the update yesterday afternoon, shut down normally, and this "
        "morning it won't start at all. No lights, no fan, nothing when I hold "
        "the power button.",
        {"device_type": "Laptop", "asset_tag": "LT-4471",
         "powers_on": "No, nothing happens", "physical_damage": "No",
         "unusual_signs": "None", "started": "Today",
         "affected_count": "Just me", "impact": "Completely blocked",
         "already_tried": "Held the power button for 30 seconds, tried a "
                          "different outlet and a colleague's charger."},
    ),
    (
        "Outlook stuck on 'Trying to connect'",
        "email", "High", "In Progress", "tom.alvarez", "demo.tech", 1, 2,
        "Desktop Outlook has been showing 'Trying to connect' since about 9am. "
        "Webmail works fine, so I can still get to my mail, just not from the app.",
        {"client": "Outlook desktop", "direction": "Both sending and receiving",
         "bounce_text": "", "mailbox_full": "No", "started": "Today",
         "affected_count": "My team", "impact": "Working, but slowed down",
         "already_tried": "Restarted Outlook twice and rebooted."},
    ),
    (
        "Conference room projector shows 'No Signal'",
        "hardware", "High", "Open", "dana.okoro", "", 0, 0,
        "Room 204 projector won't pick up HDMI from any laptop. We have a client "
        "presentation at 2pm today.",
        {"device_type": "Other", "powers_on": "Yes, normally",
         "physical_damage": "No", "started": "Today",
         "affected_count": "My team", "impact": "Completely blocked",
         "already_tried": "Swapped the HDMI cable and tried three laptops."},
    ),
    (
        "Can't connect to Wi-Fi on the third floor",
        "network", "High", "Open", "tom.alvarez", "", 0, 1,
        "Nobody on the east side of the third floor can get on the wireless "
        "since about an hour ago. Wired connections still work.",
        {"connection_type": "Wi-Fi", "can_reach": "Nothing at all",
         "others_affected": "Everyone in the area", "location": "Bldg A, 3rd floor east",
         "vpn": "No", "started": "Today", "affected_count": "The whole office",
         "impact": "Completely blocked",
         "already_tried": "Forgot the network and reconnected, no luck."},
    ),
    (
        "Locked out of VPN after password change",
        "account", "High", "Closed", "priya.n", "marcus.webb", 2, None,
        "Changed my password on Monday as prompted and now VPN rejects it, "
        "though Windows login works with the new one.",
        {"issue_type": "Account locked out", "system_name": "VPN",
         "error_text": "Authentication failed (error 691)",
         "worked_before": "Yes, it worked yesterday", "last_login": "Monday morning",
         "started": "Within the last few days", "affected_count": "Just me",
         "impact": "Completely blocked",
         "already_tried": "Rebooted and retyped it carefully several times."},
    ),
    (
        "Accounting printer jams on every job",
        "printer", "Medium", "In Progress", "dana.okoro", "demo.tech", 3, 2,
        "The printer by the accounting desks jams about ten seconds into any "
        "print job. Happening for everyone, not just me.",
        {"printer_name": "ACCT-HP-02, 2nd floor", "problem": "Paper jam",
         "display_error": "Paper jam in tray 2",
         "others_can_print": "No, nobody can print",
         "started": "Within the last few days", "affected_count": "My team",
         "impact": "Working, but slowed down",
         "already_tried": "Cleared the jam three times and reloaded the tray."},
    ),
    (
        "Excel crashes when opening the quarterly forecast",
        "software", "Medium", "In Progress", "demo.user", "sarah.chen", 4, 3,
        "The forecast workbook closes Excel completely every time I open it. "
        "Other spreadsheets are fine.",
        {"app_name": "Microsoft Excel 365", "operating_system": "Windows 11",
         "behaviour": "Crashes and closes",
         "error_text": "Microsoft Excel has stopped working",
         "frequency": "Every single time", "recent_change": "App was updated",
         "started": "Within the last few days", "affected_count": "Just me",
         "impact": "Working, but slowed down",
         "already_tried": "Opened in safe mode, same result."},
    ),
    (
        "New starter needs account and equipment",
        "account", "Medium", "Open", "dana.okoro", "", 1, 5,
        "New analyst starts Monday. Needs a laptop, email, and access to the "
        "shared finance drive.",
        {"issue_type": "Need access to something new",
         "system_name": "Email, finance share, laptop",
         "worked_before": "No, never had access",
         "started": "Today", "affected_count": "Just me",
         "impact": "Minor annoyance",
         "already_tried": "Submitted the HR onboarding form."},
    ),
    (
        "Monitor flickers when docked",
        "hardware", "Medium", "Open", "priya.n", "", 5, -1,
        "External monitor flickers every few seconds, but only through the dock. "
        "Plugged straight into the laptop it's fine.",
        {"device_type": "Monitor", "asset_tag": "MN-2208",
         "powers_on": "Yes, normally", "physical_damage": "No",
         "unusual_signs": "None", "started": "Within the last few days",
         "affected_count": "Just me", "impact": "Working, but slowed down",
         "already_tried": "Reseated the dock cable and swapped ports."},
    ),
    (
        "Shared drive mapping disappears on restart",
        "network", "Medium", "In Progress", "tom.alvarez", "marcus.webb", 6, -2,
        "The S: drive unmaps every time I restart. I remap it manually each "
        "morning and it works until the next reboot.",
        {"connection_type": "Wired ethernet", "can_reach": "Everything but it is slow",
         "others_affected": "A few people nearby", "location": "Bldg A, 2nd floor",
         "vpn": "No", "started": "More than a week ago",
         "affected_count": "My team", "impact": "Minor annoyance",
         "already_tried": "Ticked 'reconnect at sign-in' but it still drops."},
    ),
    (
        "Request: second monitor for home setup",
        "hardware", "Low", "Open", "demo.user", "", 7, None,
        "Working from home two days a week now and could really use a second "
        "screen for reviewing documents side by side.",
        {"device_type": "Monitor", "powers_on": "Yes, normally",
         "started": "It has always been like this", "affected_count": "Just me",
         "impact": "Minor annoyance", "already_tried": "Nothing yet."},
    ),
    (
        "Teams notifications not appearing on desktop",
        "software", "Low", "Open", "priya.n", "", 8, -4,
        "I only find out about messages when I open Teams. No banners, no sounds.",
        {"app_name": "Microsoft Teams", "operating_system": "Windows 11",
         "behaviour": "Runs but behaves incorrectly", "frequency": "Every single time",
         "recent_change": "Not sure", "started": "More than a week ago",
         "affected_count": "Just me", "impact": "Minor annoyance",
         "already_tried": "Checked Teams notification settings, they look right."},
    ),
    (
        "Password reset for shared reception account",
        "account", "Low", "Closed", "dana.okoro", "demo.tech", 4, None,
        "Nobody on the front desk remembers the reception mailbox password.",
        {"issue_type": "Forgot password", "system_name": "Reception mailbox",
         "worked_before": "Yes, but a while ago", "started": "More than a week ago",
         "affected_count": "My team", "impact": "Working, but slowed down",
         "already_tried": "Tried the three passwords we had written down."},
    ),
    (
        "Scanner produces blank pages",
        "printer", "Medium", "Closed", "tom.alvarez", "sarah.chen", 14, None,
        "Every scan comes through as a blank PDF even though the preview looks right.",
        {"printer_name": "MFP-03, 1st floor", "problem": "Scanner not working",
         "display_error": "", "others_can_print": "Yes, only I have the problem",
         "started": "More than a week ago", "affected_count": "Just me",
         "impact": "Working, but slowed down",
         "already_tried": "Scanned from a different computer, same result."},
    ),
    (
        "Email going to junk for external recipients",
        "email", "High", "Closed", "priya.n", "marcus.webb", 16, None,
        "Several clients report our emails landing in their spam folders.",
        {"client": "Outlook web", "direction": "Sending only",
         "bounce_text": "", "mailbox_full": "No",
         "started": "More than a week ago", "affected_count": "The whole office",
         "impact": "Working, but slowed down",
         "already_tried": "Asked two clients to mark us as safe senders."},
    ),
    (
        "Laptop fan running constantly and very hot",
        "hardware", "High", "Closed", "demo.user", "sarah.chen", 18, None,
        "Fan at full speed all day and the underside is too hot to rest on my lap.",
        {"device_type": "Laptop", "asset_tag": "LT-3390",
         "powers_on": "Yes, normally", "physical_damage": "No",
         "unusual_signs": "Running very hot", "started": "Within the last few days",
         "affected_count": "Just me", "impact": "Working, but slowed down",
         "already_tried": "Closed everything and checked Task Manager."},
    ),
    (
        "Can't open PDFs from the intranet",
        "software", "Low", "Closed", "dana.okoro", "demo.tech", 20, None,
        "Clicking a PDF link on the intranet downloads a file that won't open.",
        {"app_name": "Adobe Acrobat Reader", "operating_system": "Windows 10",
         "behaviour": "Shows an error message",
         "error_text": "The file is damaged and could not be repaired",
         "frequency": "Every single time", "recent_change": "No changes",
         "started": "Within the last few days", "affected_count": "Just me",
         "impact": "Minor annoyance",
         "already_tried": "Tried a different browser."},
    ),
    (
        "VPN drops every twenty minutes",
        "network", "High", "Closed", "tom.alvarez", "marcus.webb", 22, None,
        "VPN disconnects roughly every twenty minutes and I have to reconnect.",
        {"connection_type": "Wi-Fi", "can_reach": "Internal sites only",
         "others_affected": "Just me", "location": "Remote / home office",
         "vpn": "Yes — and it connects", "started": "Within the last few days",
         "affected_count": "Just me", "impact": "Working, but slowed down",
         "already_tried": "Rebooted the home router and reinstalled the client."},
    ),
    (
        "Keyboard missing keystrokes",
        "hardware", "Medium", "Closed", "priya.n", "demo.tech", 25, None,
        "Several letters only register sometimes, mostly E and the spacebar.",
        {"device_type": "Keyboard/Mouse", "powers_on": "Yes, normally",
         "physical_damage": "Yes — other", "unusual_signs": "None",
         "started": "More than a week ago", "affected_count": "Just me",
         "impact": "Working, but slowed down",
         "already_tried": "Tried a different USB port."},
    ),
    (
        "Need access to the archive folder",
        "account", "Low", "Closed", "demo.user", "sarah.chen", 28, None,
        "Working on the annual report and need read access to the archive share.",
        {"issue_type": "Permission denied", "system_name": "Archive share (Z:)",
         "error_text": "You do not have permission to access this folder",
         "worked_before": "No, never had access", "started": "More than a week ago",
         "affected_count": "Just me", "impact": "Working, but slowed down",
         "already_tried": "Asked my manager, who said to raise a ticket."},
    ),
    (
        "Mouse cursor jumps across the screen",
        "hardware", "Low", "Open", "demo.user", "", 4, None,
        "Cursor randomly jumps to a different part of the screen while typing.",
        {"device_type": "Keyboard/Mouse", "powers_on": "Yes, normally",
         "physical_damage": "No", "started": "Within the last few days",
         "affected_count": "Just me", "impact": "Minor annoyance",
         "already_tried": "Cleaned the sensor and changed the battery."},
    ),
    (
        "Software request: Figma licence for design review",
        "other", "Low", "Open", "dana.okoro", "", 6, None,
        "Need a Figma seat to review mockups the agency is sending over.",
        {"what_happened": "Need a Figma licence to review agency mockups.",
         "device_involved": "Work laptop", "started": "Within the last few days",
         "affected_count": "Just me", "impact": "Minor annoyance",
         "already_tried": "Used the free viewer but can't comment."},
    ),
]

# ticket title fragment -> list of (author, minutes_after_creation, body)
COMMENTS = {
    "Laptop won't power on": [
        ("sarah.chen", 45, "Picked this up. Given it's completely dead after an "
                           "update, I suspect the battery rather than the update "
                           "itself. Can you bring it to the desk this afternoon?"),
        ("priya.n", 90, "Dropping it off around 2pm, thanks."),
        ("sarah.chen", 260, "Confirmed — battery isn't charging at all and the "
                            "adapter checks out. Replacement ordered, should be "
                            "here tomorrow. Loaner is at reception for you."),
    ],
    "Outlook stuck": [
        ("demo.tech", 30, "Seeing a few of these this morning. Checking whether "
                          "it's the mail gateway rather than individual clients."),
        ("tom.alvarez", 55, "Two others on my team have the same thing."),
        ("demo.tech", 120, "Confirmed, it's affecting a subset of desktop clients. "
                           "Webmail is unaffected, so please use that in the "
                           "meantime while I work through it."),
    ],
    "Conference room projector": [
        ("dana.okoro", 15, "Adding that the room's wall plate was replaced last "
                           "week, in case that's related."),
    ],
    "Accounting printer": [
        ("demo.tech", 120, "Pulled a shredded sheet out of the rear feed path — "
                           "that was almost certainly the cause. Running a test "
                           "batch now to confirm."),
        ("dana.okoro", 200, "Just printed a ten-page report without a jam. "
                            "Looking good so far."),
    ],
    "Excel crashes": [
        ("sarah.chen", 180, "Could you attach the workbook, or tell me roughly how "
                            "large it is and whether it has external links?"),
        ("demo.user", 240, "About 40MB with links to two other workbooks on the "
                           "finance share."),
    ],
    "Shared drive mapping": [
        ("marcus.webb", 300, "This usually means the mapping is being made before "
                             "the network is ready at sign-in. Going to push a "
                             "script that retries on a short delay."),
    ],
    "Locked out of VPN": [
        ("marcus.webb", 60, "Your VPN profile was still holding the old credentials. "
                            "Cleared it — try connecting again now."),
        ("priya.n", 95, "That did it. Thank you!"),
    ],
    "Email going to junk": [
        ("marcus.webb", 400, "Our SPF record was missing the new mail relay, which "
                             "is why some receivers were flagging us. Updated it; "
                             "propagation takes a few hours."),
    ],
}


# ── Helpers ─────────────────────────────────────────────────────── #

# Tickets that live in the trash. These are the things that actually get
# deleted in real life — duplicates, tests, and misfiled requests — rather
# than real work, which gets closed instead.
#
# (title, category, priority, requester, technician, created_days_ago,
#  deleted_days_ago, deleted_by, description)
DELETED_TICKETS = [
    (
        "Printer on 2nd floor jams constantly",
        "printer", "Medium", "casey.nguyen", "sam.patel", 11, 10, "sam.patel",
        "Submitted twice by mistake — the browser resent the form. Duplicate "
        "of the existing 2nd-floor printer ticket, which is the one being "
        "worked.",
    ),
    (
        "test ticket please ignore",
        "other", "Low", "demo.user", "", 6, 5, "demo.admin",
        "Checking that the new intake form posts correctly. Nothing to action.",
    ),
    (
        "Need a parking permit for the garage",
        "other", "Low", "jordan.lee", "", 28, 26, "demo.admin",
        "Facilities request, not IT. Forwarded to the facilities team and "
        "removed from the IT queue.",
    ),
]


# One pinned announcement plus a little history, so the dashboard banner and
# the past-announcements list both have something to show in the demo.
# (title, body, level, author, days_ago, retired_days_ago or None if pinned)
ANNOUNCEMENTS = [
    (
        "New: ticket archive and trash",
        "Closed tickets now drop off the board after 24 hours and move to the "
        "Archive, where they stay searchable by date and category. Deleting a "
        "ticket sends it to the Trash for 30 days instead of removing it, so a "
        "mis-click is no longer permanent.",
        "info", "demo.admin", 2, None,
    ),
    (
        "Mail server maintenance Saturday",
        "Email will be unavailable Saturday 2-4am while we move to the new "
        "server. Tickets filed during the window will still reach us — you "
        "just won't get the confirmation email until it's back.",
        "warning", "demo.tech", 9, 6,
    ),
    (
        "VPN certificate expired - resolved",
        "The VPN certificate expired overnight and was blocking new "
        "connections. A replacement is deployed and connections are working "
        "again. If you still can't connect, quit the client fully and reopen "
        "it so it picks up the new certificate.",
        "critical", "demo.tech", 21, 19,
    ),
]


# Mirrors generate_ticket_ref in main.py. Duplicated rather than imported
# because importing main.py would start the whole app just to seed a table.
_REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


# ── Job postings ──
#
# grants_role is the app's own role vocabulary, not a job title: three of
# these hire into "Technician", and the manager role hires into "Both",
# which is what this application calls an administrator. Hiring reads this
# field to decide what the invite code grants, so a new posting cannot drift
# out of step with the access it is advertising.

JOB_POSTINGS = [
    (
        "technician-i", "Technician I", "Technician", "Level 1",
        "$42,000 – $52,000",
        "First line of support. You answer the tickets everyone sees first and "
        "resolve most of them before anyone else has to look.",
        "Technician I is where most of our team starts. You own the front of "
        "the queue: password resets, account lockouts, printer and peripheral "
        "faults, software installs, and the steady stream of \"it was working "
        "yesterday\" tickets. You are not expected to know everything on day "
        "one — you are expected to be methodical, to write down what you "
        "tried, and to hand over cleanly when something needs Level 2.",
        "Pick up and triage incoming tickets\n"
        "Resolve password, access and peripheral issues end to end\n"
        "Image and deploy laptops and desktops\n"
        "Keep ticket notes good enough that the next person needs no handover call\n"
        "Escalate with a clear summary of what you have already ruled out",
        "Comfortable with Windows and macOS troubleshooting\n"
        "Clear written English — most of this job is writing\n"
        "Patience with non-technical colleagues having a bad morning\n"
        "No formal experience required; CompTIA A+ or equivalent is welcome",
    ),
    (
        "technician-ii", "Technician II", "Technician", "Level 2",
        "$55,000 – $70,000",
        "Second line. The tickets that arrive at your desk have already "
        "defeated someone competent.",
        "Technician II handles what Level 1 escalates and owns the systems "
        "behind it. Expect networking faults, Active Directory and identity "
        "problems, endpoint management, and the recurring issues nobody has "
        "had time to fix properly. A good part of this role is noticing that "
        "forty tickets share one cause.",
        "Resolve escalations from Level 1 within agreed response times\n"
        "Administer identity, email and endpoint management platforms\n"
        "Diagnose network faults across wired, wireless and VPN\n"
        "Write the knowledge base articles that stop a ticket recurring\n"
        "Mentor Level 1 technicians — in person and in ticket notes",
        "Two or more years in a support role, or one year plus strong evidence\n"
        "Working knowledge of DNS, DHCP, VLANs and VPNs\n"
        "Hands-on with Active Directory or a cloud identity provider\n"
        "Scripting in PowerShell, Bash or Python is an advantage",
    ),
    (
        "technician-iii", "Technician III", "Technician", "Level 3",
        "$75,000 – $95,000",
        "Third line and systems engineering. You fix the causes, not the "
        "tickets.",
        "Technician III is the escalation point of last resort and the person "
        "who makes the next hundred tickets unnecessary. You design and "
        "maintain the infrastructure the other levels work on, lead incident "
        "response when something significant breaks, and are expected to push "
        "back on work that treats symptoms.",
        "Own final escalation for incidents affecting multiple users\n"
        "Design, build and document core infrastructure and automation\n"
        "Lead incident response and write the postmortem afterwards\n"
        "Review and improve how Levels 1 and 2 work, not just what they fix\n"
        "Hold the on-call rota with the rest of the senior team",
        "Five or more years in IT operations or systems engineering\n"
        "Depth in at least one of: networking, identity, virtualisation, cloud\n"
        "Real automation experience — infrastructure as code, not just scripts\n"
        "A track record of reducing ticket volume, with the numbers to show it",
    ),
    (
        "technician-manager", "Technician Manager", "Both", "Management",
        "$95,000 – $125,000",
        "Run the desk. Own the queue, the rota and the careers of the people "
        "working them.",
        "The Technician Manager is accountable for the service the whole team "
        "delivers. You set priorities, hold the service levels, and decide "
        "what the team stops doing. This is a people-first management role: "
        "roughly a third of it is hiring, one-to-ones and development, and we "
        "would rather you were excellent at that than the best engineer in the "
        "room. This role carries administrator access to this application.",
        "Own service levels, queue health and the on-call rota\n"
        "Hire, onboard and develop technicians across all three levels\n"
        "Hold regular one-to-ones and run honest performance conversations\n"
        "Report on volume, resolution times and recurring causes to leadership\n"
        "Administer this platform: accounts, roles, invite codes and announcements",
        "Three or more years leading a support or operations team\n"
        "A credible technical background — enough to tell good work from plausible work\n"
        "Experience owning service levels and reporting against them\n"
        "Evidence of developing people into their next role",
    ),
]


def _make_ref(used: set) -> str:
    while True:
        ref = "TK-" + "".join(random.choice(_REF_ALPHABET) for _ in range(4))
        if ref not in used:
            used.add(ref)
            return ref


# Chat threads. One answered queue thread, one still waiting to be picked
# up, and one direct message between two technicians — so the widget shows
# every state it supports.
# (kind, opener, other, minutes_ago, [(sender, body), ...])
CONVERSATIONS = [
    (
        "helpdesk", "tom.alvarez", "sarah.chen", 42,
        [
            ("tom.alvarez", "Morning — the shared drive is asking me for a "
                            "password that it never used to."),
            ("sarah.chen", "That'll be the credential cache after the server "
                           "move. Can you try disconnecting the drive and "
                           "reconnecting it?"),
            ("tom.alvarez", "That did it, thank you!"),
        ],
    ),
    (
        "helpdesk", "priya.n", "", 4,
        [
            ("priya.n", "Hi, is anyone around? My headset isn't being picked "
                        "up in Teams and I have a call at 11."),
        ],
    ),
    (
        "direct", "marcus.webb", "sarah.chen", 18,
        [
            ("marcus.webb", "Are you still on the projector ticket in the "
                            "conference room? I'm nearby if you want a hand."),
            ("sarah.chen", "Yes please — the cable tests fine so I think it's "
                           "the input board."),
        ],
    ),
]


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def wipe(db) -> None:
    """Remove all demo content. Order matters for foreign keys."""
    for model in (CommentDB, AttachmentDB, TicketDB, InviteCodeDB, UserDB,
                  ArticleDB, AnnouncementDB, MessageDB, ConversationDB,
                  ApplicationEEODB, ApplicationDB, JobPostingDB):
        db.query(model).delete()
    db.commit()


def seed(db) -> dict:
    """Create users, tickets, comments and knowledge base articles."""
    now = _now()
    used_refs: set = set()
    counts = {"users": 0, "tickets": 0, "comments": 0, "articles": 0,
              "deleted": 0, "announcements": 0, "conversations": 0}

    # ── Users ──
    for name, email, role, _advertised in USERS:
        db.add(UserDB(
            name=name, email=email, role=role,
            password_hash=hash_password(DEMO_PASSWORD),
            created_at=_iso(now - timedelta(days=45)),
            requested_role="", failed_logins=0, locked_until="",
            terms_version=TERMS_VERSION, terms_accepted_at=_iso(now - timedelta(days=45)),
        ))
        counts["users"] += 1

    # One pending technician request, so the admin page has something to show
    db.add(UserDB(
        name="alex.rivera", email="a.rivera@demo.local", role="Requester",
        password_hash=hash_password(DEMO_PASSWORD),
        created_at=_iso(now - timedelta(days=1)),
        requested_role="Technician", failed_logins=0, locked_until="",
        terms_version=TERMS_VERSION, terms_accepted_at=_iso(now - timedelta(days=1)),
    ))
    counts["users"] += 1
    db.commit()

    # ── Knowledge base ──
    kb_time = _iso(now - timedelta(days=40))
    for article in SEED_ARTICLES:
        db.add(ArticleDB(**article, created_at=kb_time, updated_at=kb_time))
        counts["articles"] += 1
    db.commit()

    # ── Tickets ──
    title_to_id = {}
    for (title, category, priority, status, requester, technician,
         days_ago, due_in, description, survey) in TICKETS:

        created = now - timedelta(days=days_ago,
                                  hours=random.randint(0, 8),
                                  minutes=random.randint(0, 59))
        created_iso = _iso(created)

        history = [
            f"[{created_iso}] Created by {requester} (role: Requester)",
        ]
        if survey:
            history.append(
                f"[{created_iso}] Intake survey completed ({len(survey)} answers)"
            )

        # A ticket created two days ago can't have been claimed and closed
        # 90 hours later, so every derived time is pinned to the past.
        def _past(dt, floor):
            return min(dt, now - timedelta(minutes=5)) if dt > now else max(dt, floor)

        updated = created
        if technician:
            claimed = _past(created + timedelta(hours=random.randint(1, 20)), created)
            history.append(f"[{_iso(claimed)}] Claimed by {technician}")
            history.append(
                f"[{_iso(claimed)}] Status: Open -> In Progress (auto, on claim)"
            )
            updated = claimed

        closed_at = ""
        if status == "Closed":
            closed = _past(updated + timedelta(hours=random.randint(4, 72)), updated)
            history.append(
                f"[{_iso(closed)}] Status: In Progress -> Closed (by {technician})"
            )
            updated = closed
            closed_at = _iso(closed)

        due_date = ""
        if due_in is not None:
            due_date = (now + timedelta(days=due_in)).date().isoformat()

        ticket = TicketDB(
            title=title, description=description, status=status,
            priority=priority, created_at=created_iso, updated_at=_iso(updated),
            requester=requester, technician=technician, due_date=due_date,
            category=category, survey=survey, history=history,
            closed_at=closed_at, ref=_make_ref(used_refs),
        )
        db.add(ticket)
        db.flush()                      # assign the id without committing
        title_to_id[title] = (ticket.id, created, ticket)
        counts["tickets"] += 1

    db.commit()

    # ── Comments ──
    for fragment, thread in COMMENTS.items():
        match = next(
            ((tid, created, t) for title, (tid, created, t) in title_to_id.items()
             if fragment in title),
            None,
        )
        if not match:
            continue
        ticket_id, created, ticket = match

        latest = None
        for author, minutes, body in thread:
            at = created + timedelta(minutes=minutes)
            role = "Technician" if author in TECHS else "Requester"
            db.add(CommentDB(
                ticket_id=ticket_id, author=author, author_role=role,
                body=body, created_at=_iso(at),
            ))
            ticket.history = list(ticket.history or []) + [
                f"[{_iso(at)}] Comment added by {author}"
            ]
            counts["comments"] += 1
            latest = at

        # Keep updated_at consistent with the newest comment
        if latest and _iso(latest) > str(ticket.updated_at):
            ticket.updated_at = _iso(latest)

    db.commit()

    # ── Announcements ──
    for title, body, level, author, days_ago, retired_days in ANNOUNCEMENTS:
        created = now - timedelta(days=days_ago, hours=random.randint(0, 10))
        retired = ("" if retired_days is None
                   else _iso(now - timedelta(days=retired_days)))
        db.add(AnnouncementDB(
            title=title, body=body, level=level, author=author,
            created_at=_iso(created), updated_at=_iso(created),
            retired_at=retired,
        ))
        counts["announcements"] += 1

    db.commit()

    # ── Chat ──
    for kind, opener, other, minutes_ago, lines in CONVERSATIONS:
        start = now - timedelta(minutes=minutes_ago)
        convo = ConversationDB(
            kind=kind, requester=opener, technician=other, subject="",
            created_at=_iso(start), updated_at=_iso(start),
            # The opener has read their own thread. An unclaimed queue thread
            # has never been opened by staff, so it shows unread in the queue.
            requester_read_at=_iso(now),
            technician_read_at=_iso(now) if other else "",
        )
        db.add(convo)
        db.flush()

        when = start
        for sender, body in lines:
            db.add(MessageDB(conversation_id=convo.id, sender=sender,
                             body=body, created_at=_iso(when)))
            when += timedelta(minutes=random.randint(1, 6))
        convo.updated_at = _iso(min(when, now))
        counts["conversations"] += 1

    db.commit()

    # ── Trash ──
    for (title, category, priority, requester, technician,
         days_ago, deleted_days_ago, deleted_by, description) in DELETED_TICKETS:
        created = now - timedelta(days=days_ago, hours=random.randint(0, 8))
        deleted = now - timedelta(days=deleted_days_ago, hours=random.randint(0, 8))
        db.add(TicketDB(
            title=title, description=description, status="Open",
            priority=priority, created_at=_iso(created), updated_at=_iso(deleted),
            requester=requester, technician=technician, due_date="",
            category=category, survey=None, ref=_make_ref(used_refs),
            deleted_at=_iso(deleted), deleted_by=deleted_by,
            history=[
                f"[{_iso(created)}] Created by {requester} (role: Requester)",
                f"[{_iso(deleted)}] Moved to trash by {deleted_by}",
            ],
        ))
        counts["deleted"] += 1

    db.commit()

    # ── Job postings ──
    for slug, title, grants, level, salary, summary, desc, resp, reqs in JOB_POSTINGS:
        db.add(JobPostingDB(
            slug=slug, title=title, grants_role=grants, level=level,
            location="Hybrid — Chicago, IL", employment_type="Full-time",
            salary_range=salary, summary=summary, description=desc,
            responsibilities=resp, requirements=reqs,
            created_by="demo.admin",
            created_at=_iso(now - timedelta(days=21)),
            updated_at=_iso(now - timedelta(days=21)),
            closed_at="",
        ))
        counts["jobs"] = counts.get("jobs", 0) + 1

    db.commit()
    return counts


def reseed(db) -> dict:
    """Wipe and recreate in one transaction-ish pass.

    Called by the scheduled reset endpoint as well as the CLI. Keeping the
    window where the database is empty as short as possible matters: a
    visitor registering during that window would trip the
    first-account-becomes-admin bootstrap.
    """
    wipe(db)
    return seed(db)


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed demo data.")
    parser.add_argument("--reset", action="store_true",
                        help="wipe existing data first")
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)
    migrate()

    db = SessionLocal()
    try:
        existing = db.query(UserDB).count()
        if existing and not args.reset:
            print(f"Database already has {existing} user(s). "
                  f"Use --reset to wipe and reseed.")
            return 0

        counts = reseed(db) if args.reset else seed(db)

        print("Demo data created:")
        for key in ("users", "tickets", "comments", "articles", "deleted",
                    "announcements", "conversations"):
            label = "tickets in trash" if key == "deleted" else key
            print(f"  {counts[key]:>3} {label}")
        print()
        print("Demo accounts (password for all: " + DEMO_PASSWORD + ")")
        for name, _email, role, advertised in USERS:
            if advertised:
                print(f"  {name:<12} {role}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())