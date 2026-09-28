# IT Ticket System

A help desk application for small IT teams. Requesters file tickets through a
guided intake flow, technicians claim and resolve them, and admins manage
accounts and access.

Built with **FastAPI** (Python) and **React** — plain CSS, no UI framework.

> Originally a Tkinter desktop application, rebuilt as a web app.

---

## Contents

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

### Knowledge base

Six troubleshooting articles ship seeded — one per category, covering dead
devices, crashing apps, network drops, lockouts, printers, and email. Admins can
add, edit, and delete articles. The same articles power the inline suggestions
during ticket intake.

### Dashboard

Ticket counts by status, priority, and category, overdue tracking, and a recent
activity table.

### Admin

A dedicated page with account management (roles, emails, password resets) and
technician access codes with QR generation.

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
├── .gitignore
│
├── backend/                     FastAPI REST API
│   ├── main.py                  All routes
│   ├── models.py                SQLAlchemy 2.0 ORM + Pydantic schemas
│   ├── auth.py                  JWT, password hashing, lockout
│   ├── database.py              Engine, session, lightweight migrations
│   ├── email_utils.py           SMTP notifications
│   ├── seed_articles.py         Default knowledge base content
│   ├── manage.py                Admin CLI
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/                    React single-page app
    ├── package.json
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
        │   ├── Dashboard.jsx    Ticket list + detail
        │   ├── KnowledgeBase.jsx
        │   ├── Profile.jsx
        │   ├── Admin.jsx        Users + access codes
        │   └── Redeem.jsx       QR landing page
        └── components/
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
| `DELETE` | `/tickets/{id}` | Technician or admin |
| `GET` | `/tickets/export/csv` | Honors the same filters |

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

### Stats

| Method | Path |
|---|---|
| `GET` | `/stats` |

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

`DATABASE_URL` is currently hardcoded in `database.py`:

```python
DATABASE_URL = "sqlite:///./tickets.db"
```

Add `psycopg2-binary` to `requirements.txt` and change that line — reading it
from an environment variable instead is a reasonable first step if you deploy.
The `connect_args={"check_same_thread": False}` argument is SQLite-specific and
should be dropped for Postgres.

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
