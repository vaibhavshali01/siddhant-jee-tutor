"""Build a Grok Responses API request for one tutor turn.

The model name always comes from XAI_MODEL. Reasoning effort, the code
execution tool, and web search are chosen here so app.py stays a thin caller.
"""

from __future__ import annotations

import os

EFFORTS = ("low", "medium", "high", "xhigh")


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def configured_effort() -> str:
    value = env("XAI_REASONING_EFFORT", "high").lower()
    return value if value in EFFORTS else "high"


def reasoning_effort(mode: str, exam: str, has_image: bool) -> str:
    """Hints and drills stay fast. Advanced papers and photos think harder."""
    if mode == "hint":
        return "low"
    if mode == "practice":
        return "medium"
    hard = has_image or "advanced" in (exam or "").lower()
    if hard:
        return "xhigh"
    return configured_effort()


def use_code_execution(mode: str) -> bool:
    flag = env("XAI_CODE_EXECUTION", "auto").lower()
    if flag in {"0", "false", "off", "no"}:
        return False
    if flag in {"1", "true", "on", "yes"}:
        return True
    return mode == "solve"


def use_web_search() -> bool:
    return env("XAI_WEB_SEARCH", "false").lower() in {"1", "true", "on", "yes"}


def image_detail() -> str:
    value = env("XAI_IMAGE_DETAIL", "high").lower()
    return value if value in {"auto", "low", "high"} else "high"


def timeout_seconds() -> float:
    try:
        return max(30.0, float(env("XAI_TIMEOUT_SECONDS", "900") or "900"))
    except ValueError:
        return 900.0


def tools_for(mode: str) -> list[dict]:
    tools: list[dict] = []
    if use_code_execution(mode):
        tools.append({"type": "code_interpreter"})
    if use_web_search() and mode == "solve":
        tools.append({"type": "web_search"})
    return tools


def tool_note(mode: str) -> str:
    notes = []
    if use_code_execution(mode):
        notes.append(
            "The code execution tool is available. Use it to check arithmetic, powers, and unit conversions before the final answer. Do not show the code or a separate check section. Fold any correction into Substitution and Answer."
        )
    if use_web_search() and mode == "solve":
        notes.append(
            "Web search is available for a constant or a syllabus fact. Do not invent an official year or question number from a search result. Keep the section headings."
        )
    return " ".join(notes)


def response_input(messages: list[dict], has_image: bool) -> list[dict]:
    """Translate stored chat turns into Responses API input items."""
    items = []
    for message in messages:
        role = message.get("role") or "user"
        content = message.get("content")
        if isinstance(content, list):
            parts = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    parts.append({"type": "input_text", "text": str(part.get("text") or "")})
                elif part.get("type") == "image_url":
                    image = part.get("image_url") or {}
                    url = image.get("url") if isinstance(image, dict) else ""
                    if url:
                        parts.append({"type": "input_image", "image_url": url, "detail": image_detail() if has_image else "high"})
            items.append({"role": role, "content": parts or [{"type": "input_text", "text": ""}]})
        else:
            items.append({"role": role, "content": str(content or "")})
    return items


def request_body(
    *,
    model: str,
    messages: list[dict],
    mode: str,
    exam: str,
    has_image: bool,
    conversation_key: str,
    previous_response_id: str | None,
) -> dict:
    effort = reasoning_effort(mode, exam, has_image)
    # Image history should not be stored server-side; the docs warn that storing it can fail.
    store = not has_image
    body = {
        "model": model,
        "input": response_input(messages, has_image) if not (previous_response_id and store) else _chained_turn(messages),
        "reasoning": {"effort": effort},
        "temperature": 0.7,
        "top_p": 0.95,
        "stream": True,
        "store": store,
        "prompt_cache_key": conversation_key,
    }
    if previous_response_id and store:
        body["previous_response_id"] = previous_response_id
    tools = tools_for(mode)
    if tools:
        body["tools"] = tools
    return body


def _chained_turn(messages: list[dict]) -> list[dict]:
    """The provider already has the thread. Send this turn's instructions and the new question."""
    systems = [message for message in messages if message.get("role") == "system"]
    latest = None
    for message in reversed(messages):
        if message.get("role") == "user":
            latest = message
            break
    chosen = systems + ([latest] if latest else [])
    return response_input(chosen or messages, False)
