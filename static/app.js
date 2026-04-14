// AC (Eyshee) fullscreen mode
// Original voice/chat logic kept
// Faces rewritten with stronger eye language and clearer emotion separation

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
  blinkStartAt: 0,
  pupilX: 0,
  pupilY: 0,
  targetPupilX: 0,
  targetPupilY: 0,
  sleepiness: 0,
};

function setMode(mode) {
  state.mode = mode;
  if (stateBadge) stateBadge.textContent = `state: ${mode}`;
}

function setEmotion(emotion) {
  state.emotion = emotion || "neutral";
  if (emotionBadge) emotionBadge.textContent = `emotion: ${state.emotion}`;
}

function markInteraction() {
  state.lastInteractionAt = Date.now();
  if (state.mode === "sleeping") setMode("idle");
}

function showError(text) {
  if (!errorBanner) return;
  errorBanner.textContent = text;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  if (!errorBanner) return;
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
          if (state.mode === "speaking") setMode("idle");
        };

        audio.onerror = () => {
          URL.revokeObjectURL(url);
          state.speaking = false;
          if (state.mode === "speaking") setMode("idle");
        };

        return;
      }
    }
  } catch (_) {}

  if (!window.speechSynthesis) return;

  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 0.92;
  u.pitch = 1.15;

  const jpVoice = window.speechSynthesis
    .getVoices()
    .find((v) => (v.lang || "").toLowerCase().startsWith("ja"));

  if (jpVoice) u.voice = jpVoice;

  u.onstart = () => {
    state.speaking = true;
    setMode("speaking");
  };

  u.onend = () => {
    state.speaking = false;
    if (state.mode === "speaking") setMode("idle");
  };

  u.onerror = () => {
    state.speaking = false;
    if (state.mode === "speaking") setMode("idle");
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

  try {
    recognition.start();
  } catch (_) {
    recognitionRunning = false;
    showError("音声認識を開始できませんでした。");
  }
}

