# IT Ticket System — Web & Mobile

Converted from the original Tkinter desktop app to a **FastAPI** backend + **React** frontend.

---

## Project Layout

```
ticket-app/
├── backend/          ← FastAPI REST API (Python)
│   ├── main.py       ← routes
│   ├── models.py     ← SQLAlchemy ORM + Pydantic schemas
│   ├── auth.py       ← JWT auth, password hashing
│   ├── database.py   ← SQLite setup
│   ├── email_utils.py← email notifications (unchanged from original)
│   └── requirements.txt
└── frontend/         ← React SPA
    ├── src/
    │   ├── pages/    ← Login, Register, Dashboard
    │   ├── components/ ← TicketForm, HistoryTimeline, UserManagement
    │   ├── context/  ← AuthContext (JWT stored in localStorage)
    │   ├── api.js    ← fetch wrapper
    │   ├── App.jsx   ← router
    │   └── styles.css← plain CSS, no Tailwind
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## Running Locally

### 1 — Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

API is now at **http://localhost:8000**  
Interactive docs: **http://localhost:8000/docs**

### 2 — Frontend

```bash
cd frontend
npm install
npm run dev
```

App is now at **http://localhost:5173**

The Vite dev server proxies `/api/*` → `http://localhost:8000/*` automatically.

---

## Environment Variables (Backend)

Create a `.env` file in `backend/` or set these in your shell:

```
JWT_SECRET_KEY=your-secret-key-change-this-in-production

# Email notifications (optional – silently skipped when blank)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASSWORD=yourpassword
SMTP_FROM=you@example.com
NOTIFY_EMAIL=admin@example.com
```

Load it with: `export $(cat .env | xargs) && uvicorn main:app --reload`  
Or use python-dotenv if preferred.

---

## Roles

| Role       | Can create | Can close | Can delete | Manage users |
|------------|:---:|:---:|:---:|:---:|
| Requester  | ✅ | ❌ | ❌ | ❌ |
| Technician | ✅ | ✅ | ✅ | ❌ |
| Both       | ✅ | ✅ | ✅ | ✅ |

---

## Going to Mobile

### Option A — Capacitor (recommended, reuses this exact React code)

```bash
cd frontend
npm install @capacitor/core @capacitor/cli
npx cap init "IT Tickets" com.yourcompany.tickets --web-dir dist
npm run build
npx cap add ios     # requires macOS + Xcode
npx cap add android # requires Android Studio
npx cap open ios
npx cap open android
```

> The backend URL must be reachable from the device/emulator.
> Change the `proxy` in `vite.config.js` to an absolute URL for production builds.

### Option B — React Native

Rewrite the JSX components using React Native primitives (`View`, `Text`, `TextInput`, `FlatList`).
The `api.js` file works as-is since React Native includes `fetch`.

---

## Production Deployment

| Layer    | Simple option | Scalable option |
|----------|---------------|-----------------|
| Backend  | `uvicorn main:app` behind Nginx | Render / Railway / Fly.io |
| Frontend | `npm run build` → serve `dist/` via Nginx | Vercel / Netlify |
| Database | SQLite (fine for small teams) | Switch `DATABASE_URL` to PostgreSQL |

For PostgreSQL, add `psycopg2-binary` to requirements and update `DATABASE_URL`:
```
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```
