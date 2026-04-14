// AC (Eyshee) fullscreen mode
// - One button UI (Speak)
// - Auto sleep after 90s
// - Retro robot design inspired by provided reference

const AUTO_SLEEP_MS = 90_000;
const canvas = document.getElementById("avatarCanvas");
const ctx = canvas.getContext("2d");
const stateBadge = document.getElementById("stateBadge");
const emotionBadge = document.getElementById("emotionBadge");
const speakBtn = document.getElementById("speakBtn");
const errorBanner = document.getElementById("errorBanner");

const state = {
  mode: "idle",
  emotion: "neutral",
  speaking: false,
  lastInteractionAt: Date.now(),
  blink: 1,
  nextBlinkAt: Date.now() + 2000,
  pupilX: 0,
  pupilY: 0,
  targetPupilX: 0,
  targetPupilY: 0,
  sleepiness: 0,
};

function setMode(mode) {
  state.mode = mode;
  stateBadge.textContent = `state: ${mode}`;
}
function setEmotion(emotion) {
  state.emotion = emotion || "neutral";
  emotionBadge.textContent = `emotion: ${state.emotion}`;
}
function markInteraction() {
  state.lastInteractionAt = Date.now();
  if (state.mode === "sleeping") setMode("idle");
}
function showError(text) {
  errorBanner.textContent = text;
  errorBanner.classList.remove("hidden");
}
function clearError() {
  errorBanner.textContent = "";
  errorBanner.classList.add("hidden");
}

const RecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognitionRunning = false;
if (RecognitionClass) {
  recognition = new RecognitionClass();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
}

let activeAudio = null;

async function speakWithHighQuality(text) {
  // Try edge-tts backend first.
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) {
        if (activeAudio) {
          activeAudio.pause();
          activeAudio = null;
        }
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        activeAudio = audio;
        state.speaking = true;
        setMode("speaking");
        await audio.play();
        audio.onended = () => {
          URL.revokeObjectURL(url);
          state.speaking = false;
          setMode("idle");
        };
        return;
      }
    }
  } catch (_) {
    // fallback below
  }

  // Browser fallback
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 0.92;
  u.pitch = 1.15;
  const jpVoice = window.speechSynthesis.getVoices().find((v) => (v.lang || "").toLowerCase().startsWith("ja"));
  if (jpVoice) u.voice = jpVoice;
  u.onstart = () => {
    state.speaking = true;
    setMode("speaking");
  };
  u.onend = () => {
    state.speaking = false;
    setMode("idle");
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

async function sendTranscript(text) {
  markInteraction();
  clearError();
  setMode("thinking");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_text: text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setEmotion(data.emotion || "neutral");
    await speakWithHighQuality(data.reply_text || "うん、聞こえたよ！");
  } catch (err) {
    setMode("idle");
    setEmotion("concerned");
    showError(`応答に失敗しました: ${String(err.message || err)}`);
  }
}

function startListening() {
  markInteraction();
  clearError();
  if (!recognition) {
    showError("このブラウザは音声入力に未対応です。Chrome/Edgeを使ってください。");
    return;
  }
  if (recognitionRunning) return;

  setMode("listening");
  recognitionRunning = true;

  recognition.onresult = async (ev) => {
    const transcript = ev.results?.[0]?.[0]?.transcript?.trim();
    if (!transcript) {
      setMode("idle");
      return;
    }
    await sendTranscript(transcript);
  };
  recognition.onerror = () => {
    recognitionRunning = false;
    setMode("idle");
    showError("音声認識エラー。マイク権限を確認してください。");
  };
  recognition.onend = () => {
    recognitionRunning = false;
    if (state.mode === "listening") setMode("idle");
  };
  recognition.start();
}

function stopListening() {
  if (recognition && recognitionRunning) {
    try { recognition.stop(); } catch (_) {}
  }
}