function stopListening() {
  if (recognition && recognitionRunning) {
    try {
      recognition.stop();
    } catch (_) {}
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function roundRectPath(x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillRoundRect(x, y, w, h, r, color) {
  roundRectPath(x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeRoundRect(x, y, w, h, r, color, width) {
  roundRectPath(x, y, w, h, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function fillCircle(x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function fillEllipse(x, y, rx, ry, color) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeArc(x, y, r, start, end, color, width) {
  ctx.beginPath();
  ctx.arc(x, y, r, start, end);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
}

function strokeLine(x1, y1, x2, y2, color, width) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
}

function getExpression() {
  if (state.mode === "sleeping") return "sleeping";
  if (state.mode === "thinking") return "thinking";
  if (state.mode === "listening") return "neutral";

  const emotion = (state.emotion || "neutral").toLowerCase();

  if (emotion === "neutral") return "neutral";
  if (emotion === "happy") return "happy";
  if (emotion === "sad") return "sad";
  if (emotion === "surprised") return "surprised";
  if (emotion === "angry") return "angry";
  if (emotion === "playful") return "playful";
  if (emotion === "concerned") return "concerned";
  if (emotion === "thinking") return "thinking";
  if (emotion === "alert") return "alert";
  if (emotion === "sleeping") return "sleeping";

  return "neutral";
}

function updateAnimation(now, t) {
  const idleMs = now - state.lastInteractionAt;
  const sleepTarget = idleMs > AUTO_SLEEP_MS ? 1 : 0;
  state.sleepiness = lerp(state.sleepiness, sleepTarget, 0.02);

  if (state.sleepiness > 0.92 && state.mode !== "sleeping") setMode("sleeping");
  if (state.sleepiness < 0.3 && state.mode === "sleeping") setMode("idle");

  if (now > state.nextBlinkAt) {
    state.blinkStartAt = now;
    state.nextBlinkAt = now + rand(1900, 3600);
  }

  const blinkAge = now - state.blinkStartAt;
  if (blinkAge >= 0 && blinkAge <= 140) {
    const phase = blinkAge / 140;
    state.blink = Math.sin(phase * Math.PI);
  } else {
    state.blink = 1;
  }

  if (Math.random() < 0.018 && !["sleeping", "thinking", "alert"].includes(state.mode)) {
    state.targetPupilX = (Math.random() * 2 - 1) * 4;
    state.targetPupilY = (Math.random() * 2 - 1) * 2.5;
  }

  state.pupilX = lerp(state.pupilX, state.targetPupilX, 0.08);
  state.pupilY = lerp(state.pupilY, state.targetPupilY, 0.08);

  return {
    bob: Math.sin(t * 1.7) * 3,
    speakOpen: state.speaking ? (Math.sin(t * 18) + 1) * 0.5 : 0,
    thinkPulse: (Math.sin(t * 5) + 1) * 0.5,
  };
}

function drawShell(w, h) {
  const unit = Math.min(w, h);
  const shellW = unit * 0.82;
  const shellH = unit * 0.64;
  const shellX = (w - shellW) / 2;
  const shellY = (h - shellH) / 2;

  fillRoundRect(shellX, shellY, shellW, shellH, shellH * 0.23, "#dfe7ea");

  ctx.save();
  ctx.globalAlpha = 0.18;
  fillRoundRect(
    shellX + shellW * 0.035,
    shellY + shellH * 0.04,
    shellW * 0.93,
    shellH * 0.9,
    shellH * 0.21,
    "#ffffff"
  );
  ctx.restore();

  const antennaStemW = Math.max(4, shellW * 0.012);
  const antennaStemH = shellH * 0.11;
  const antennaBallR = shellW * 0.018;
  const antennaY = shellY + shellH * 0.02;
  const leftAntennaX = shellX + shellW * 0.22;
  const rightAntennaX = shellX + shellW * 0.78;

  fillRoundRect(leftAntennaX - antennaStemW / 2, antennaY - antennaStemH, antennaStemW, antennaStemH, antennaStemW / 2, "#c9d3d9");
  fillRoundRect(rightAntennaX - antennaStemW / 2, antennaY - antennaStemH, antennaStemW, antennaStemH, antennaStemW / 2, "#c9d3d9");

  fillCircle(leftAntennaX, antennaY - antennaStemH - antennaBallR * 0.15, antennaBallR, "#c9d3d9");
  fillCircle(rightAntennaX, antennaY - antennaStemH - antennaBallR * 0.15, antennaBallR, "#c9d3d9");

  const screenX = shellX + shellW * 0.13;
  const screenY = shellY + shellH * 0.18;
  const screenW = shellW * 0.74;
  const screenH = shellH * 0.46;

  fillRoundRect(screenX, screenY, screenW, screenH, screenH * 0.44, "#102433");

  ctx.save();
  ctx.globalAlpha = 0.08;
  fillRoundRect(
    screenX + screenW * 0.04,
    screenY + screenH * 0.08,
    screenW * 0.92,
    screenH * 0.82,
    screenH * 0.38,
    "#ffffff"
  );
  ctx.restore();

  return {
    x: screenX,
    y: screenY,
    w: screenW,
    h: screenH,
  };
}

function speakingMouth(cx, y, screen, color, anim, variant = "normal") {
  let width = screen.w * 0.12;
  let height = screen.h * (0.06 + anim.speakOpen * 0.10);

  if (variant === "round") {
    width = screen.w * 0.09;
    height = screen.h * (0.08 + anim.speakOpen * 0.14);
  }

  if (variant === "small") {
    width = screen.w * 0.10;
    height = screen.h * (0.05 + anim.speakOpen * 0.08);
  }

  fillRoundRect(
    cx - width / 2,
    y - height / 2,
    width,
    height,
    Math.min(width, height) * 0.45,
    color
  );
}

function eyeHighlight(x, y, r) {
  fillCircle(x - r * 0.3, y - r * 0.35, r * 0.18, "#ffffff");
}

function drawNeutral(screen, anim) {
  const c = "#7ef2f0";
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2 + anim.bob;
  const eyeY = cy - screen.h * 0.04;
  const dx = screen.w * 0.18;
  const rx = screen.w * 0.06;
  const ry = screen.h * 0.075;
  const mouthY = cy + screen.h * 0.16;
  const lw = Math.max(4, screen.w * 0.02);

  fillEllipse(cx - dx, eyeY, rx, ry, c);
  fillEllipse(cx + dx, eyeY, rx, ry, c);
  eyeHighlight(cx - dx, eyeY, rx);
  eyeHighlight(cx + dx, eyeY, rx);

  if (state.speaking) speakingMouth(cx, mouthY, screen, c, anim, "small");
  else strokeArc(cx, mouthY, screen.w * 0.065, Math.PI * 0.18, Math.PI * 0.82, c, lw);
}

function drawHappy(screen, anim) {
  const c = "#7ef2f0";
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2 + anim.bob;
  const eyeY = cy - screen.h * 0.03;
  const dx = screen.w * 0.18;
  const mouthY = cy + screen.h * 0.16;
  const lw = Math.max(5, screen.w * 0.022);

  // smiling eyes, clearly upward
  strokeArc(cx - dx, eyeY, screen.w * 0.05, Math.PI * 1.15, Math.PI * 1.85, c, lw);
  strokeArc(cx + dx, eyeY, screen.w * 0.05, Math.PI * 1.15, Math.PI * 1.85, c, lw);

  if (state.speaking) speakingMouth(cx, mouthY, screen, c, anim, "small");
  else strokeArc(cx, mouthY, screen.w * 0.09, Math.PI * 0.18, Math.PI * 0.82, c, lw);
}

function drawSad(screen, anim) {
  const c = "#7ef2f0";
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2 + anim.bob;
  const eyeY = cy - screen.h * 0.03;
  const dx = screen.w * 0.18;
  const mouthY = cy + screen.h * 0.17;
  const lw = Math.max(5, screen.w * 0.021);

  // drooping lids, not bored slits
  strokeLine(
    cx - dx - screen.w * 0.05,
    eyeY - screen.h * 0.02,
    cx - dx + screen.w * 0.05,
    eyeY + screen.h * 0.03,
    c,
    lw
  );
  strokeLine(
    cx + dx - screen.w * 0.05,
    eyeY + screen.h * 0.03,
    cx + dx + screen.w * 0.05,
    eyeY - screen.h * 0.02,
    c,
    lw
  );

  if (state.speaking) speakingMouth(cx, mouthY, screen, c, anim, "small");
  else strokeArc(cx, mouthY + screen.h * 0.08, screen.w * 0.07, Math.PI * 1.1, Math.PI * 1.9, c, lw);
}

function drawConcerned(screen, anim) {
  const c = "#7ef2f0";
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2 + anim.bob;
  const eyeY = cy - screen.h * 0.035;
  const browY = eyeY - screen.h * 0.07;
  const dx = screen.w * 0.18;
  const rx = screen.w * 0.045;
  const ry = screen.h * 0.06;
  const mouthY = cy + screen.h * 0.17;
  const lw = Math.max(4, screen.w * 0.02);

  // soft eyes
  fillEllipse(cx - dx, eyeY, rx, ry, c);
  fillEllipse(cx + dx, eyeY, rx, ry, c);

  // worried brows pointing up toward center
  strokeLine(
    cx - dx - screen.w * 0.05,
    browY + screen.h * 0.015,
    cx - dx + screen.w * 0.03,
    browY - screen.h * 0.01,
    c,
    lw
  );
  strokeLine(
    cx + dx - screen.w * 0.03,
    browY - screen.h * 0.01,
    cx + dx + screen.w * 0.05,
    browY + screen.h * 0.015,
    c,
    lw
  );

  if (state.speaking) speakingMouth(cx, mouthY, screen, c, anim, "small");
  else strokeArc(cx, mouthY + screen.h * 0.06, screen.w * 0.055, Math.PI * 1.15, Math.PI * 1.85, c, lw);
}

function drawSurprised(screen, anim) {
  const c = "#7ef2f0";
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2 + anim.bob;
  const eyeY = cy - screen.h * 0.04;
  const dx = screen.w * 0.18;
  const r = screen.w * 0.04;
  const mouthY = cy + screen.h * 0.17;
  const lw = Math.max(5, screen.w * 0.022);

  fillCircle(cx - dx, eyeY, r, c);
  fillCircle(cx + dx, eyeY, r, c);
  eyeHighlight(cx - dx, eyeY, r);
  eyeHighlight(cx + dx, eyeY, r);

  if (state.speaking) speakingMouth(cx, mouthY, screen, c, anim, "round");
  else {
    ctx.beginPath();
    ctx.arc(cx, mouthY, screen.w * 0.038, 0, Math.PI * 2);
    ctx.strokeStyle = c;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function drawAngry(screen, anim) {
  const c = "#ff4c4c";
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2 + anim.bob;
  const eyeY = cy - screen.h * 0.02;
  const dx = screen.w * 0.18;
  const mouthY = cy + screen.h * 0.18;
  const lw = Math.max(6, screen.w * 0.024);

  strokeLine(
    cx - dx - screen.w * 0.055,
    eyeY - screen.h * 0.05,
    cx - dx + screen.w * 0.05,
    eyeY + screen.h * 0.02,
    c,
    lw
  );
  strokeLine(
    cx + dx - screen.w * 0.05,
    eyeY + screen.h * 0.02,
    cx + dx + screen.w * 0.055,
    eyeY - screen.h * 0.05,
    c,
    lw
  );

  if (state.speaking) speakingMouth(cx, mouthY, screen, c, anim, "small");
  else strokeArc(cx, mouthY + screen.h * 0.08, screen.w * 0.08, Math.PI * 1.12, Math.PI * 1.88, c, lw);
}

function drawPlayful(screen, anim) {
  const c = "#7ef2f0";
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2 + anim.bob;
  const eyeY = cy - screen.h * 0.04;
  const dx = screen.w * 0.18;
  const mouthY = cy + screen.h * 0.16;
  const lw = Math.max(5, screen.w * 0.022);
  const openR = screen.w * 0.038;

  // wink left
  strokeLine(
    cx - dx - screen.w * 0.04,
    eyeY,
    cx - dx + screen.w * 0.04,
    eyeY,
    c,
    lw
  );

  fillCircle(cx + dx, eyeY, openR, c);
  eyeHighlight(cx + dx, eyeY, openR);

  if (state.speaking) speakingMouth(cx, mouthY, screen, c, anim, "small");
  else strokeArc(cx, mouthY, screen.w * 0.078, Math.PI * 0.2, Math.PI * 0.82, c, lw);
}

function drawSleeping(screen, anim) {
  const c = "#ff4c4c";
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2 + anim.bob;
  const y = cy + screen.h * 0.08;
  const r = screen.w * 0.013;

  fillCircle(cx - screen.w * 0.06, y, r, c);
  fillCircle(cx, y, r, c);
  fillCircle(cx + screen.w * 0.06, y, r, c);
}

function drawThinking(screen, anim) {
  const c = "#e3d329";
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2 + anim.bob;

  ctx.save();
  ctx.fillStyle = c;
  ctx.font = `bold ${Math.floor(screen.h * 0.5)}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", cx, cy + screen.h * 0.02);
  ctx.restore();

  const dotR = screen.w * 0.011;
  for (let i = 0; i < 3; i += 1) {
    const alpha = 0.45 + (((anim.thinkPulse + i * 0.2) % 1) * 0.55);
    ctx.save();
    ctx.globalAlpha = alpha;
    fillCircle(cx + (i - 1) * screen.w * 0.055, cy + screen.h * 0.22, dotR, c);
    ctx.restore();
  }
}

function drawAlert(screen, anim) {
  const c = "#ff4c4c";
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2 + anim.bob;

  ctx.save();
  ctx.fillStyle = c;
  ctx.font = `bold ${Math.floor(screen.h * 0.54)}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", cx, cy + screen.h * 0.02);
  ctx.restore();
}

function drawFace(screen, anim) {
  const expr = getExpression();

  switch (expr) {
    case "neutral":
      drawNeutral(screen, anim);
      break;
    case "happy":
      drawHappy(screen, anim);
      break;
    case "sad":
      drawConcerned(screen, anim);
      break;
    case "concerned":
      drawConcerned(screen, anim);
      break;
    case "surprised":
      drawSurprised(screen, anim);
      break;
    case "angry":
      drawSad(screen, anim);
      break;
    case "playful":
      drawPlayful(screen, anim);
      break;
    case "sleeping":
      drawSleeping(screen, anim);
      break;
    case "thinking":
      drawThinking(screen, anim);
      break;
    case "alert":
      drawAlert(screen, anim);
      break;
    default:
      drawNeutral(screen, anim);
      break;
  }
}

function render(ts) {
  const now = Date.now();
  const t = ts / 1000;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#f3f3f1";
  ctx.fillRect(0, 0, w, h);

  const anim = updateAnimation(now, t);
  const screen = drawShell(w, h);
  drawFace(screen, anim);

  requestAnimationFrame(render);
}

if (speakBtn) {
  speakBtn.addEventListener("click", () => {
    if (recognitionRunning) stopListening();
    else startListening();
  });
}

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

window.addEventListener("resize", resizeCanvas);

setEmotion("neutral");
setMode("idle");
resizeCanvas();
requestAnimationFrame(render);
