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
- `OPENAI_MODEL=gpt-4.1-mini`
- `OPENAI_MOCK=true` (for mock-only mode without API key)

### Run the app
```powershell
uvicorn app:app --reload
```

### Open in browser
Go to:
- `http://127.0.0.1:8000`

---

## 3) How to use

### Text mode
1. Type in the input box.
2. Click **Send** (or press Enter).
3. Avatar transitions: reaction -> thinking -> speaking -> idle.

### Voice mode
1. Click **Start Voice Chat**.
2. Browser listens via Web Speech API.
3. After transcript capture, backend is called.
4. Reply is spoken through `speechSynthesis` (if available).

### Sleep/Wake
- Click **Sleep** to force sleeping state.
- Click **Wake** (same button) to wake up.
- Auto-sleep: after inactivity, avatar becomes sleepy then sleeping.

### Manual testing panels
- **State Test**: quickly set idle/listening/thinking/speaking/sleeping.
- **Emotion Test**: quickly set neutral/happy/excited/sad/concerned/surprised/sleepy/playful.

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

## 7) Final project tree and exact setup commands

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
