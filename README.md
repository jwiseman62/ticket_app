# Tech Help

A help desk application for small IT teams. Requesters file tickets through a
guided intake flow, technicians claim and resolve them, and admins manage
accounts and access.

Built with **FastAPI** (Python) and **React** — plain CSS, no UI framework.

> Originally a Tkinter desktop application, rebuilt as a web app.

---

## Live demo

**[View the live demo →](https://your-demo-url.vercel.app)**
<!-- Replace the URL above once deployed. See DEPLOYMENT.md. -->

Sign in with one click as any role — no signup needed:

| Role | Username | Password |
|---|---|---|
| Admin | `demo.admin` | `demo1234` |
| Technician | `demo.tech` | `demo1234` |
| Requester | `demo.user` | `demo1234` |

Demo data resets nightly, so feel free to change or delete anything. The
backend sleeps when idle, so the first load may take about 30 seconds while it
wakes.

Deploying your own copy: see **[DEPLOYMENT.md](DEPLOYMENT.md)**.

---

## Contents

- [Live demo](#live-demo)
- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [First run](#first-run)
- [Roles and permissions](#roles-and-permissions)
- [How technicians get access](#how-technicians-get-access)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [Admin CLI](#admin-cli)
- [API reference](#api-reference)
- [Development](#development)
- [Deployment](#deployment)
- [Mobile](#mobile)

---

## What it does

### Guided ticket intake

Rather than dropping people into a blank form, new tickets go through a short
wizard: pick a category, answer a few targeted questions, then describe the
problem.

Seven categories — Hardware, Software, Network, Account/Access, Printer, Email,
and Something else — each with its own question set, plus four questions asked
every time (when it started, how many people are affected, business impact, what
you already tried).

Two things fall out of those answers:

- **A suggested priority.** Answers carry hidden weights — "burning smell" and
  "whole office affected" score high, minor annoyances score zero. The suggestion
  is applied automatically but backs off the moment the user overrides it.
- **Knowledge base matches.** As the form fills in, matching articles surface
  inline, so a known fix can deflect the ticket before it's ever submitted.

The whole survey is skippable.

### Ticket management

- Search and filter by status, priority, and view (All / Mine / Assigned to me / **Unassigned**)
- **One-click Claim** — assigns the ticket to you and moves it to In Progress
- Quick Start / Close / Reopen straight from the list, without opening the ticket
- Sort by ID, priority, due date, or **longest untouched**
- Full audit history — every field change is logged with who and when
- Threaded comments between requester and technician
- File attachments with drag-and-drop and inline image previews
- CSV export of the current filtered view
- Deleting is a soft delete — tickets go to the trash, not away

### Ticket references

Tickets are identified by a short code like **TK-AC43** rather than a
sequential number. People read these aloud and type them from memory, so the
alphabet leaves out the characters that get confused — 0/O and 1/I/L — giving
31 symbols and 31⁴ = 923,521 combinations.

Codes are random rather than sequential, which means collisions are possible:
by the birthday bound a few thousand tickets give a real chance of one. The
generator checks and retries, so it never hands out a duplicate. A sequential
id also leaks how many tickets exist, which a random code doesn't.

### Email verification

Requesters confirm their address with a 6-digit code at signup, and again
after `VERIFICATION_IDLE_DAYS` (30) of not signing in. Technicians and admins
are exempt by design: locking a technician out of an incident because a code
didn't arrive is worse than the risk it guards against.

Off by default, and it refuses to switch on without a working mail provider —
enforcing it with nowhere to send the code would lock every new user out
permanently. Demo accounts are exempt whenever `DEMO_MODE` is on, so the live
demo's one-click logins keep working.

Codes are stored as SHA-256 hashes, expire after 15 minutes, and lock out
after 5 wrong attempts. Wrong code, expired code and unknown username all
return the same message, so the endpoint can't be used to discover accounts.

### Live chat

A bubble in the bottom-right corner of every signed-in page. Anyone can
message anyone: a **New message** button opens a searchable list of people,
with staff listed first because that's who a requester usually wants.

Requesters also get **Helpdesk** pinned at the top of that list — a thread
with no named recipient that lands in a shared queue, where the first
technician to reply owns it. Answering and claiming are one action rather
than two. Someone with a broken laptop shouldn't have to know who's on shift.

**Who can see what.** Queue threads are visible to every technician — that's
what makes a queue a queue, and handover is normal. Direct threads are
private to their two people, admins included. Once anyone can message anyone,
"staff see everything" would mean technicians reading each other's messages.

Read markers are keyed by *position in the thread*, not by role. Keying them
off role worked only while every thread was one requester and one technician;
two technicians talking are both staff and would have shared a single marker,
so each would have seen the other's reads as their own.

**Polled, not socketed.** Render's free tier sleeps after 15 minutes of
silence, which drops every open WebSocket and means reconnect handling plus a
cold start before the first message lands. A 3-second poll while a thread is
open is imperceptible in a helpdesk conversation, and each poll doubles as
the keep-alive a socket would need a heartbeat for. Polling drops to 15
seconds when the panel is closed and stops entirely when the tab is hidden.

Messages page by id rather than timestamp. Timestamps here have one-second
granularity, so two messages sent in the same second are indistinguishable —
a timestamp cursor would repeat one or skip one.

The widget is mounted beside the router, not inside a layout: every route
builds its own layout instance, so anything living there is remounted on each
navigation, which would collapse the panel and drop the open thread.

### Announcements

Technicians and admins can post a notice that everyone with an account sees at
the top of their dashboard, and that is emailed to every user with an address — scheduled maintenance, an outage, a change of
process. Three levels (information, heads-up, urgent) set the colour, and
nothing else.

Exactly one announcement is pinned at a time. Rather than a flag two rows
could both hold, "pinned" is derived: the newest row whose `retired_at` is
empty. Posting a new one retires the previous, so the invariant is enforced at
the single place that can break it. Retired announcements stay as history
rather than being deleted, so "what did they say about the migration?" is
still answerable.

When nothing is pinned, the banner renders nothing at all for requesters — an
empty box announcing the absence of announcements would take the most valuable
space on the page to say nothing. Technicians see a quiet prompt to post one.

### Archive and trash

Closed tickets stay on the board for 24 hours so the people involved still see
them, then drop off into the **Archive**, where they are kept indefinitely and
searchable by text, category, and the date they were closed. The point is the
question every IT team asks eventually — *didn't we fix this before?*

Archived tickets leave the dashboard counters too, so **Closed** reads as "closed
in the last 24 hours" and drains on its own rather than climbing forever. The
running total moves to an **Archived** tile that links straight to the archive,
so the history stays one click away.

Deleting a ticket doesn't destroy it. It goes to the **Trash** for 30 days,
visible to technicians and admins, with a countdown and a one-click restore
that brings back its comments and attachments. Only an admin can delete
something for good, and only from the trash, so no single click can lose
real work. Expired items are purged automatically the next time the trash is
opened, which keeps the retention promise without needing a scheduled job.

Both windows are configurable: `CLOSED_GRACE_DAYS` and `TRASH_RETENTION_DAYS`.

### Knowledge base

Six troubleshooting articles ship seeded — one per category, covering dead
devices, crashing apps, network drops, lockouts, printers, and email. Admins can
add, edit, and delete articles. The same articles power the inline suggestions
during ticket intake.

### Dashboard

Ticket counts by status, priority, and category, overdue tracking, and a recent
activity table.

### Admin

A dedicated page with account management and technician access codes with QR
generation. Admins can **create accounts outright** — picking the role at
creation time rather than waiting for someone to sign up and then promoting
them — as well as change roles and emails, reset passwords, and delete
accounts.

Deleting an account unassigns that person's tickets (including any sitting in
the trash, so a restore doesn't resurrect a dead assignment) and leaves
requester names in place as a historical record. You can't delete your own
account or the last remaining admin.

### Throughout

- Light and dark themes, following your OS by default, with no flash on load
- Email notifications to the people actually on a ticket
- Responsive down to phone width
- Keyboard-friendly, WCAG AA contrast in both themes

---

## Quick start

**Requirements:** Python 3.9+, Node.js 18+

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

→ API at **http://localhost:8000**
→ Interactive docs at **http://localhost:8000/docs**

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

→ App at **http://localhost:5173**

Vite proxies `/api/*` to the backend automatically, so you only ever open port
5173 in the browser.

Both servers need to stay running.

---

## First run

The database and schema are created automatically on first startup — there's no
migration step to run.

**The first account you register becomes the administrator.** This is
deliberate: roles are assigned by the server, never chosen by the client, so
without that bootstrap nobody could ever grant the first admin. Every account
after the first starts as a Requester.

If you lose access, the [admin CLI](#admin-cli) can reset a password or promote
an account from the terminal.

---

## Roles and permissions

| | Requester | Technician | Admin (`Both`) |
|---|:---:|:---:|:---:|
| File tickets | ✓ | ✓ | ✓ |
| See own tickets | ✓ | ✓ | ✓ |
| See all tickets | ✓ | ✓ | ✓ |
| Claim unassigned tickets | — | ✓ | ✓ |
| Change status to Closed | — | ✓ | ✓ |
| Delete tickets | — | ✓ | ✓ |
| Comment and attach files | ✓ | ✓ | ✓ |
| Edit knowledge base | — | — | ✓ |
| Manage users and roles | — | — | ✓ |
| Issue access codes | — | — | ✓ |

Requesters can't reassign the requester field on a ticket, and technicians can't
change who reported it — that stays as the historical record.

---

## How technicians get access

Self-service signup can't grant elevated roles, so technician access is issued
deliberately:

1. **Sign up as a Technician.** The register page offers Requester or Technician.
   Picking Technician creates a normal Requester account and records the request —
   it grants nothing on its own.
2. **An admin approves it.** Pending requests appear on the Admin page. One click
   mints a single-use access code and renders it as a QR code, which can be
   downloaded, copied, or sent as a link.
3. **The technician redeems it.** Scanning the QR opens `/redeem` with the code
   filled in. After signing in, the role is upgraded.

Codes are single-use by default, expire after 14 days, can be locked to one
specific username, and can be revoked at any time. Codes use an alphabet with no
`0`/`O`/`1`/`I`/`L`, and input is normalized — `tech a7k2 9xqp` works the same as
`TECH-A7K2-9XQP`.

Codes can also be issued from the terminal:

```bash
python manage.py pending                  # who's waiting
python manage.py invite Technician sam    # mint a code for sam
```

---

## Project structure

```
ticket_app/
├── README.md
├── DEPLOYMENT.md                Step-by-step live deployment guide
├── render.yaml                  Render blueprint (backend)
├── .gitignore
│
├── .github/workflows/
│   └── reset-demo.yml           Nightly demo reset
│
├── backend/                     FastAPI REST API
│   ├── main.py                  All routes
│   ├── models.py                SQLAlchemy 2.0 ORM + Pydantic schemas
│   ├── auth.py                  JWT, password hashing, lockout
│   ├── database.py              Engine, session, lightweight migrations
│   ├── email_utils.py           SMTP notifications
│   ├── seed_articles.py         Default knowledge base content
│   ├── seed_demo.py             Demo data for the public demo
│   ├── manage.py                Admin CLI
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/                    React single-page app
    ├── package.json
    ├── vercel.json              Vercel config (SPA rewrite)
    ├── vite.config.js
    ├── eslint.config.js
    ├── index.html
    └── src/
        ├── main.jsx             Entry point
        ├── App.jsx              Routing + layout guards
        ├── api.js               fetch wrapper, all API calls
        ├── styles.css           All styling (CSS variables, theming)
        ├── config/
        │   └── surveys.js       Survey questions and priority weights
        ├── context/
        │   ├── AuthContext.jsx  Session state
        │   ├── ThemeContext.jsx Light/dark
        │   ├── ToastContext.jsx Notifications
        │   └── ConfirmContext.jsx  Confirmation dialogs
        ├── utils/
        │   └── dates.js         UTC → local time formatting
        ├── pages/
        │   ├── Landing.jsx      Public marketing page
        │   ├── Login.jsx
        │   ├── Register.jsx
        │   ├── Home.jsx         Stats dashboard
        │   ├── NewTicket.jsx    Guided intake wizard
        │   ├── Dashboard.jsx    Ticket list (full width)
        │   ├── TicketDetail.jsx One ticket, at /tickets/:id
        │   ├── Announcements.jsx Compose + history
        │   ├── Archive.jsx      Resolved tickets + trash
        │   ├── KnowledgeBase.jsx
        │   ├── Profile.jsx
        │   ├── Admin.jsx        Users + access codes
        │   └── Redeem.jsx       QR landing page
        └── components/
            ├── ChatWidget.jsx   Floating messenger
            ├── TicketForm.jsx   Tabbed ticket detail
            ├── SurveyStep.jsx   Survey question renderer
            ├── SurveyAnswers.jsx  Read-only answers view
            ├── ArticleSuggestions.jsx
            ├── Comments.jsx
            ├── Attachments.jsx
            ├── HistoryTimeline.jsx
            ├── UserManagement.jsx
            ├── InviteManager.jsx
            ├── Navbar.jsx
            ├── ErrorBoundary.jsx
            ├── EmptyState.jsx
            └── Skeleton.jsx
```

### A note on the ORM style

`models.py` uses SQLAlchemy 2.0's `Mapped[str]` / `mapped_column()` syntax rather
than the older bare `Column()` assignments. This is intentional: with
`name = Column(String)`, type checkers see the attribute as `Column[str]` instead
of `str`, producing dozens of false errors on perfectly valid code. The generated
database schema is identical.

**Keep new models consistent with that style** — mixing the two breaks the file
at import time.

---

## Configuration

Copy `backend/.env.example` to `backend/.env` and fill in what you need. Every
value is optional for local development.

| Variable | Purpose |
|---|---|
| `JWT_SECRET_KEY` | Signs login tokens. If unset, one is generated and saved to `backend/.jwt_secret` on first run. **Set this explicitly in production.** |
| `SMTP_HOST` | Mail server. Leave blank to disable email entirely. |
| `SMTP_PORT` | Defaults to `587`. |
| `SMTP_USER` / `SMTP_PASSWORD` | SMTP credentials, if your server requires them. |
| `SMTP_FROM` | Sender address. |
| `NOTIFY_EMAIL` | Optional ops inbox that receives a copy of every notification. |
| `DATABASE_URL` | Unset uses SQLite. Set a `postgres://` URL to use PostgreSQL; the scheme is rewritten for psycopg 3 and `?sslmode=require` is preserved. |
| `CORS_ORIGINS` | Comma-separated origins allowed to call the API. Must match the browser's origin exactly — `localhost` and `127.0.0.1` differ. |
| `STORE_UPLOADS_IN_DB` | `true` stores attachment bytes in the database instead of on disk. Needed on hosts with ephemeral filesystems. |
| `MAX_UPLOAD_MB` | Upload size cap. Defaults to 10. |
| `RESEND_API_KEY` | Enables email. Unset means every send is a silent no-op. |
| `MAIL_FROM` | Sender address. Needs a verified domain to reach anyone but yourself. |
| `REQUIRE_EMAIL_VERIFICATION` | Gate requesters behind a 6-digit code. Defaults to false. |
| `VERIFICATION_IDLE_DAYS` | Days idle before a verified requester re-verifies. Defaults to 30. |
| `CLOSED_GRACE_DAYS` | How long a closed ticket stays on the board and in the dashboard counters before moving to the archive. Defaults to 1 (24 hours). |
| `TRASH_RETENTION_DAYS` | How long a deleted ticket is recoverable. Defaults to 30. |
| `DEMO_MODE` | Enables the demo reset endpoint. |
| `DEMO_RESET_TOKEN` | Shared secret for `POST /admin/reset-demo`. |

Load it with:

```bash
export $(cat .env | xargs) && uvicorn main:app --reload
```

### Who gets notified

Notifications go to the people on the ticket — the requester and the assigned
technician — using the email address on their account. Nobody is emailed about
their own comment. `NOTIFY_EMAIL` is a bcc-style copy, not the primary recipient.

Accounts with no email address on file receive nothing. The Admin page flags
these, and users can set their own on the Profile page.

### Security defaults

| Setting | Value | Where |
|---|---|---|
| Minimum password length | 8 characters | `models.py` |
| Failed logins before lockout | 5 | `auth.py` |
| Lockout duration | 15 minutes | `auth.py` |
| Session token lifetime | 8 hours | `auth.py` |
| Maximum upload size | 10 MB | `main.py` |

Passwords are hashed with PBKDF2-SHA256 (260,000 iterations, per-password salt).
Login responses are identical whether or not the username exists, so the endpoint
can't be used to enumerate accounts. Uploads are restricted to an extension
allowlist.

---

## Admin CLI

`manage.py` handles account recovery and role changes without the web UI — useful
when you're locked out or onboarding in bulk.

```bash
cd backend
source .venv/bin/activate

python manage.py list                        # all accounts, roles, lock status
python manage.py whoami                      # guess which account is yours
python manage.py reset <username>            # set a new password
python manage.py promote <username> [role]   # change role (default: admin)
python manage.py unlock <username>           # clear a login lockout
python manage.py create-admin <name> <email> # new admin from scratch
python manage.py pending                     # technician requests awaiting approval
python manage.py invite [role] [username]    # mint an access code
```

Passwords are hashed one-way and can't be recovered — `reset` sets a new one.
Username matching is case-insensitive.

---

## API reference

Interactive documentation is generated automatically at
**http://localhost:8000/docs** while the server is running.

All endpoints except `/auth/register` and `/auth/login` require a bearer token.

### Authentication

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/register` | Role is server-assigned, never client-chosen |
| `POST` | `/auth/login` | Returns a JWT; rate limited |
| `GET` | `/auth/me` | Current user |

### Tickets

| Method | Path | Notes |
|---|---|---|
| `GET` | `/tickets` | Supports `search`, `status_filter`, `priority_filter`, `view` |
| `POST` | `/tickets` | |
| `GET` | `/tickets/{id}` | |
| `PUT` | `/tickets/{id}` | Full update, writes a field-level history entry |
| `PATCH` | `/tickets/{id}/status` | Status only |
| `POST` | `/tickets/{id}/claim` | Assign to self, auto-advances to In Progress |
| `DELETE` | `/tickets/{id}` | Technician or admin. Soft delete — moves to the trash |
| `GET` | `/tickets/export/csv` | Honors the same filters |
| `POST` | `/auth/verify` | Exchange a 6-digit code for a token |
| `POST` | `/auth/resend-code` | Send another code. Always reports success |
| `GET` | `/chat/poll` | Badge counts and thread list in one request |
| `GET` | `/chat/conversations` | Threads. Requesters see only their own |
| `GET` | `/chat/people` | Who you can message, staff first. `search` filters |
| `POST` | `/chat/conversations` | Open a thread. `to` empty means the queue — requesters only |
| `GET` | `/chat/conversations/{id}/messages` | `after_id` for incremental polling |
| `POST` | `/chat/conversations/{id}/messages` | Send. A staff reply claims an unclaimed thread |
| `POST` | `/chat/conversations/{id}/close` | Staff close queue threads; either person closes a direct one |
| `GET` | `/announcements/current` | The pinned notice, or null. Any signed-in user |
| `GET` | `/announcements` | Pinned plus history, newest first |
| `POST` | `/announcements` | Technician or admin. Retires the previous notice |
| `PUT` | `/announcements/{id}` | Technician or admin. Edits in place, leaving the pin alone |
| `POST` | `/announcements/{id}/retire` | Technician or admin. Takes it off the dashboard, keeps the history |
| `DELETE` | `/announcements/{id}` | **Admin only.** Removes it from the history for good |
| `GET` | `/tickets/archive` | Closed tickets. `search`, `category`, `date_from`, `date_to`, `technician`, `limit` |
| `GET` | `/tickets/trash` | Technician or admin. Purges expired items first |
| `POST` | `/tickets/{id}/restore` | Technician or admin. Brings a ticket back from the trash |
| `DELETE` | `/tickets/{id}/permanent` | **Admin only.** Irreversible, and only for tickets already in the trash |
| `POST` | `/tickets/purge-deleted` | Admin only. Removes everything past its retention window |

### Comments and attachments

| Method | Path |
|---|---|
| `GET` / `POST` | `/tickets/{id}/comments` |
| `DELETE` | `/comments/{id}` |
| `GET` / `POST` | `/tickets/{id}/attachments` |
| `GET` / `DELETE` | `/attachments/{id}` |

### Knowledge base

| Method | Path | Notes |
|---|---|---|
| `GET` | `/articles` | Supports `search`, `category` |
| `GET` | `/articles/suggest` | Ranked matches for a category and free text |
| `GET` | `/articles/{id}` | |
| `POST` / `PUT` / `DELETE` | `/articles[/{id}]` | Admin only |

### Users and access

| Method | Path | Notes |
|---|---|---|
| `POST` | `/users` | **Admin only.** Create an account with a role. Usernames are unique case-insensitively |
| `GET` | `/users` | Emails visible to admins only |
| `GET` | `/users/pending` | Technician requests — admin only |
| `PUT` | `/users/{id}/role` | Admin only |
| `PUT` | `/users/{id}/email` | Own account, or any as admin |
| `PUT` | `/users/me/password` | |
| `PUT` | `/users/{id}/password` | Own account, or any as admin |
| `DELETE` | `/users/{id}` | Admin only; unassigns their tickets |
| `GET` / `POST` | `/invites` | Admin only |
| `POST` | `/invites/redeem` | Rate limited |
| `DELETE` | `/invites/{id}` | Revoke |

### Stats and operations

| Method | Path | Notes |
|---|---|---|
| `GET` | `/stats` | Dashboard counts |
| `GET` | `/health` | Liveness probe; no auth required |
| `POST` | `/admin/reset-demo` | Demo mode only; requires `X-Reset-Token` |

---

## Development

### Linting

```bash
cd frontend
npm run lint
```

ESLint is configured with the React and hooks plugins. It catches undefined
variables and malformed JSX — classes of bug that `npm run build` passes straight
through, because Vite doesn't verify that component names resolve. Worth running
before every commit.

### Dependency versions

`package.json` pins a deliberate combination:

- **Vite 7** — the highest version `@vitejs/plugin-react` supports. Vite 8 breaks
  the peer dependency and leaves the tree unresolvable.
- **React Router 7** — patches an open-redirect advisory present in v6.

This combination reports zero `npm audit` vulnerabilities. **Don't run
`npm audit fix --force`** — it will push Vite to 8 and break the install.
`package-lock.json` is committed to keep this reproducible.

### Database changes

`database.py` runs a small `migrate()` function on startup that adds columns
introduced after the initial release. SQLAlchemy's `create_all()` only creates
missing *tables*, never missing *columns*, so existing databases need that nudge.

Adding a new column means adding a matching guard there. For anything more
involved, consider Alembic.

To start over, delete `backend/tickets.db` — it's recreated on the next launch.

---

## Deployment

| Layer | Simple | Scalable |
|---|---|---|
| Backend | `uvicorn main:app` behind Nginx | Render, Railway, Fly.io |
| Frontend | `npm run build`, serve `dist/` | Vercel, Netlify |
| Database | SQLite (fine for a small team) | PostgreSQL |

Before deploying:

1. **Set `JWT_SECRET_KEY`** to a fixed value. Without it, a generated key is
   written to disk, and losing that file signs everyone out.
2. **Update CORS.** `main.py` allows `localhost:5173` and `localhost:3000`. Add
   your real origin.
3. **Point the frontend at the API.** The `/api` proxy in `vite.config.js` only
   applies to the dev server. A production build needs an absolute API URL.
4. **Move uploads off local disk** if running more than one instance —
   `backend/uploads/` is local to each machine.

### Switching to PostgreSQL

Set `DATABASE_URL` and restart — no code changes needed. `psycopg[binary]` is
already in `requirements.txt`, SQLite-only engine arguments are applied
conditionally, and `migrate()` uses SQLAlchemy's dialect-neutral inspector.

```bash
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
```

Serverless Postgres (Neon, Supabase) suspends compute when idle, which kills
pooled connections; the engine enables `pool_pre_ping` on non-SQLite backends
so the first request after a nap reconnects instead of erroring.

---

## Pages

Three separate URLs do what one crowded page used to:

| Route | File | What it's for |
|---|---|---|
| `/dashboard` | `Home.jsx` | Stats, charts, recent activity |
| `/tickets` | `Dashboard.jsx` | The ticket list, full width — filter, sort, claim, export |
| `/tickets/:id` | `TicketDetail.jsx` | One ticket: details, survey, comments, files, history |
| `/new` | `NewTicket.jsx` | Guided intake wizard |
| `/announcements` | `Announcements.jsx` | Post a notice; read the history |
| `/archive` | `Archive.jsx` | Resolved tickets and the trash |

`/tickets` used to hold the list *and* a permanently-open blank creation form,
which squeezed the list into a 310px sidebar and meant a ticket could never be
linked to. Creating now has its own page, and so does each ticket — so a ticket
URL can be bookmarked, shared, or opened in a new tab.

> The file names lag the routes: `Home.jsx` serves `/dashboard` and
> `Dashboard.jsx` serves `/tickets`. Renaming them is a worthwhile tidy-up, but
> it touches imports in several places, so it hasn't been done yet.

---

## Demoing on another device (Tailscale)

For showing the app on your phone, or to someone across the country, without
deploying it anywhere. Tailscale puts your devices on a private network and
gives this machine an HTTPS address only those devices can reach.

**One-time setup**

1. Install Tailscale on this Mac and on the device you want to demo from.
2. Sign in to both with the same account.

**Each time you demo**

```bash
# terminal 1 — backend
cd backend && source ../.venv/bin/activate && uvicorn main:app --reload

# terminal 2 — frontend
cd frontend && npm run dev

# terminal 3 — share it
tailscale serve 5173
```

The last command prints the address to open, of the form:

```
https://<this-machine>.<your-tailnet>.ts.net/
```

Open that on any device signed into your tailnet. When you're done,
`tailscale serve off`.

**Why only the frontend gets shared.** Vite already proxies `/api` to the
backend on port 8000, so both halves of the app answer on one address. That
means one origin — no `CORS_ORIGINS` to set, no `VITE_API_URL` to bake in, and
nothing to undo afterwards. Sharing the two ports separately would need both.

`vite.config.js` allows `.ts.net` hostnames for this reason. Without that,
Vite refuses the request with *"Blocked request. This host is not allowed"* —
it only trusts `localhost` by default.

**If you get a 502.** Tailscale is fine — that error means it reached your Mac
but nothing answered on `127.0.0.1:5173`. Two things cause it, and the config
in this repo prevents both:

*The dev server was listening on IPv6 only.* Vite's default host is
`localhost`, which Node 17+ resolves to `::1` before `127.0.0.1`, so Vite binds
IPv6 while `tailscale serve` connects over IPv4. `lsof -i :5173` shows it:

```
node  7463  you  19u  IPv6  ...  TCP localhost:5173 (LISTEN)
                       ^^^^  this should say IPv4
```

`vite.config.js` sets `host: '127.0.0.1'` to force IPv4. The startup banner
should read `http://127.0.0.1:5173/`, not `http://localhost:5173/`. The proxy
target is pinned the same way, since uvicorn also binds `127.0.0.1`.

*Vite moved to another port.* If 5173 is busy, Vite prints `Port 5173 is in
use, trying another one...` and starts on 5174, leaving Tailscale pointed at a
dead port. `strictPort` now makes it refuse to start instead. If that happens,
something is holding the port:

```bash
lsof -i :5173                # see what it is
lsof -ti :5173 | xargs kill  # usually a dev server from last time
```

**Showing someone who isn't on your tailnet** — `tailscale funnel 5173`
instead. Same idea, but the address is on the public internet, so anyone with
the link can reach it. Use it briefly and run `tailscale funnel off` when
you're finished. For anything long-lived, deploy it properly instead; see
DEPLOYMENT.md.

---

## Mobile

The app is responsive and works in a mobile browser as-is. On iOS, **Share → Add
to Home Screen** gives it a fullscreen, app-like launcher.

For a real app store build, **Capacitor** wraps this exact React code:

```bash
cd frontend
npm install @capacitor/core @capacitor/cli
npx cap init "IT Tickets" com.yourcompany.tickets --web-dir dist
npm run build
npx cap add ios          # macOS + Xcode
npx cap add android      # Android Studio
npx cap open ios
```

The backend must be reachable from the device, and the build needs an absolute
API URL rather than the dev proxy.

---

## Tech stack

**Backend** — FastAPI, SQLAlchemy 2.0, Pydantic v2, python-jose (JWT), SQLite

**Frontend** — React 18, React Router 7, Vite 7, plain CSS, qrcode

No CSS framework. All styling lives in `styles.css`, themed with CSS custom
properties.