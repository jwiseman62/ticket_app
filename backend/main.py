import csv
import io
from datetime import datetime, timedelta
from typing import List

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from database import Base, engine, get_db
from email_utils import send_notification
from models import (
    TicketCreate, TicketDB, TicketOut, TicketUpdate,
    UserCreate, UserDB, UserOut, UserPasswordReset,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="IT Ticket System API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def fmt_id(ticket_id: int) -> str:
    return f"TKT-{ticket_id:03d}"


def _apply_filters(tickets, search, status_filter, priority_filter, view, current_name):
    query = search.strip().lower()
    result = []
    for t in tickets:
        if view == "My Tickets" and t.requester.lower() != current_name:
            continue
        if view == "Assigned To Me" and t.technician.lower() != current_name:
            continue
        if status_filter != "All" and t.status != status_filter:
            continue
        if priority_filter != "All" and t.priority != priority_filter:
            continue
        if query:
            hay = f"{t.title} {t.requester} {t.technician} {t.description}".lower()
            if query not in hay:
                continue
        result.append(t)
    return result


# ═══ AUTH ═══════════════════════════════════════════════════════════ #

@app.post("/auth/register", response_model=UserOut, status_code=201)
def register(body: UserCreate, db: Session = Depends(get_db)):
    if db.query(UserDB).filter(UserDB.name == body.name).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    user = UserDB(name=body.name, role=body.role, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(UserDB).filter(UserDB.name == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.password_hash.startswith("pbkdf2:sha256:"):
        user.password_hash = hash_password(form.password)
        db.commit()
    token = create_access_token(
        {"sub": user.name, "role": user.role},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": token, "token_type": "bearer", "role": user.role, "name": user.name}


@app.get("/auth/me", response_model=UserOut)
def get_me(current_user: UserDB = Depends(get_current_user)):
    return current_user


# ═══ USERS ══════════════════════════════════════════════════════════ #

@app.get("/users", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), _: UserDB = Depends(get_current_user)):
    return db.query(UserDB).all()


@app.put("/users/me/password")
def change_my_password(body: UserPasswordReset, db: Session = Depends(get_db),
                        current_user: UserDB = Depends(get_current_user)):
    current_user.password_hash = hash_password(body.password)
    db.commit()
    return {"ok": True}


@app.put("/users/{user_id}/password")
def reset_user_password(user_id: int, body: UserPasswordReset,
                         db: Session = Depends(get_db),
                         current_user: UserDB = Depends(get_current_user)):
    if current_user.role != "Both" and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    user = db.query(UserDB).filter(UserDB.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(body.password)
    db.commit()
    return {"ok": True}


@app.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db),
                current_user: UserDB = Depends(get_current_user)):
    if current_user.role != "Both":
        raise HTTPException(status_code=403, detail="Admin (Both role) only")
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.query(UserDB).filter(UserDB.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"ok": True}


# ═══ TICKETS ════════════════════════════════════════════════════════ #
# NOTE: export route MUST come before /{ticket_id} or FastAPI will try
# to cast "export" as an integer.

@app.get("/tickets/export/csv")
def export_csv(search: str = Query(""), status_filter: str = Query("All"),
               priority_filter: str = Query("All"), view: str = Query("All Tickets"),
               db: Session = Depends(get_db), current_user: UserDB = Depends(get_current_user)):
    tickets = _apply_filters(
        db.query(TicketDB).all(), search, status_filter, priority_filter,
        view, current_user.name.lower(),
    )
    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(["id","title","description","status","priority",
                "created_at","updated_at","requester","technician","due_date","history"])
    for t in tickets:
        w.writerow([fmt_id(t.id), t.title, t.description, t.status, t.priority,
                    t.created_at, t.updated_at, t.requester, t.technician,
                    t.due_date, " | ".join(t.history or [])])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                              headers={"Content-Disposition": "attachment; filename=tickets.csv"})


@app.get("/tickets", response_model=List[TicketOut])
def list_tickets(search: str = Query(""), status_filter: str = Query("All"),
                  priority_filter: str = Query("All"), view: str = Query("All Tickets"),
                  db: Session = Depends(get_db), current_user: UserDB = Depends(get_current_user)):
    return _apply_filters(
        db.query(TicketDB).all(), search, status_filter, priority_filter,
        view, current_user.name.lower(),
    )


@app.post("/tickets", response_model=TicketOut, status_code=201)
def create_ticket(body: TicketCreate, db: Session = Depends(get_db),
                   current_user: UserDB = Depends(get_current_user)):
    if current_user.role == "Requester" and body.status == "Closed":
        raise HTTPException(status_code=403, detail="Requesters cannot close tickets")
    now = datetime.now().isoformat(timespec="seconds")
    ticket = TicketDB(
        title=body.title, description=body.description, status=body.status,
        priority=body.priority, created_at=now, updated_at=now,
        requester=body.requester, technician=body.technician, due_date=body.due_date,
        history=[f"[{now}] Created by {current_user.name} (role: {current_user.role})"],
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    send_notification(
        subject=f"New ticket {fmt_id(ticket.id)}: {body.title}",
        body=(f"New IT ticket created.\n\nID: {fmt_id(ticket.id)}\nTitle: {body.title}\n"
              f"Requester: {body.requester}\nPriority: {body.priority}\n"
              f"Status: {body.status}\nTechnician: {body.technician or 'Unassigned'}\n"
              f"Due: {body.due_date or 'Not set'}\n\nDescription:\n{body.description}"),
    )
    return ticket


@app.get("/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(ticket_id: int, db: Session = Depends(get_db),
               _: UserDB = Depends(get_current_user)):
    t = db.query(TicketDB).filter(TicketDB.id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return t


@app.put("/tickets/{ticket_id}", response_model=TicketOut)
def update_ticket(ticket_id: int, body: TicketUpdate,
                   db: Session = Depends(get_db), current_user: UserDB = Depends(get_current_user)):
    ticket = db.query(TicketDB).filter(TicketDB.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if current_user.role == "Requester" and body.status == "Closed":
        raise HTTPException(status_code=403, detail="Requesters cannot close tickets")

    requester = body.requester
    if current_user.role == "Technician" and body.requester != ticket.requester:
        requester = ticket.requester

    changes = []
    if body.title != ticket.title:
        changes.append(f"Title: '{ticket.title}' -> '{body.title}'")
    if body.status != ticket.status:
        changes.append(f"Status: {ticket.status} -> {body.status}")
    if body.priority != ticket.priority:
        changes.append(f"Priority: {ticket.priority} -> {body.priority}")
    if body.technician != ticket.technician:
        changes.append(f"Technician: '{ticket.technician or 'Unassigned'}' -> '{body.technician or 'Unassigned'}'")
    if body.due_date != (ticket.due_date or ""):
        changes.append(f"Due date: '{ticket.due_date or 'none'}' -> '{body.due_date or 'none'}'")
    if body.description != ticket.description:
        changes.append("Description updated")

    now = datetime.now().isoformat(timespec="seconds")
    change_summary = "; ".join(changes) if changes else "no field changes"
    old_status = ticket.status

    ticket.title       = body.title
    ticket.description = body.description
    ticket.requester   = requester
    ticket.technician  = body.technician
    ticket.priority    = body.priority
    ticket.status      = body.status
    ticket.due_date    = body.due_date
    ticket.updated_at  = now
    ticket.history     = (ticket.history or []) + [
        f"[{now}] Updated by {current_user.name} (role: {current_user.role}): {change_summary}"
    ]
    db.commit()
    db.refresh(ticket)

    if body.status != old_status:
        send_notification(
            subject=f"Ticket {fmt_id(ticket_id)} status: {old_status} -> {body.status}",
            body=(f"Ticket status changed.\n\nID: {fmt_id(ticket_id)}\nTitle: {body.title}\n"
                  f"Status: {old_status} -> {body.status}\nUpdated by: {current_user.name}\n"),
        )
    return ticket


@app.delete("/tickets/{ticket_id}")
def delete_ticket(ticket_id: int, db: Session = Depends(get_db),
                   current_user: UserDB = Depends(get_current_user)):
    if current_user.role == "Requester":
        raise HTTPException(status_code=403, detail="Requesters cannot delete tickets")
    ticket = db.query(TicketDB).filter(TicketDB.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    db.delete(ticket)
    db.commit()
    return {"ok": True}


# ═══ STATS ══════════════════════════════════════════════════════════ #

@app.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
    current_user: UserDB = Depends(get_current_user),
):
    tickets = db.query(TicketDB).all()
    today   = datetime.now().date().isoformat()

    by_status   = {"Open": 0, "In Progress": 0, "Closed": 0}
    by_priority = {"High": 0, "Medium": 0, "Low": 0}
    overdue = 0

    for t in tickets:
        if t.status   in by_status:   by_status[t.status]     += 1
        if t.priority in by_priority: by_priority[t.priority] += 1
        if t.due_date and t.due_date < today and t.status != "Closed":
            overdue += 1

    recent = sorted(tickets, key=lambda x: x.updated_at or "", reverse=True)[:8]

    return {
        "total":       len(tickets),
        "by_status":   by_status,
        "by_priority": by_priority,
        "overdue":     overdue,
        "recent": [
            {
                "id":         t.id,
                "title":      t.title,
                "status":     t.status,
                "priority":   t.priority,
                "requester":  t.requester,
                "technician": t.technician,
                "updated_at": t.updated_at,
                "due_date":   t.due_date,
            }
            for t in recent
        ],
    }
