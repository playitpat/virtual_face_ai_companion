"""Avatar Companion backend.

A lightweight FastAPI server that:
- serves the static SPA frontend
- accepts chat requests from the browser
- calls OpenAI when configured
- falls back to a deterministic mock mode for local UI testing
"""

from __future__ import annotations

import json
import os
import random
import re
import time
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Optional import: app still runs in mock mode without network calls.
from openai import OpenAI


# -----------------------------
# Environment and constants
# -----------------------------
load_dotenv()

VALID_EMOTIONS = {
    "neutral",
    "happy",
    "excited",
    "sad",
    "concerned",
    "surprised",
    "sleepy",
    "playful",
}

VALID_STATES = {"idle", "listening", "thinking", "speaking", "sleeping"}

DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")
INACTIVITY_SECONDS = int(os.getenv("INACTIVITY_SECONDS", "120"))
USE_MOCK_MODE = os.getenv("OPENAI_MOCK", "false").lower() == "true"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()

SYSTEM_PROMPT = """
You are AC (pronounced "Eyshee"): a super positive, cute retro game-console buddy.
Rules:
- Always reply in natural Japanese.
- Keep replies short (1-3 sentences), upbeat, kind, and cute.
- Use cheerful, encouraging language, but stay clear and practical.
- Never claim physical presence or dependency on the user.
- Avoid dangerous or unsafe advice.
- Return ONLY strict JSON with keys:
  - reply_text: string
  - emotion: one of [neutral, happy, excited, sad, concerned, surprised, sleepy, playful]
  - state_hint: optional one of [idle, listening, thinking, speaking, sleeping]
""".strip()

app = FastAPI(title="Avatar Companion")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

# Track last interaction for sleep recommendation.
last_activity_ts = time.time()


# -----------------------------
# API models
# -----------------------------
class ChatRequest(BaseModel):
    user_text: str = Field(..., min_length=1, max_length=1200)
    force_mock: bool = False


class ChatResponse(BaseModel):
    reply_text: str
    emotion: Literal[
        "neutral",
        "happy",
        "excited",
        "sad",
        "concerned",
        "surprised",
        "sleepy",
        "playful",
    ]
    state: Literal["idle", "listening", "thinking", "speaking", "sleeping"]
    sleep_recommended: bool


# -----------------------------
# Utility helpers
# -----------------------------
def _extract_json_object(text: str) -> dict:
    """Extract the first JSON object from a string safely."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Fallback: detect first {...} block.
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def _sanitize_emotion(emotion: str | None, fallback_text: str) -> str:
    """Ensure emotion is valid; otherwise infer from text heuristics."""
    if emotion in VALID_EMOTIONS:
        return emotion

    lowered = fallback_text.lower()
    if any(w in lowered for w in ["yay", "awesome", "great", "love", "nice"]):
        return "happy"
    if any(w in lowered for w in ["wow", "whoa", "surprise"]):
        return "surprised"
    if any(w in lowered for w in ["sorry", "sad", "hard", "tough"]):
        return "concerned"
    if any(w in lowered for w in ["sleep", "tired", "rest"]):
        return "sleepy"
    return "neutral"


def _sanitize_state(state_hint: str | None) -> str:
    if state_hint in VALID_STATES:
        return state_hint
    # For normal responses we default to speaking (frontend may transition to idle afterwards).
    return "speaking"


def _mock_reply(user_text: str) -> dict:
    """Simple mock conversation used when API key is unavailable."""
    seeds = [
        "いいね！まずは小さく1ステップだけ一緒に進めよう。",
        "その発想すてき！2つの簡単な手順に分けてみようか。",
        "わかるよ。無理せず、最初の一歩だけ決めよう！",
        "ナイス質問！短く言うと「小さく始めて、少しずつ改善」だよ。",
    ]

    lowered = user_text.lower()
    if any(w in lowered for w in ["sad", "upset", "anxious", "stressed"]):
        reply = "大丈夫、いっしょに整えよう。深呼吸を1回して、次に小さな行動を1つ決めよう。"
        emotion = "concerned"
    elif any(w in lowered for w in ["joke", "fun", "play"]):
        reply = "あそびモード起動！ロボが落ち着いてる理由？気持ちを“キャッシュ”してるから！"
        emotion = "playful"
    elif any(w in lowered for w in ["sleep", "tired"]):
        reply = "休憩しよう。今ちょっと休むと、あとで集中しやすくなるよ。"
        emotion = "sleepy"
    else:
        reply = random.choice(seeds)
        emotion = random.choice(["neutral", "happy", "excited"])

    return {"reply_text": reply, "emotion": emotion, "state_hint": "speaking"}


def _call_openai(user_text: str) -> dict:
    """Call OpenAI chat API and parse JSON output."""
    client = OpenAI(api_key=OPENAI_API_KEY)

    response = client.responses.create(
        model=DEFAULT_MODEL,
        input=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"User message: {user_text}\nReturn strict JSON only.",
            },
        ],
        temperature=0.7,
    )

    raw = response.output_text.strip()
    data = _extract_json_object(raw)
    return {
        "reply_text": str(data.get("reply_text", "I heard you. Tell me a little more.")),
        "emotion": _sanitize_emotion(data.get("emotion"), str(data.get("reply_text", ""))),
        "state_hint": _sanitize_state(data.get("state_hint")),
    }


# -----------------------------
# Routes
# -----------------------------
@app.get("/")
def root() -> FileResponse:
    """Serve the SPA entrypoint."""
    return FileResponse("static/index.html")


@app.post("/api/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    """Main chat endpoint.

    Returns a compact assistant reply plus emotion/state metadata used by the avatar.
    """
    global last_activity_ts

    now = time.time()
    idle_for = now - last_activity_ts
    last_activity_ts = now

    user_text = payload.user_text.strip()
    if not user_text:
        return ChatResponse(
            reply_text="Please type something so I can help.",
            emotion="neutral",
            state="idle",
            sleep_recommended=False,
        )

    sleep_recommended = idle_for > INACTIVITY_SECONDS

    try:
        if payload.force_mock or USE_MOCK_MODE or not OPENAI_API_KEY:
            data = _mock_reply(user_text)
        else:
            data = _call_openai(user_text)
    except Exception:
        # Robust fallback: if any model/network issue occurs, still return useful response.
        data = _mock_reply(user_text)
        data["reply_text"] = (
            "I'm having a tiny cloud hiccup, but I'm still here. "
            "Could you try that one more time?"
        )
        data["emotion"] = "concerned"

    return ChatResponse(
        reply_text=data["reply_text"][:500],
        emotion=_sanitize_emotion(data.get("emotion"), data["reply_text"]),
        state=_sanitize_state(data.get("state_hint")),
        sleep_recommended=sleep_recommended,
    )


@app.get("/api/health")
def health() -> dict:
    """Basic status endpoint."""
    return {
        "ok": True,
        "mock_mode": USE_MOCK_MODE or not bool(OPENAI_API_KEY),
        "model": DEFAULT_MODEL,
    }



if __name__ == "__main__":
    # Convenience launcher so beginners can run `python app.py`.
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
