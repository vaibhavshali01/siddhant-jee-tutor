"""Per-student study dashboard state.

Stored as one JSON document per user. Dates are ISO calendar dates so the
page can compute "today" in the browser.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

from syllabus_data import ADVANCED, MAIN

SUBJECTS = {
    "physics": "Physics",
    "phy": "Physics",
    "chemistry": "Chemistry",
    "chem": "Chemistry",
    "maths": "Maths",
    "math": "Maths",
    "mathematics": "Maths",
}
ACCENTS = {"indigo", "emerald", "rose", "amber"}
CAUSES = {"Concept", "Calculation", "Silly", "Time"}
TOPIC_STATUS = {"Learning", "Practice", "Done"}
PRIORITIES = {"High", "Medium", "Low"}
LEDGER_TYPES = {"Exam", "Mock", "Revision", "Admin"}
LOG_KINDS = {"study", "note", "checkin", "mock"}


def empty_state() -> dict[str, Any]:
    return {
        "exam": "2027-05-23",
        "accent": "amber",
        "calm": False,
        "goal": 90,
        "next_id": 1,
        "tasks": [],
        "log": [],
        "mistakes": [],
        "ledger": [],
        "topics": [],
        "backlogs": [],
        "lectures": [],
        "materials": [],
        "notes": [],
        "chapters": [],
        "allen_synced_at": "",
    }


def _chapters_from(text: str, scope: str) -> list[dict[str, Any]]:
    subject = "Physics"
    found: list[dict[str, Any]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        key = line.lower().rstrip(":")
        if key in SUBJECTS and ":" not in line:
            subject = SUBJECTS[key]
            continue
        if ":" not in line:
            continue
        name, rest = line.split(":", 1)
        name = name.strip()
        subs = [part.strip() for part in re.split(r"[,;]", rest) if part.strip()]
        if name and subs:
            found.append({"subject": subject, "name": name, "scope": scope, "subs": subs})
    return found


def seed_chapters() -> list[dict[str, Any]]:
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    order: list[tuple[str, str]] = []
    for block, scope in ((MAIN, "M"), (ADVANCED, "A")):
        for chapter in _chapters_from(block, scope):
            key = (chapter["subject"], chapter["name"].lower())
            current = merged.get(key)
            if current is None:
                merged[key] = {
                    "subject": chapter["subject"],
                    "name": chapter["name"],
                    "scope": scope,
                    "subs": list(chapter["subs"]),
                }
                order.append(key)
                continue
            if scope not in current["scope"]:
                current["scope"] += scope
            have = {item.lower() for item in current["subs"]}
            for sub in chapter["subs"]:
                if sub.lower() not in have:
                    current["subs"].append(sub)
                    have.add(sub.lower())
    chapters = []
    next_id = 1
    for key in order:
        chapter = merged[key]
        subs = []
        for name in chapter["subs"]:
            subs.append({"id": next_id, "name": name, "done": False})
            next_id += 1
        chapters.append(
            {
                "id": next_id,
                "subject": chapter["subject"],
                "name": chapter["name"],
                "scope": chapter["scope"],
                "practice": 0,
                "subtopics": subs,
            }
        )
        next_id += 1
    return chapters


def fresh_state() -> dict[str, Any]:
    state = empty_state()
    chapters = seed_chapters()
    state["chapters"] = chapters
    state["next_id"] = 1 + max((item["id"] for item in chapters), default=0)
    for chapter in chapters:
        state["next_id"] = max(state["next_id"], chapter["id"], *(sub["id"] for sub in chapter["subtopics"]))
    state["next_id"] += 1
    return state


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _iso(value: Any, fallback: str) -> str:
    text = _clip(value, 10)
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return fallback


def _items(value: Any, limit: int) -> list[Any]:
    if not isinstance(value, list):
        return []
    return value[:limit]


def sanitize(raw: Any) -> dict[str, Any]:
    """Drop anything that is not part of the dashboard shape."""
    base = empty_state()
    if not isinstance(raw, dict):
        return fresh_state()
    base["exam"] = _iso(raw.get("exam"), "2027-05-23")
    accent = _clip(raw.get("accent"), 20).lower()
    base["accent"] = accent if accent in ACCENTS else "amber"
    base["calm"] = bool(raw.get("calm"))
    try:
        goal = int(raw.get("goal") or 90)
    except (TypeError, ValueError):
        goal = 90
    base["goal"] = goal if goal in {60, 90, 120, 180} else 90
    try:
        base["next_id"] = max(1, int(raw.get("next_id") or 1))
    except (TypeError, ValueError):
        base["next_id"] = 1
    base["allen_synced_at"] = _clip(raw.get("allen_synced_at"), 40)

    for task in _items(raw.get("tasks"), 200):
        if not isinstance(task, dict):
            continue
        text = _clip(task.get("text"), 240)
        if not text:
            continue
        base["tasks"].append(
            {
                "id": int(task.get("id") or 0),
                "text": text,
                "subject": _clip(task.get("subject"), 20) or "Physics",
                "done": bool(task.get("done")),
            }
        )
    for entry in _items(raw.get("log"), 800):
        if not isinstance(entry, dict):
            continue
        kind = _clip(entry.get("kind"), 20)
        if kind not in LOG_KINDS:
            kind = "note"
        try:
            minutes = max(0, min(600, int(entry.get("minutes") or 0)))
        except (TypeError, ValueError):
            minutes = 0
        base["log"].append(
            {
                "id": int(entry.get("id") or 0),
                "day": _iso(entry.get("day"), date.today().isoformat()),
                "time": _clip(entry.get("time"), 5) or "00:00",
                "kind": kind,
                "subject": _clip(entry.get("subject"), 20),
                "minutes": minutes,
                "text": _clip(entry.get("text"), 400),
            }
        )
    for mistake in _items(raw.get("mistakes"), 300):
        if not isinstance(mistake, dict) or not _clip(mistake.get("question"), 400):
            continue
        cause = _clip(mistake.get("cause"), 20)
        base["mistakes"].append(
            {
                "id": int(mistake.get("id") or 0),
                "subject": _clip(mistake.get("subject"), 20) or "Physics",
                "cause": cause if cause in CAUSES else "Concept",
                "question": _clip(mistake.get("question"), 400),
                "fix": _clip(mistake.get("fix"), 400),
                "revised": bool(mistake.get("revised")),
            }
        )
    for item in _items(raw.get("ledger"), 200):
        if not isinstance(item, dict) or not _clip(item.get("title"), 200):
            continue
        kind = _clip(item.get("type"), 20)
        repeat = item.get("repeat") if isinstance(item.get("repeat"), dict) else None
        clean_repeat = None
        if repeat:
            unit = _clip(repeat.get("unit"), 10)
            try:
                count = max(1, min(52, int(repeat.get("n") or 1)))
            except (TypeError, ValueError):
                count = 1
            if unit in {"day", "week", "month", "year"}:
                clean_repeat = {"n": count, "unit": unit}
        base["ledger"].append(
            {
                "id": int(item.get("id") or 0),
                "title": _clip(item.get("title"), 200),
                "type": kind if kind in LEDGER_TYPES else "Admin",
                "due": _iso(item.get("due"), date.today().isoformat()),
                "repeat": clean_repeat,
            }
        )
    for topic in _items(raw.get("topics"), 300):
        if not isinstance(topic, dict) or not _clip(topic.get("name"), 160):
            continue
        status = _clip(topic.get("status"), 20)
        base["topics"].append(
            {
                "id": int(topic.get("id") or 0),
                "subject": _clip(topic.get("subject"), 20) or "Physics",
                "name": _clip(topic.get("name"), 160),
                "status": status if status in TOPIC_STATUS else "Learning",
                "source": _clip(topic.get("source"), 20) or "Manual",
            }
        )
    for backlog in _items(raw.get("backlogs"), 200):
        if not isinstance(backlog, dict) or not _clip(backlog.get("name"), 160):
            continue
        priority = _clip(backlog.get("priority"), 10)
        base["backlogs"].append(
            {
                "id": int(backlog.get("id") or 0),
                "subject": _clip(backlog.get("subject"), 20) or "Physics",
                "name": _clip(backlog.get("name"), 160),
                "priority": priority if priority in PRIORITIES else "Medium",
                "why": _clip(backlog.get("why"), 40) or "Not understood",
                "due": _iso(backlog.get("due"), (date.today() + timedelta(days=7)).isoformat()),
            }
        )
    for lecture in _items(raw.get("lectures"), 400):
        if not isinstance(lecture, dict) or not _clip(lecture.get("title"), 160):
            continue
        try:
            watched = max(0, min(100, int(lecture.get("watched") or 0)))
            minutes = max(5, min(300, int(lecture.get("minutes") or 50)))
        except (TypeError, ValueError):
            watched, minutes = 0, 50
        url = _clip(lecture.get("url"), 400)
        if url and not url.startswith(("http://", "https://")):
            url = ""
        base["lectures"].append(
            {
                "id": int(lecture.get("id") or 0),
                "subject": _clip(lecture.get("subject"), 20) or "Physics",
                "chapter": _clip(lecture.get("chapter"), 160),
                "title": _clip(lecture.get("title"), 160),
                "minutes": minutes,
                "watched": watched,
                "url": url,
            }
        )
    for material in _items(raw.get("materials"), 200):
        if not isinstance(material, dict) or not _clip(material.get("title"), 160):
            continue
        url = _clip(material.get("url"), 400)
        if url and not url.startswith(("http://", "https://")):
            url = ""
        base["materials"].append(
            {
                "id": int(material.get("id") or 0),
                "subject": _clip(material.get("subject"), 20) or "Physics",
                "title": _clip(material.get("title"), 160),
                "note": _clip(material.get("note"), 240),
                "url": url,
            }
        )
    for note in _items(raw.get("notes"), 100):
        if not isinstance(note, dict) or not _clip(note.get("title"), 120):
            continue
        base["notes"].append(
            {
                "id": int(note.get("id") or 0),
                "title": _clip(note.get("title"), 120),
                "body": _clip(note.get("body"), 2000),
            }
        )
    seen_ids = set()
    for chapter in _items(raw.get("chapters"), 400):
        if not isinstance(chapter, dict) or not _clip(chapter.get("name"), 160):
            continue
        subs = []
        for sub in _items(chapter.get("subtopics"), 80):
            if not isinstance(sub, dict) or not _clip(sub.get("name"), 200):
                continue
            sid = int(sub.get("id") or 0)
            if sid in seen_ids:
                continue
            seen_ids.add(sid)
            subs.append({"id": sid, "name": _clip(sub.get("name"), 200), "done": bool(sub.get("done"))})
        try:
            practice = max(0, min(9999, int(chapter.get("practice") or 0)))
        except (TypeError, ValueError):
            practice = 0
        scope = _clip(chapter.get("scope"), 4)
        if scope not in {"M", "A", "MA", "AM"}:
            scope = "MA"
        if scope == "AM":
            scope = "MA"
        base["chapters"].append(
            {
                "id": int(chapter.get("id") or 0),
                "subject": _clip(chapter.get("subject"), 20) or "Physics",
                "name": _clip(chapter.get("name"), 160),
                "scope": scope,
                "practice": practice,
                "subtopics": subs,
            }
        )
    if not base["chapters"]:
        seeded = fresh_state()
        seeded["exam"] = base["exam"]
        seeded["accent"] = base["accent"]
        seeded["calm"] = base["calm"]
        seeded["goal"] = base["goal"]
        return seeded
    return base


def progress(chapter: dict[str, Any]) -> int:
    subs = chapter.get("subtopics") or []
    if not subs:
        return 0
    done = sum(1 for sub in subs if sub.get("done"))
    return round(100 * done / len(subs))


def record_tutor_work(state: dict[str, Any], subject: str, mode: str, text: str, when: datetime) -> dict[str, Any]:
    """Count a solved or drilled question toward today's log and a matching chapter."""
    if mode not in {"solve", "practice"}:
        return state
    mapped = {"Physics": "Physics", "Chemistry": "Chemistry", "Mathematics": "Maths", "Maths": "Maths"}.get(subject, "Physics")
    label = "worked solution" if mode == "solve" else "practice question"
    minutes = 10 if mode == "solve" else 5
    snippet = " ".join(str(text or "").split())[:140] or label
    state = sanitize(state)
    state["next_id"] = int(state["next_id"]) + 1
    state["log"].append(
        {
            "id": state["next_id"],
            "day": when.date().isoformat(),
            "time": when.strftime("%H:%M"),
            "kind": "study",
            "subject": mapped,
            "minutes": minutes,
            "text": f"Tutor · {label} · {snippet}",
        }
    )
    haystack = str(text or "").lower()
    best = None
    for chapter in state["chapters"]:
        if chapter["subject"] != mapped:
            continue
        name = chapter["name"].lower()
        if len(name) >= 5 and name in haystack and (best is None or len(name) > len(best["name"])):
            best = chapter
    if best is not None:
        best["practice"] = int(best.get("practice") or 0) + 1
    return state