function drawFace(ts) {
  const t = ts / 1000;
  const w = canvas.width;
  const h = canvas.height;

  // responsive internal canvas
  if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }

  // auto sleep transition
  const idle = Date.now() - state.lastInteractionAt;
  const sleepTarget = idle > AUTO_SLEEP_MS ? 1 : 0;
  state.sleepiness += (sleepTarget - state.sleepiness) * 0.02;
  if (state.sleepiness > 0.92 && state.mode !== "sleeping") setMode("sleeping");
  if (state.sleepiness < 0.3 && state.mode === "sleeping") setMode("idle");

  // blinking + smooth pupils
  if (Date.now() > state.nextBlinkAt) {
    state.blink -= 0.24;
    if (state.blink <= 0) {
      state.blink = 1;
      state.nextBlinkAt = Date.now() + 1500 + Math.random() * 2000;
    }
  }
  if (Math.random() < 0.02) {
    state.targetPupilX = (Math.random() * 2 - 1) * 12;
    state.targetPupilY = (Math.random() * 2 - 1) * 7;
  }
  state.pupilX += (state.targetPupilX - state.pupilX) * 0.08;
  state.pupilY += (state.targetPupilY - state.pupilY) * 0.08;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#a8dacf";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = w * 0.5;
  const cy = h * 0.52 + Math.sin(t * 2) * (2 - state.sleepiness);

  // full-size shell and screen
  ctx.fillStyle = "#d8e8ef";
  ctx.strokeStyle = "#b6cfd9";
  ctx.lineWidth = Math.max(4, w * 0.004);
  // Fill most of the screen so it feels truly fullscreen.
  roundRect(cx - w * 0.43, cy - h * 0.41, w * 0.86, h * 0.82, 42, true, true);

  ctx.fillStyle = "#0b2f4f";
  roundRect(cx - w * 0.34, cy - h * 0.27, w * 0.68, h * 0.54, 34, true, false);

  // Antennas similar to reference model.
  ctx.strokeStyle = "#b6cfd9";
  ctx.lineWidth = Math.max(3, w * 0.003);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.21, cy - h * 0.42);
  ctx.lineTo(cx - w * 0.24, cy - h * 0.48);
  ctx.moveTo(cx + w * 0.21, cy - h * 0.42);
  ctx.lineTo(cx + w * 0.24, cy - h * 0.48);
  ctx.stroke();
  ctx.fillStyle = "#c7dce5";
  ctx.beginPath();
  ctx.arc(cx - w * 0.24, cy - h * 0.48, Math.max(6, w * 0.01), 0, Math.PI * 2);
  ctx.arc(cx + w * 0.24, cy - h * 0.48, Math.max(6, w * 0.01), 0, Math.PI * 2);
  ctx.fill();

  drawExpressiveEyes(cx, cy, w, h, t);
  drawBrows(cx, cy, w, h);
  drawMouth(cx, cy, w, h, t);
}

