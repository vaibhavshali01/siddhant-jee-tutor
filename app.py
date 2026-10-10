"""Siddhant — private JEE Mains & Advanced tutor.

Public internet, restricted sign-in, owner approval required.
The xAI API key never leaves the server.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UPLOADS = DATA / "uploads"
DATA.mkdir(exist_ok=True)
UPLOADS.mkdir(exist_ok=True)

def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def load_dotenv() -> None:
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv()

SECRET = env("SECRET_KEY", "dev-only-change-me")
DB_PATH = Path(env("DATABASE_PATH", str(DATA / "siddhant.db")))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
MODEL = env("XAI_MODEL", "grok-4.7")
BASE_URL = env("XAI_BASE_URL", "https://api.x.ai/v1").rstrip("/")
ADMIN_EMAIL = env("ADMIN_EMAIL", "admin@example.com").lower()
ADMIN_PASSWORD = env("ADMIN_PASSWORD", "change-me-now")
ADMIN_NAME = env("ADMIN_NAME", "Owner")
NOTIFY_URL = env("ADMIN_NOTIFY_URL")
DAILY_CAP = int(env("DAILY_MESSAGE_CAP", "40") or "40")
COOKIE_SECURE = env("COOKIE_SECURE", "false").lower() in {"1", "true", "yes"}
EXTRA_ADMINS = {e.strip().lower() for e in env("EXTRA_ADMINS").split(",") if e.strip()}

app = FastAPI(title="Siddhant", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
templates = Jinja2Templates(directory=str(ROOT / "templates"))

LOGIN_HITS: dict[str, list[float]] = {}


SYSTEM_PROMPT = """You are Siddhant, a private JEE Mains and JEE Advanced tutor.

Students are class 11, class 12, or droppers preparing for JEE Main and/or JEE Advanced (NTA / IIT).
Teach like a sharp coaching faculty member: precise, calm, and honest about difficulty.

