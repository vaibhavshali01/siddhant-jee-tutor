# Siddhant — private JEE Mains & Advanced tutor

A small web app you can put on the public internet. Anyone can open the site. Nobody can use the desk until you approve their account.

The tutor is Grok (`grok-4.7` by default) through the xAI Responses API. The API key stays on the server. Worked solutions can use the code-execution tool to check the arithmetic. Advanced questions and photos use `xhigh` reasoning; hints and drills stay lighter.

## What a student can do

- Request access with name, email, class, target exam, and a note
- After you approve them: worked solutions, one hint, practice questions that do not spoil the answer, concept notes, formula revision
- A study dashboard on **Today**: exam countdown, focus timer, tasks, syllabus, mistake notebook, lecture log, and backlogs. It is stored for that account
- Attach a photo of a printed or handwritten question. Photos are sent to the model at high detail
- English or Hindi
- Physics, Chemistry, Mathematics, at JEE Main or JEE Advanced level

## What only you can do

Log in with `ADMIN_EMAIL`. Open **Approvals**.

- Approve, decline, revoke, delete
- Reset a password (the temporary password is shown once)
- See today’s message count

Optional: set `ADMIN_NOTIFY_URL` to an [ntfy.sh](https://ntfy.sh) topic so your phone pings on every request.

## Run on your laptop

```bash
cd jee-grok-bot
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`:

- `XAI_API_KEY` from https://console.x.ai
- `XAI_MODEL` — leave this as `grok-4.7` unless xAI renames the flagship
- `XAI_REASONING_EFFORT` — `high` by default. Do not invent another model name to get a smarter answer
- `XAI_CODE_EXECUTION` — `auto` checks the numbers on worked solutions
- `XAI_WEB_SEARCH` — leave `false` unless you want live lookup
- `XAI_IMAGE_DETAIL` — `high` for question photos
- `XAI_TIMEOUT_SECONDS` — `900`, because a hard solution can think for a few minutes
- `SECRET_KEY` — a long random string
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` — this account is created on first boot and is already approved

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

Open http://127.0.0.1:8000 and log in as the admin.

## Put it on the public internet

You need a host with a persistent disk. SQLite lives in `data/`. If the disk is wiped, approvals are wiped.

### Render

1. Push this folder to a private GitHub repo.
2. New Blueprint, or New Web Service using the Dockerfile.
3. `render.yaml` already asks for a 1 GB disk mounted at `/app/data`.
4. Set `XAI_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. `COOKIE_SECURE` should stay `true`.
5. Open the Render URL, log in, approve students.

### Railway

1. New project from this folder.
2. Add a volume mounted at `/app/data`.
3. Set the same env vars, plus `COOKIE_SECURE=true` and `DATABASE_PATH=/app/data/siddhant.db`.
4. Railway injects `PORT`. The Procfile uses it.

### Your own VPS

```bash
docker build -t siddhant .
docker run -d -p 8000:8000 --env-file .env -v siddhant-data:/app/data siddhant
```

Put Caddy or Nginx in front for HTTPS, then set `COOKIE_SECURE=true`.

## Cost

Grok 4.7 is billed to your xAI console key (about $2 / 1M input tokens and $6 / 1M output tokens as of the docs used here). A typical worked solution is a few cents. Students are capped at `DAILY_MESSAGE_CAP` (default 40) per UTC day. Admins are not capped.

## Limits

- This is a tutor, not an official JEE answer key.
- Password reset is admin-only. There is no email reset.
- Photos stay on your server, visible only to that student.
