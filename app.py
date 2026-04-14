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
from io import BytesIO
from typing import Literal

import edge_tts
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from openai import OpenAI


# -----------------------------
# Environment and constants
# -----------------------------
load_dotenv()

VALID_EMOTIONS = {
    "neutral",
    "happy",
    "sad",
    "concerned",
    "surprised",
    "playful",
    "angry",
    "thinking",
    "alert",
    "sleeping",
}

VALID_STATES = {"idle", "listening", "thinking", "speaking", "sleeping"}

DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
INACTIVITY_SECONDS = int(os.getenv("INACTIVITY_SECONDS", "120"))
USE_MOCK_MODE = os.getenv("OPENAI_MOCK", "false").lower() == "true"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
TTS_VOICE = os.getenv("TTS_VOICE", "ja-JP-NanamiNeural")

SYSTEM_PROMPT = """
You are AC (pronounced "Eyshee"): a super positive, cute retro game-console buddy.

Rules:
- Always reply in natural Japanese.
- Be expressive, warm, and easy to understand.
- Do not use emojis.
- Return ONLY strict JSON with these keys:
  - reply_text: string
  - emotion: one of [neutral, happy, sad, concerned, surprised, playful, angry, thinking, alert, sleeping]
  - state_hint: optional one of [idle, listening, thinking, speaking, sleeping]

Emotion guidance:
- neutral: calm normal response
- happy: cheerful, pleased, friendly
- playful: teasing, light joke, mischievous
- surprised: impressed, amazed, startled
- sad: apologetic, disappointed, melancholy
- concerned: worried, empathetic, careful, soft concern
- angry: strong frustration, sharp warning, strong disapproval
- thinking: when the assistant is reasoning, hesitating, or considering
- alert: urgent warning, important notice, high attention
- sleeping: only if the user explicitly talks about sleep, rest, or being tired

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
        "sad",
        "concerned",
        "surprised",
        "playful",
        "angry",
        "thinking",
        "alert",
        "sleeping",
    ]
    state: Literal["idle", "listening", "thinking", "speaking", "sleeping"]
    sleep_recommended: bool


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=800)


# -----------------------------
# Utility helpers
# -----------------------------
LEGACY_EMOTION_MAP = {
    "excited": "happy",
    "sleepy": "sleeping",
}


def _extract_json_object(text: str) -> dict:
    """Extract the first JSON object from a string safely."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def _normalize_emotion(raw_emotion: str | None) -> str | None:
    """Normalize legacy or variant emotion names into the canonical set."""
    if not raw_emotion:
        return None

    emotion = str(raw_emotion).strip().lower()

    if emotion in LEGACY_EMOTION_MAP:
        emotion = LEGACY_EMOTION_MAP[emotion]

    alias_map = {
        "worried": "concerned",
        "anxious": "concerned",
        "careful": "concerned",
        "warning": "alert",
        "urgent": "alert",
        "tired": "sleeping",
        "fun": "playful",
        "mad": "angry",
    }
    emotion = alias_map.get(emotion, emotion)

    return emotion if emotion in VALID_EMOTIONS else None


def _sanitize_emotion(emotion: str | None, fallback_text: str) -> str:
    """Ensure emotion is valid; otherwise infer from text heuristics."""
    normalized = _normalize_emotion(emotion)
    if normalized:
        return normalized

    lowered = fallback_text.lower()

    if any(w in lowered for w in ["urgent", "immediately", "warning", "danger", "important"]):
        return "alert"
    if any(w in lowered for w in ["think", "let me think", "consider", "maybe", "hmm"]):
        return "thinking"
    if any(w in lowered for w in ["wow", "whoa", "amazing", "surprise", "unexpected"]):
        return "surprised"
    if any(w in lowered for w in ["angry", "furious", "annoyed", "frustrated"]):
        return "angry"
    if any(w in lowered for w in ["sorry", "worry", "concern", "careful", "tough", "hard"]):
        return "concerned"
    if any(w in lowered for w in ["sad", "unhappy", "down", "disappointed"]):
        return "sad"
    if any(w in lowered for w in ["sleep", "tired", "rest", "nap"]):
        return "sleeping"
    if any(w in lowered for w in ["joke", "fun", "play", "hehe", "silly"]):
        return "playful"
    if any(w in lowered for w in ["yay", "awesome", "great", "love", "nice", "good", "glad"]):
        return "happy"

    return "neutral"