Rules:
- Match the requested exam. JEE Main: single correct, numerical, speed, NCERT-faithful. JEE Advanced: multi-correct, paragraph, matrix match, integer, deeper traps, multi-concept.
- Default to teaching, not dumping. For a solve request, give a clean worked solution: given, diagram in words if needed, concept, equations, substitution, answer with units, then one "why students miss this" note.
- For practice mode, give ONLY the question (and options if Main-style). Do not reveal the answer until the student asks for a hint or the solution.
- For hint mode, give one nudge, not the full solution.
- Use LaTeX. Inline math with $...$ and display math with $$...$$. Do not use \\( \\) or bare unicode for equations.
- State assumptions. Use SI units unless the question uses another system. Keep significant figures sensible.
- Never invent an official answer key, year, or "this was JEE Advanced 2019 Q4" unless you are sure. If unsure, say it is a similar practice item.
- If a photo is attached, read it carefully, restate the question in text first, then solve. If the photo is unreadable, say exactly what is missing.
- Do not do the student's graded homework in a way that hides the method. Always show the method.
- If the question is outside JEE Physics, Chemistry, or Mathematics, briefly redirect and offer the closest exam-relevant angle.
- Language: reply in the language the student used. Support English and Hindi. Keep chemical names and symbols standard.
- End solve responses with the final answer on its own line, prefixed "Final answer:".
- Be concise. No pep talk filler. No "Certainly". No mention of being an AI unless asked.
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'student',
                status TEXT NOT NULL DEFAULT 'pending',
                class_year TEXT,
                target TEXT,
                note TEXT,
                created_at TEXT NOT NULL,
                approved_at TEXT,
                daily_cap INTEGER
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                subject TEXT,
                exam TEXT,
                mode TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                image_path TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id)
            );
            CREATE TABLE IF NOT EXISTS usage (
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(user_id, day)
            );
            """
        )
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (ADMIN_EMAIL,)).fetchone()
        if not existing:
            conn.execute(
                """INSERT INTO users
                   (email, name, password_hash, role, status, class_year, target, note, created_at, approved_at)
                   VALUES (?, ?, ?, 'admin', 'approved', '', 'owner', 'Bootstrap admin', ?, ?)""",
                (ADMIN_EMAIL, ADMIN_NAME, hash_password(ADMIN_PASSWORD), now(), now()),
            )
        else:
            conn.execute(
                "UPDATE users SET role = 'admin', status = 'approved' WHERE email = ?",
                (ADMIN_EMAIL,),
            )


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${digest}"


def check_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    candidate = hash_password(password, salt).split("$", 1)[1]
    return hmac.compare_digest(candidate, digest)


def sign(payload: dict[str, Any]) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def unsign(token: str) -> dict[str, Any] | None:
    try:
        raw, sig = token.split(".", 1)
        expected = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return None
        padded = raw + "=" * (-len(raw) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded))
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None


def current_user(request: Request) -> sqlite3.Row | None:
    token = request.cookies.get("siddhant")
    if not token:
        return None
    data = unsign(token)
    if not data:
        return None
    with db() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (data.get("uid"),)).fetchone()


def is_admin(user: sqlite3.Row | None) -> bool:
    if not user:
        return False
    return user["role"] == "admin" or user["email"] in EXTRA_ADMINS or user["email"] == ADMIN_EMAIL


def set_session(response: JSONResponse | RedirectResponse, user_id: int) -> None:
    token = sign({"uid": user_id, "exp": int(time.time()) + 14 * 24 * 3600, "csrf": secrets.token_urlsafe(18)})
    response.set_cookie(
        "siddhant",
        token,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=14 * 24 * 3600,
        path="/",
    )


def csrf_of(request: Request) -> str:
    token = request.cookies.get("siddhant")
    data = unsign(token) if token else None
    return (data or {}).get("csrf", "")


def require_csrf(request: Request) -> bool:
    expected = csrf_of(request)
    sent = request.headers.get("x-csrf", "")
    return bool(expected) and hmac.compare_digest(expected, sent)


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "local")


def limited(ip: str) -> bool:
    now_ts = time.time()
    hits = [t for t in LOGIN_HITS.get(ip, []) if now_ts - t < 900]
    LOGIN_HITS[ip] = hits
    return len(hits) >= 12


def mark_hit(ip: str) -> None:
    LOGIN_HITS.setdefault(ip, []).append(time.time())


def public(user: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": "admin" if is_admin(user) else "student",
        "status": user["status"],
        "class_year": user["class_year"],
        "target": user["target"],
        "csrf": "",
    }


async def notify(text: str) -> None:
    if not NOTIFY_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            await client.post(NOTIFY_URL, content=text.encode(), headers={"Title": "Siddhant access request"})
    except Exception:
        return


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "true"}


@app.get("/", response_class=HTMLResponse)
def landing(request: Request):
    user = current_user(request)
    return templates.TemplateResponse(request, "landing.html", {"user": user, "admin": is_admin(user)})


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if current_user(request):
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse(request, "auth.html", {"mode": "login"})


@app.get("/signup", response_class=HTMLResponse)
def signup_page(request: Request):
    if current_user(request):
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse(request, "auth.html", {"mode": "signup"})


@app.get("/desk", response_class=HTMLResponse)
def desk(request: Request):
    user = current_user(request)
    if not user:
        return RedirectResponse("/login", status_code=303)
    if user["status"] != "approved" and not is_admin(user):
        return RedirectResponse("/waiting", status_code=303)
    return templates.TemplateResponse(
        request,
        "desk.html",
        {"user": user, "admin": is_admin(user), "csrf": csrf_of(request), "model": MODEL, "cap": DAILY_CAP},
    )


@app.get("/waiting", response_class=HTMLResponse)
def waiting(request: Request):
    user = current_user(request)
    if not user:
        return RedirectResponse("/login", status_code=303)
    if user["status"] == "approved" or is_admin(user):
        return RedirectResponse("/desk", status_code=303)
    return templates.TemplateResponse(request, "waiting.html", {"user": user, "csrf": csrf_of(request)})


@app.get("/admin", response_class=HTMLResponse)
def admin_page(request: Request):
    user = current_user(request)
    if not user:
        return RedirectResponse("/login", status_code=303)
    if not is_admin(user):
        return RedirectResponse("/desk", status_code=303)
    return templates.TemplateResponse(
        request,
        "admin.html",
        {"user": user, "csrf": csrf_of(request), "key_set": bool(env("XAI_API_KEY")), "model": MODEL, "cap": DAILY_CAP},
    )


@app.post("/api/signup")
async def signup(request: Request):
    ip = client_ip(request)
    if limited(ip):
        return JSONResponse({"error": "Too many attempts. Wait 15 minutes."}, status_code=429)
    body = await request.json()
    name = str(body.get("name", "")).strip()[:80]
    email = str(body.get("email", "")).strip().lower()[:120]
    password = str(body.get("password", ""))
    class_year = str(body.get("class_year", "")).strip()[:40]
    target = str(body.get("target", "")).strip()[:40]
    note = str(body.get("note", "")).strip()[:400]
    if not name or "@" not in email or len(password) < 8:
        return JSONResponse({"error": "Name, a real email, and a password of at least 8 characters are required."}, status_code=400)
    if email == ADMIN_EMAIL:
        return JSONResponse({"error": "This email is reserved."}, status_code=400)
    with db() as conn:
        if conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
            mark_hit(ip)
            return JSONResponse({"error": "An account with this email already exists. Log in instead."}, status_code=409)
        conn.execute(
            """INSERT INTO users (email, name, password_hash, role, status, class_year, target, note, created_at)
               VALUES (?, ?, ?, 'student', 'pending', ?, ?, ?, ?)""",
            (email, name, hash_password(password), class_year, target, note, now()),
        )
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    await notify(f"Access request: {name} <{email}> · {class_year} · {target}\n{note or 'No note'}")
    response = JSONResponse({"ok": True, "status": "pending"})
    set_session(response, user["id"])
    return response


@app.post("/api/login")
async def login(request: Request):
    ip = client_ip(request)
    if limited(ip):
        return JSONResponse({"error": "Too many attempts. Wait 15 minutes."}, status_code=429)
    body = await request.json()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password(password, user["password_hash"]):
        mark_hit(ip)
        return JSONResponse({"error": "Email or password is wrong."}, status_code=401)
    if user["status"] == "rejected":
        return JSONResponse({"error": "This request was declined. Contact the owner if that is a mistake."}, status_code=403)
    response = JSONResponse({"ok": True, "status": user["status"], "admin": is_admin(user)})
    set_session(response, user["id"])
    return response


@app.post("/api/logout")
def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie("siddhant", path="/")
    return response


@app.get("/api/me")
def me(request: Request):
    user = current_user(request)
    if not user:
        return JSONResponse({"user": None})
    data = public(user)
    data["csrf"] = csrf_of(request)
    return data


@app.get("/api/admin/users")
def admin_users(request: Request):
    user = current_user(request)
    if not is_admin(user):
        return JSONResponse({"error": "Not allowed."}, status_code=403)
    with db() as conn:
        rows = conn.execute(
            """SELECT u.*, COALESCE(us.count, 0) AS today
               FROM users u
               LEFT JOIN usage us ON us.user_id = u.id AND us.day = ?
               ORDER BY CASE u.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, u.created_at DESC""",
            (datetime.now(timezone.utc).date().isoformat(),),
        ).fetchall()
    return {
        "users": [
            {
                "id": r["id"],
                "email": r["email"],
                "name": r["name"],
                "role": r["role"],
                "status": r["status"],
                "class_year": r["class_year"],
                "target": r["target"],
                "note": r["note"],
                "created_at": r["created_at"],
                "approved_at": r["approved_at"],
                "today": r["today"],
                "daily_cap": r["daily_cap"] or DAILY_CAP,
            }
            for r in rows
        ]
    }


@app.post("/api/admin/users/{user_id}")
async def admin_update(user_id: int, request: Request):
    actor = current_user(request)
    if not is_admin(actor) or not require_csrf(request):
        return JSONResponse({"error": "Not allowed."}, status_code=403)
    body = await request.json()
    action = body.get("action")
    with db() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            return JSONResponse({"error": "No such account."}, status_code=404)
        if target["email"] == ADMIN_EMAIL and action in {"reject", "revoke", "delete"}:
            return JSONResponse({"error": "The owner account cannot be removed."}, status_code=400)
        if action == "approve":
            conn.execute("UPDATE users SET status = 'approved', approved_at = ? WHERE id = ?", (now(), user_id))
        elif action == "reject":
            conn.execute("UPDATE users SET status = 'rejected' WHERE id = ?", (user_id,))
        elif action == "revoke":
            conn.execute("UPDATE users SET status = 'pending', approved_at = NULL WHERE id = ?", (user_id,))
        elif action == "delete":
            conn.execute("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)", (user_id,))
            conn.execute("DELETE FROM conversations WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM usage WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        elif action == "cap":
            try:
                cap = max(1, min(500, int(body.get("cap"))))
            except (TypeError, ValueError):
                return JSONResponse({"error": "Cap must be a number."}, status_code=400)
            conn.execute("UPDATE users SET daily_cap = ? WHERE id = ?", (cap, user_id))
        elif action == "reset_password":
            temp = secrets.token_urlsafe(8)
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(temp), user_id))
            return {"ok": True, "temp_password": temp}
        else:
            return JSONResponse({"error": "Unknown action."}, status_code=400)
    return {"ok": True}


@app.get("/api/conversations")
def list_conversations(request: Request):
    user = current_user(request)
    if not user or (user["status"] != "approved" and not is_admin(user)):
        return JSONResponse({"error": "Not allowed."}, status_code=403)
    with db() as conn:
        rows = conn.execute(
            "SELECT id, title, subject, exam, mode, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 80",
            (user["id"],),
        ).fetchall()
    return {"conversations": [dict(r) for r in rows]}


@app.post("/api/conversations")
async def new_conversation(request: Request):
    user = current_user(request)
    if not user or (user["status"] != "approved" and not is_admin(user)) or not require_csrf(request):
        return JSONResponse({"error": "Not allowed."}, status_code=403)
    body = await request.json()
    title = str(body.get("title") or "New doubt").strip()[:80]
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO conversations (user_id, title, subject, exam, mode, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                user["id"],
                title,
                str(body.get("subject") or "Physics")[:40],
                str(body.get("exam") or "Advanced")[:20],
                str(body.get("mode") or "solve")[:20],
                now(),
                now(),
            ),
        )
        return {"id": cur.lastrowid, "title": title}


@app.get("/api/conversations/{cid}")
def get_conversation(cid: int, request: Request):
    user = current_user(request)
    if not user:
        return JSONResponse({"error": "Not allowed."}, status_code=403)
    with db() as conn:
        convo = conn.execute("SELECT * FROM conversations WHERE id = ? AND user_id = ?", (cid, user["id"])).fetchone()
        if not convo:
            return JSONResponse({"error": "Not found."}, status_code=404)
        rows = conn.execute(
            "SELECT id, role, content, image_path, created_at FROM messages WHERE conversation_id = ? ORDER BY id",
            (cid,),
        ).fetchall()
    return {
        "conversation": dict(convo),
        "messages": [
            {**dict(r), "image_path": f"/api/images/{r['id']}" if r["image_path"] else None}
            for r in rows
        ],
    }


@app.get("/api/images/{message_id}")
def image(message_id: int, request: Request):
    user = current_user(request)
    if not user:
        return JSONResponse({"error": "Not allowed."}, status_code=403)
    with db() as conn:
        row = conn.execute(
            """SELECT m.image_path FROM messages m
               JOIN conversations c ON c.id = m.conversation_id
               WHERE m.id = ? AND c.user_id = ?""",
            (message_id, user["id"]),
        ).fetchone()
    if not row or not row["image_path"]:
        return JSONResponse({"error": "Not found."}, status_code=404)
    path = Path(row["image_path"])
    if not path.exists():
        return JSONResponse({"error": "Missing file."}, status_code=404)
    return FileResponse(path)


def cap_for(user: sqlite3.Row) -> int:
    return int(user["daily_cap"] or DAILY_CAP)


def under_cap(user: sqlite3.Row) -> bool:
    if is_admin(user):
        return True
    day = datetime.now(timezone.utc).date().isoformat()
    with db() as conn:
        row = conn.execute("SELECT count FROM usage WHERE user_id = ? AND day = ?", (user["id"], day)).fetchone()
    return (row["count"] if row else 0) < cap_for(user)


def bump_usage(user_id: int) -> None:
    day = datetime.now(timezone.utc).date().isoformat()
    with db() as conn:
        conn.execute(
            """INSERT INTO usage (user_id, day, count) VALUES (?, ?, 1)
               ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1""",
            (user_id, day),
        )


@app.post("/api/chat")
async def chat(request: Request):
    user = current_user(request)
    if not user or (user["status"] != "approved" and not is_admin(user)):
        return JSONResponse({"error": "Your account is not approved yet."}, status_code=403)
    if not require_csrf(request):
        return JSONResponse({"error": "Session expired. Refresh and log in again."}, status_code=403)
    if not under_cap(user):
        return JSONResponse({"error": f"Daily limit of {cap_for(user)} messages reached. It resets at midnight UTC."}, status_code=429)
    api_key = env("XAI_API_KEY")
    if not api_key:
        return JSONResponse({"error": "The owner has not set XAI_API_KEY on the server yet."}, status_code=503)

    form = await request.form()
    text = str(form.get("text") or "").strip()
    subject = str(form.get("subject") or "Physics")[:40]
    exam = str(form.get("exam") or "Advanced")[:20]
    mode = str(form.get("mode") or "solve")[:20]
    language = str(form.get("language") or "English")[:20]
    cid_raw = str(form.get("conversation_id") or "")
    upload = form.get("image")
    if not text and not (upload and getattr(upload, "filename", "")):
        return JSONResponse({"error": "Type a doubt or attach a question photo."}, status_code=400)
    if len(text) > 8000:
        return JSONResponse({"error": "That message is too long. Split it."}, status_code=400)

    image_path = None
    data_url = None
    if upload and getattr(upload, "filename", ""):
        blob = await upload.read()
        if len(blob) > 4_500_000:
            return JSONResponse({"error": "Photo must be under 4 MB."}, status_code=400)
        kind = (upload.content_type or "").lower()
        ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(kind)
        if not ext:
            return JSONResponse({"error": "Use a JPG, PNG, or WEBP photo."}, status_code=400)
        image_path = UPLOADS / f"{secrets.token_hex(12)}.{ext}"
        image_path.write_bytes(blob)
        data_url = f"data:{kind};base64,{base64.b64encode(blob).decode()}"

    with db() as conn:
        if cid_raw.isdigit():
            convo = conn.execute(
                "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
                (int(cid_raw), user["id"]),
            ).fetchone()
        else:
            convo = None
        if not convo:
            title = (text or "Photo doubt")[:72]
            cur = conn.execute(
                """INSERT INTO conversations (user_id, title, subject, exam, mode, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (user["id"], title, subject, exam, mode, now(), now()),
            )
            cid = cur.lastrowid
        else:
            cid = convo["id"]
            conn.execute(
                "UPDATE conversations SET subject = ?, exam = ?, mode = ?, updated_at = ? WHERE id = ?",
                (subject, exam, mode, now(), cid),
            )
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content, image_path, created_at) VALUES (?, 'user', ?, ?, ?)",
            (cid, text or "[Question photo]", str(image_path) if image_path else None, now()),
        )
        history = conn.execute(
            "SELECT role, content, image_path FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 16",
            (cid,),
        ).fetchall()

    history = list(reversed(history))
    mode_note = {
        "solve": "Give a full worked solution and end with Final answer:.",
        "hint": "Give only one hint. Do not finish the problem.",
        "practice": "Give only a fresh exam-style question. No answer, no hint.",
        "concept": "Explain the concept with one short example, then a check question.",
        "revision": "Give the formula sheet for this topic, conditions of use, and two common traps.",
    }.get(mode, "Teach the doubt.")
    steer = (
        f"Student context: exam={exam}, subject={subject}, mode={mode}, language={language}. {mode_note}"
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": steer},
    ]
    for i, row in enumerate(history):
        is_last = i == len(history) - 1
        if row["role"] == "user" and is_last and data_url:
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": text or "Solve this question from the photo."},
                        {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                    ],
                }
            )
        else:
            messages.append({"role": row["role"], "content": row["content"]})

    bump_usage(user["id"])

    async def stream():
        yield f"data: {json.dumps({'conversation_id': cid})}\n\n"
        collected: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=180) as client:
                async with client.stream(
                    "POST",
                    f"{BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={"model": MODEL, "messages": messages, "stream": True, "temperature": 0.3},
                ) as resp:
                    if resp.status_code >= 400:
                        detail = (await resp.aread()).decode()[:500]
                        yield f"data: {json.dumps({'error': f'Grok API {resp.status_code}: {detail}'})}\n\n"
                        return
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        delta = ((chunk.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""
                        if delta:
                            collected.append(delta)
                            yield f"data: {json.dumps({'token': delta})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': f'Could not reach Grok: {exc}'})}\n\n"
            return
        answer = "".join(collected).strip() or "I could not produce a reply. Try again."
        with db() as conn:
            conn.execute(
                "INSERT INTO messages (conversation_id, role, content, image_path, created_at) VALUES (?, 'assistant', ?, NULL, ?)",
                (cid, answer, now()),
            )
            conn.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now(), cid))
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


init_db()
