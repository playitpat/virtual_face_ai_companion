# Avatar Companion (Local MVP)

A lightweight desktop web app with:
- **FastAPI backend**
- **Plain HTML/CSS/JS frontend**
- **Canvas animated avatar face**
- Text chat + browser voice input/output (when supported)
- Emotion and behavior state metadata returned by backend

No heavy local dependencies like Whisper, PyTorch, ElevenLabs, or ffmpeg are required.

---

## 1) Project structure

```text
.
├── app.py
├── requirements.txt
├── .env.example
├── README.md
└── static
    ├── index.html
    ├── styles.css
    └── app.js
```

---

## 2) Windows setup (step-by-step)

Open **PowerShell** in this folder.

### Create virtual environment
```powershell
python -m venv .venv
```

### Activate virtual environment
```powershell
.\.venv\Scripts\Activate.ps1
```

### Install dependencies
```powershell
pip install -r requirements.txt
```

### Create `.env`
Copy the sample file and edit it:
```powershell
Copy-Item .env.example .env
```

Set at least:
- `OPENAI_API_KEY=...`

Optional:
- `OPENAI_MODEL=gpt-5.4-mini`
- `OPENAI_MOCK=true` (for mock-only mode without API key)

### Run the app
Option A (recommended during development):
```powershell
uvicorn app:app --reload
```

Option B (beginner shortcut):
```powershell
python app.py
```

### Open in browser
Go to:
- `http://127.0.0.1:8000`

### Run with one-click script (Windows)
You can also double-click `run.bat` (or run it from PowerShell/CMD):
```powershell
.\run.bat
```

What it does:
1. Creates `.venv` if needed
2. Installs dependencies from `requirements.txt`
3. Creates `.env` from `.env.example` if needed
4. Starts the server at `http://127.0.0.1:8000`

---

## 3) How to use

### Text mode
1. Type in the input box.
2. Press **Enter** to send.
3. Avatar transitions: reaction -> thinking -> speaking -> idle.

### Voice mode
1. Click **Start Speaking**.
2. Browser listens via Web Speech API in Japanese (`ja-JP`).
3. After transcript capture, backend is called.
4. Reply is spoken through `speechSynthesis` (if available).

### Sleep/Wake
- Click **Sleep** to force sleeping state.
- Click **Wake** (same button) to wake up.
- Auto-sleep: after inactivity, avatar becomes sleepy then sleeping.

### Minimal controls
- **Start Speaking**: start Japanese microphone input.
- **Stop Speaking**: stop current voice playback.
- **Sleep / Wake**: manually sleep or wake the avatar.

---

## 4) Backend API

### `POST /api/chat`
Request:
```json
{ "user_text": "Hello there" }
```

Response:
```json
{
  "reply_text": "Hi! Nice to hear from you.",
  "emotion": "happy",
  "state": "speaking",
  "sleep_recommended": false
}
```

Notes:
- Backend prompts the model to return JSON with `reply_text`, `emotion`, and optional `state_hint`.
- Emotion/state are sanitized to approved values.
- If API key is missing or request fails, backend falls back to mock responses.

---

## 5) Current limitations

- Browser voice input requires a compatible browser (typically Chromium-based).
- Voice quality and available voices depend on OS/browser speech engine.
- No long-term memory yet (session is short-lived and stateless).
- Emotion inference is basic (model-guided + lightweight validation).

---

## 6) Suggested future upgrades

- Memory (short-term + long-term summaries)
- Local STT option (offline speech-to-text)
- Better voice selection and personality presets
- Optional face tracking for gaze/head behavior
- Persistent user profiles and preferences

---

## 7) Troubleshooting

### App opens, but chat fails
- Confirm the server terminal is still running.
- Open `http://127.0.0.1:8000/api/health` and verify you get JSON.
- Check `.env` has a valid `OPENAI_API_KEY`.
- If your network/API key is unavailable, set `OPENAI_MOCK=true` in `.env` and restart.

### Voice chat button does not listen
- Use a Chromium-based browser (Chrome/Edge).
- Allow microphone permission in browser site settings.
- Japanese recognition is fixed to `ja-JP` in this simplified UI.
- If unsupported, use text chat (it works without voice APIs).

### No spoken reply audio
- Raise device/system volume.
- The app auto-selects a Japanese voice when available.
- Check if your browser exposes `speechSynthesis` voices (some load after page start).

### Auto-sleep feels too fast/slow
- Auto-sleep currently uses a simple built-in timeout (`AUTO_SLEEP_MS` in `static/app.js`).

---

## 8) Final project tree and exact setup commands

### Final project tree
```text
.
├── app.py
├── requirements.txt
├── .env.example
├── README.md
└── static
    ├── index.html
    ├── styles.css
    └── app.js
```

### Exact setup commands (Windows PowerShell)
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Edit .env and set OPENAI_API_KEY
uvicorn app:app --reload
```
