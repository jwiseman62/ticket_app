# Deploying the live demo

Puts the app online as a portfolio piece: a React frontend on Vercel, a
FastAPI backend on Render, and a Neon PostgreSQL database, with demo data that
resets itself nightly.

Everything here fits in free tiers. Budget about 45 minutes.

---

## Before you start

**Don't use Render's free PostgreSQL.** It expires after 30 days and is then
removed — your demo would die about a month after you link it from your résumé.
Neon's free tier doesn't expire and doesn't pause for inactivity, which is what
you want for something that might go unvisited for a week.

**One thing is unavoidable on the free tier:** Render spins a service down when
it's idle, so the first request after a quiet spell takes tens of seconds. The
login page handles this — it pings the API on load and shows *"Waking the demo
server… about 30 seconds"* so it reads as intentional rather than broken. If
you'd rather not have it at all, Render's Starter plan is about $7/month and
removes the spin-down.

---

## 1 — Database (Neon)

1. Sign up at [neon.tech](https://neon.tech) and create a project.
2. Copy the connection string. It looks like:

   ```
   postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

3. Keep it somewhere — Render needs it in step 2.

Leave `?sslmode=require` on the end; Neon needs it and the app preserves it.

> The app rewrites `postgres://` and `postgresql://` to use psycopg 3
> automatically, so paste whichever form Neon gives you.

---

## 2 — Backend (Render)

1. Push this repo to GitHub if you haven't.
2. At [render.com](https://render.com): **New → Blueprint**, select the repo.
   It picks up `render.yaml` and creates a service called `ticket-api`.
3. Render will ask for the two values marked `sync: false`:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | your Neon connection string |
   | `CORS_ORIGINS` | leave blank for now — you don't have a frontend URL yet |

4. Deploy. Watch the logs; a healthy start looks like:

   ```
   Database : PostgreSQL (postgresql+psycopg://***@ep-xxx.../neondb?sslmode=require)
   CORS     : http://localhost:5173, http://localhost:3000
   Uploads  : database
   Demo mode: ON
   Demo data created:
       9 users
      22 tickets
      15 comments
       6 articles
   ```

   The demo data seeds automatically on first boot. On later boots it detects
   existing accounts and skips, so restarts don't duplicate anything.

5. Note your API URL — something like `https://ticket-api.onrender.com`.
   Check `https://ticket-api.onrender.com/health` returns `{"status":"ok"}`.

6. Copy the generated **`DEMO_RESET_TOKEN`** from the service's Environment
   tab. Step 4 needs it.

### What `render.yaml` sets for you

| Variable | Value | Why |
|---|---|---|
| `JWT_SECRET_KEY` | generated, stable | Without a fixed key, every deploy signs all users out |
| `STORE_UPLOADS_IN_DB` | `true` | Free tier has no persistent disk; files written there vanish on restart |
| `MAX_UPLOAD_MB` | `2` | Keeps attachments from eating the 1 GB Neon allowance |
| `DEMO_MODE` | `true` | Enables the reset endpoint |
| `DEMO_RESET_TOKEN` | generated | Authenticates the nightly reset |

Two more are optional and default sensibly: `CLOSED_GRACE_DAYS` (1) is how long
a closed ticket stays on the board and in the dashboard counters before moving
to the archive, and `TRASH_RETENTION_DAYS` (30) is how long a deleted one stays
recoverable.

---

## 3 — Frontend (Vercel)

1. At [vercel.com](https://vercel.com): **Add New → Project**, select the repo.
2. Set **Root Directory** to `frontend`. Vercel reads `frontend/vercel.json`
   for the rest.
3. Add two environment variables:

   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | your Render URL, e.g. `https://ticket-api.onrender.com` |
   | `VITE_DEMO_MODE` | `true` |

4. Deploy, and note the URL — something like
   `https://ticket-app-yourname.vercel.app`.

> **These are baked in at build time, not read at runtime.** Changing either
> one later means triggering a redeploy; restarting isn't enough.

---

## 4 — Wire them together

Two things still need the URLs you just got.

**Back on Render**, set `CORS_ORIGINS` to your exact Vercel URL:

```
CORS_ORIGINS=https://ticket-app-yourname.vercel.app
```

Then redeploy. Without this, the browser blocks every API call and the app
looks dead.

**On GitHub**, under *Settings → Secrets and variables → Actions*:

| Type | Name | Value |
|---|---|---|
| Secret | `DEMO_RESET_TOKEN` | the value from Render |
| Variable | `DEMO_API_URL` | your Render URL |

Then open the **Actions** tab, pick *Reset demo data*, and click **Run
workflow** to confirm it works. After that it runs nightly at 02:00 Central.

---

## 5 — Check it

Visit your Vercel URL and confirm:

- [ ] Landing page loads
- [ ] Login page shows three **Try it instantly** buttons
- [ ] Clicking *Technician* signs you straight in
- [ ] Dashboard shows 22 tickets, charts populated, 3 overdue
- [ ] Tickets → **Unassigned** has 8 rows with **Claim** buttons
- [ ] Knowledge Base lists 6 articles
- [ ] Archive → **Resolved** lists 9 tickets; filtering by category narrows them
- [ ] Archive → **Trash** shows 3 tickets, one flagged as expiring soon
- [ ] Dashboard **Closed** tile reads "last 24 hours"; **Archived** links to the archive
- [ ] Admin → **New account** creates a technician who can then sign in
- [ ] Dark mode toggle works
- [ ] Sign in as *Admin* → Admin page shows 1 pending technician request
- [ ] Refresh the page while on `/tickets` — it should load, not 404
- [ ] Attach a screenshot to a ticket and download it back

That last two are the ones most likely to break: the refresh test exercises the
SPA rewrite, and the attachment test exercises database-backed uploads.

---

## Troubleshooting

### Everything fails with "Can't reach the server"

Almost always CORS. Open the browser console — you'll see:

```
Access to fetch at 'https://...' from origin 'https://...' has been
blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

The origin in that message must appear **exactly** in `CORS_ORIGINS` on Render.
Easy ways to get this wrong:

- `http://localhost:4173` and `http://127.0.0.1:4173` are **different origins**
- `https://` vs `http://` matters
- A trailing slash doesn't belong — use `https://app.vercel.app`, not
  `https://app.vercel.app/`
- Vercel preview deployments get their own URLs and won't match your production
  entry

### `syntax error at or near "PRAGMA"`

An old copy of `database.py`. The current one uses SQLAlchemy's inspector,
which works on both SQLite and Postgres.

### Everyone gets signed out after each deploy

`JWT_SECRET_KEY` isn't set, so a new one is generated each boot. The blueprint
sets it; check it still has a value.

### Attachments vanish after a redeploy

`STORE_UPLOADS_IN_DB` isn't `true`, so files went to the ephemeral disk.

### Refreshing on `/tickets` gives a 404

The SPA rewrite isn't applying. Confirm Vercel's **Root Directory** is
`frontend` so it finds `vercel.json`.

### Demo data is missing or wrong

Run the *Reset demo data* workflow by hand from the Actions tab. A 404 from it
means either `DEMO_MODE` isn't `true` or the token doesn't match.

### First load takes ~30 seconds

Expected on Render's free tier. The login page explains it to visitors. Upgrade
to Starter to remove it.

---

## Adding it to your portfolio

Two things worth saying on the portfolio page itself:

- **Give people the demo credentials** even though the buttons exist —
  some will want to read before clicking.
- **Mention the stack**: FastAPI, React, PostgreSQL, JWT auth with role-based
  access. That's what a reader is scanning for.

A line like *"data resets nightly, so feel free to break things"* gives
visitors permission to actually explore rather than looking and leaving.

---

## Switching to a single service

If you'd rather run one service instead of two — simpler config, but the
frontend then inherits the backend's cold start:

1. Build the frontend with **no** `VITE_API_URL`, so it calls same-origin paths.
2. Mount the build in `main.py`:

   ```python
   from fastapi.staticfiles import StaticFiles
   app.mount("/", StaticFiles(directory="../frontend/dist", html=True), name="spa")
   ```

   Mount it **after** all API routes, or it swallows them.
3. Drop `CORS_ORIGINS` entirely — same origin means no CORS.

No other code changes: `api.js` already falls back to a relative base when
`VITE_API_URL` is unset.