function drawExpressiveEyes(cx, cy, w, h, t) {
  const mood = state.mode === "sleeping" ? "sleepy" : state.emotion;
  const baseY = cy - h * 0.05;
  const lx = cx - w * 0.12;
  const rx = cx + w * 0.12;
  const r = w * 0.014;

  ctx.strokeStyle = "#93f4ff";
  ctx.fillStyle = "#9df6ff";
  ctx.lineWidth = Math.max(3, w * 0.0024);

  if (mood === "sleepy") {
    // three-dot sleepy face style
    const dotR = Math.max(4, w * 0.006);
    ctx.beginPath();
    ctx.arc(cx - w * 0.05, baseY + h * 0.08, dotR, 0, Math.PI * 2);
    ctx.arc(cx, baseY + h * 0.08, dotR, 0, Math.PI * 2);
    ctx.arc(cx + w * 0.05, baseY + h * 0.08, dotR, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (mood === "concerned") {
    // red angry style from reference
    ctx.fillStyle = "#ff3f47";
    ctx.strokeStyle = "#ff3f47";
    ctx.beginPath();
    ctx.arc(lx, baseY + 4, r, 0, Math.PI * 2);
    ctx.arc(rx, baseY + 4, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(lx - 24, baseY - 22);
    ctx.lineTo(lx + 20, baseY - 8);
    ctx.moveTo(rx - 20, baseY - 8);
    ctx.lineTo(rx + 24, baseY - 22);
    ctx.stroke();
    return;
  }

  if (mood === "sad") {
    ctx.beginPath();
    ctx.arc(lx, baseY + 10, 18, Math.PI * 1.1, Math.PI * 1.9);
    ctx.arc(rx, baseY + 10, 18, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    return;
  }

  // neutral/happy/playful/excited/surprised: dot eyes with variation
  const eyeScale = mood === "surprised" ? 1.8 : mood === "excited" ? 1.4 : 1;
  ctx.beginPath();
  ctx.arc(lx + state.pupilX * 0.3, baseY + state.pupilY * 0.3, r * eyeScale, 0, Math.PI * 2);
  ctx.arc(rx + state.pupilX * 0.3, baseY + state.pupilY * 0.3, r * eyeScale, 0, Math.PI * 2);
  ctx.fill();

  if (mood === "happy" || mood === "playful") {
    ctx.beginPath();
    ctx.arc(lx, baseY - 12, 14, Math.PI * 0.2, Math.PI * 0.8);
    ctx.arc(rx, baseY - 12, 14, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
  }
  if (mood === "playful") {
    // wink
    ctx.beginPath();
    ctx.arc(rx, baseY, 18, Math.PI * 0.2, Math.PI * 1.2);
    ctx.stroke();
  }
  if (state.mode === "listening") {
    // attentive sparkle line
    ctx.strokeStyle = "rgba(157,246,255,0.6)";
    ctx.beginPath();
    ctx.arc(cx, baseY, w * 0.05 + Math.sin(t * 5) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawBrows(cx, cy, w, h) {
  const mood = state.mode === "sleeping" ? "sleepy" : state.emotion;
  const y = cy - h * 0.11;
  const lx = cx - w * 0.12;
  const rx = cx + w * 0.12;

  ctx.strokeStyle = "#9df6ff";
  ctx.lineWidth = Math.max(2, w * 0.002);
  ctx.beginPath();

  if (mood === "concerned" || mood === "sad") {
    ctx.moveTo(lx - 20, y - 6);
    ctx.lineTo(lx + 20, y + 4);
    ctx.moveTo(rx - 20, y + 4);
    ctx.lineTo(rx + 20, y - 6);
  } else if (mood === "excited" || mood === "surprised") {
    ctx.moveTo(lx - 20, y - 10);
    ctx.lineTo(lx + 20, y - 16);
    ctx.moveTo(rx - 20, y - 16);
    ctx.lineTo(rx + 20, y - 10);
  } else if (mood === "sleepy") {
    // no brows when asleep
  } else {
    ctx.moveTo(lx - 20, y - 2);
    ctx.lineTo(lx + 20, y - 2);
    ctx.moveTo(rx - 20, y - 2);
    ctx.lineTo(rx + 20, y - 2);
  }

  ctx.stroke();
}

function drawMouth(cx, cy, w, h, t) {
  const mood = state.mode === "sleeping" ? "sleepy" : state.emotion;
  const speakingOpen = state.speaking ? (Math.sin(t * 18) + 1) * 0.5 : 0;
  ctx.strokeStyle = mood === "concerned" ? "#ff3f47" : "#9df6ff";
  ctx.fillStyle = mood === "concerned" ? "#ff3f47" : "#9df6ff";
  ctx.lineWidth = Math.max(3, w * 0.0024);

  if (mood === "sleepy") return;
  if (mood === "surprised") {
    ctx.beginPath();
    ctx.ellipse(cx, cy + h * 0.09, w * 0.015, h * (0.028 + speakingOpen * 0.03), 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (mood === "sad" || mood === "concerned") {
    ctx.beginPath();
    ctx.arc(cx, cy + h * 0.12, w * 0.04, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    return;
  }
  // happy/neutral/playful/excited
  ctx.beginPath();
  ctx.arc(cx, cy + h * 0.07, w * 0.035, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
  if (state.speaking) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + h * 0.1, w * 0.018, h * (0.02 + speakingOpen * 0.02), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function roundRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

speakBtn.addEventListener("click", () => {
  if (recognitionRunning) stopListening();
  else startListening();
});

// Hold Space to talk; release to stop capture.
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat) return;
  e.preventDefault();
  startListening();
});
window.addEventListener("keyup", (e) => {
  if (e.code !== "Space") return;
  e.preventDefault();
  stopListening();
});

setEmotion("neutral");
setMode("idle");
requestAnimationFrame(drawFace);