def _sanitize_state(state_hint: str | None, emotion: str | None = None) -> str:
    if state_hint in VALID_STATES:
        return state_hint

    if emotion == "thinking":
        return "thinking"
    if emotion == "sleeping":
        return "sleeping"

    return "speaking"


def _mock_reply(user_text: str) -> dict:
    """Simple mock conversation used when API key is unavailable."""
    seeds = [
        ("いいね！まずは小さく1ステップだけ一緒に進めよう。", "happy"),
        ("その発想すてき！2つの簡単な手順に分けてみようか。", "happy"),
        ("わかるよ。無理せず、最初の一歩だけ決めよう。", "concerned"),
        ("ナイス質問！短く言うと、小さく始めて少しずつ改善だよ。", "neutral"),
    ]

    lowered = user_text.lower()

    if any(w in lowered for w in ["sad", "upset", "anxious", "stressed", "worried"]):
        return {
            "reply_text": "大丈夫、いっしょに整えよう。深呼吸を1回して、次に小さな行動を1つ決めよう。",
            "emotion": "concerned",
            "state_hint": "speaking",
        }

    if any(w in lowered for w in ["angry", "mad", "furious", "annoyed"]):
        return {
            "reply_text": "それはかなりしんどいね。まず何に一番いら立っているのかを1つだけ切り分けよう。",
            "emotion": "angry",
            "state_hint": "speaking",
        }

    if any(w in lowered for w in ["joke", "fun", "play", "laugh"]):
        return {
            "reply_text": "あそびモード起動。ロボが落ち着いてる理由？気持ちをちゃんと整列してるからだよ。",
            "emotion": "playful",
            "state_hint": "speaking",
        }

    if any(w in lowered for w in ["sleep", "tired", "rest", "nap"]):
        return {
            "reply_text": "休憩しよう。今ちょっと休むと、あとで集中しやすくなるよ。",
            "emotion": "sleeping",
            "state_hint": "sleeping",
        }

    if any(w in lowered for w in ["urgent", "asap", "immediately", "warning"]):
        return {
            "reply_text": "大事なポイントがありそう。まず最優先の1件から確認しよう。",
            "emotion": "alert",
            "state_hint": "speaking",
        }

    if any(w in lowered for w in ["surprised", "wow", "unexpected"]):
        return {
            "reply_text": "それはびっくりだね。状況を1回整理すると次が見えやすいよ。",
            "emotion": "surprised",
            "state_hint": "speaking",
        }

    reply, emotion = random.choice(seeds)
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
        temperature=0.4,
        max_output_tokens=140,
    )

    raw = response.output_text.strip()
    data = _extract_json_object(raw)

    reply_text = str(data.get("reply_text", "聞こえたよ。もう少し教えてね。"))
    emotion = _sanitize_emotion(data.get("emotion"), reply_text)
    state_hint = _sanitize_state(data.get("state_hint"), emotion)

    return {
        "reply_text": reply_text,
        "emotion": emotion,
        "state_hint": state_hint,
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
            reply_text="なにか入力してくれたら手伝えるよ。",
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
        data = {
            "reply_text": "ちょっとだけクラウドがぐらっとしたけど、まだここにいるよ。もう一度ためしてね。",
            "emotion": "concerned",
            "state_hint": "speaking",
        }

    emotion = _sanitize_emotion(data.get("emotion"), data.get("reply_text", ""))
    state_value = _sanitize_state(data.get("state_hint"), emotion)

    return ChatResponse(
        reply_text=str(data.get("reply_text", ""))[:1000],
        emotion=emotion,
        state=state_value,
        sleep_recommended=sleep_recommended,
    )


@app.get("/api/health")
def health() -> dict:
    """Basic status endpoint."""
    return {
        "ok": True,
        "mock_mode": USE_MOCK_MODE or not bool(OPENAI_API_KEY),
        "model": DEFAULT_MODEL,
        "tts_voice": TTS_VOICE,
        "valid_emotions": sorted(VALID_EMOTIONS),
        "valid_states": sorted(VALID_STATES),
    }


@app.post("/api/tts")
async def tts(payload: TTSRequest):
    """Generate higher-quality Japanese speech audio using edge-tts."""
    try:
        communicator = edge_tts.Communicate(payload.text, voice=TTS_VOICE)
        audio = BytesIO()

        async for chunk in communicator.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])

        audio.seek(0)
        return StreamingResponse(audio, media_type="audio/mpeg")
    except Exception:
        return StreamingResponse(BytesIO(b""), media_type="audio/mpeg", status_code=503)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
