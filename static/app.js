// Avatar Companion frontend (light UI)
// - BMO-inspired (original) retro robot face on canvas
// - Minimal controls: Start Speaking / Stop Speaking / Sleep
// - Japanese-first STT/TTS behavior

const STATES = ["idle", "listening", "thinking", "speaking", "sleeping"];
const AUTO_SLEEP_MS = 90_000;

const appState = {
  state: "idle",
  emotion: "neutral",
  speakingNow: false,
  manualSleep: false,
  lastInteractionAt: Date.now(),
  blink: 1,
  nextBlinkAt: Date.now() + 1800,
  pupilX: 0,
  pupilY: 0,
  pupilTX: 0,
  pupilTY: 0,
  mouthPhase: 0,
};

const canvas = document.getElementById("avatarCanvas");
const ctx = canvas.getContext("2d");
const stateBadge = document.getElementById("stateBadge");
const emotionBadge = document.getElementById("emotionBadge");
const chatLog = document.getElementById("chatLog");
const textInput = document.getElementById("textInput");
const voiceBtn = document.getElementById("voiceBtn");
const stopSpeakBtn = document.getElementById("stopSpeakBtn");
const sleepBtn = document.getElementById("sleepBtn");
const errorBanner = document.getElementById("errorBanner");

const RecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (RecognitionClass) {
  recognition = new RecognitionClass();
  recognition.lang = "ja-JP"; // Japanese recognition by default
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
}

let japaneseVoice = null;
function refreshJapaneseVoice() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  japaneseVoice = voices.find((v) => (v.lang || "").toLowerCase().startsWith("ja")) || null;
}
refreshJapaneseVoice();
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = refreshJapaneseVoice;

function setState(s) {
  if (!STATES.includes(s)) return;
  appState.state = s;
  stateBadge.textContent = `state: ${s}`;
}

function setEmotion(e) {
  appState.emotion = e;
  emotionBadge.textContent = `emotion: ${e}`;
}

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = `${role === "user" ? "You" : "Avatar"}: ${text}`;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.textContent = "";
  errorBanner.classList.add("hidden");
}

function markInteraction() {
  appState.lastInteractionAt = Date.now();
  if (appState.state === "sleeping") wakeUp();
}

function goSleep(manual = false) {
  appState.manualSleep = manual;
  setState("sleeping");
  setEmotion("sleepy");
  sleepBtn.textContent = "😊 Wake";
}

function wakeUp() {
  appState.manualSleep = false;
  setState("idle");
  setEmotion("happy");
  sleepBtn.textContent = "😴 Sleep";
}

async function sendChat(text) {
  markInteraction();
  clearError();
  setState("thinking");
  addMessage("user", text);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_text: text }),
    });
    if (!res.ok) {
      throw new Error(`Server error ${res.status}`);
    }

    const data = await res.json();
    setEmotion(data.emotion || "neutral");
    setState("speaking");
    addMessage("assistant", data.reply_text || "うまく受け取れなかったので、もう一度お願い！");

    if (window.speechSynthesis) {
      speakJapanese(data.reply_text || "了解！");
    } else {
      setState(appState.manualSleep ? "sleeping" : "idle");
    }
  } catch (err) {
    setEmotion("concerned");
    setState("idle");
    const m = `通信エラー: ${String(err.message || err)}。サーバー起動とAPIキーを確認してね。`;
    addMessage("assistant", m);
    showError(m);
  }
}

function speakJapanese(text) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  // Slightly slower + higher pitch tends to feel less robotic in many system voices.
  u.rate = 0.92;
  u.pitch = 1.18;
  if (japaneseVoice) u.voice = japaneseVoice;

  u.onstart = () => {
    appState.speakingNow = true;
    setState("speaking");
  };
  u.onend = () => {
    appState.speakingNow = false;
    setState(appState.manualSleep ? "sleeping" : "idle");
  };
  u.onerror = () => {
    appState.speakingNow = false;
    setState("idle");
    showError("音声読み上げに失敗しました。別のブラウザ音声を試してね。");
  };

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function startVoiceChat() {
  markInteraction();
  clearError();

  if (!recognition) {
    showError("このブラウザは音声入力に未対応です。テキスト入力を使ってください。");
    return;
  }

  setState("listening");
  setEmotion("neutral");

  recognition.onresult = async (ev) => {
    const transcript = ev.results?.[0]?.[0]?.transcript?.trim();
    if (!transcript) {
      showError("音声がうまく取れませんでした。もう一度お願いします。");
      setState("idle");
      return;
    }
    await sendChat(transcript);
  };

  recognition.onerror = () => {
    showError("マイク認識エラーです。ブラウザのマイク権限を確認してください。");
    setState("idle");
  };

  recognition.start();
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  appState.speakingNow = false;
  setState(appState.manualSleep ? "sleeping" : "idle");
}

function updateLife() {
  const idleMs = Date.now() - appState.lastInteractionAt;
  if (!appState.manualSleep && idleMs > AUTO_SLEEP_MS) goSleep(false);

  if (Date.now() > appState.nextBlinkAt) {
    appState.blink -= 0.28;
    if (appState.blink <= 0) {
      appState.blink = 1;
      appState.nextBlinkAt = Date.now() + 1200 + Math.random() * 1800;
    }
  }

  if (Math.random() < 0.015) {
    appState.pupilTX = (Math.random() * 2 - 1) * 4;
    appState.pupilTY = (Math.random() * 2 - 1) * 3;
  }
  appState.pupilX += (appState.pupilTX - appState.pupilX) * 0.08;
  appState.pupilY += (appState.pupilTY - appState.pupilY) * 0.08;
}

function drawBmoFace(ts) {
  updateLife();
  const t = ts / 1000;
  const bob = appState.state === "sleeping" ? Math.sin(t * 1.8) * 1.2 : Math.sin(t * 2.4) * 3;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#d8f4ef";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2 + bob);

  // Body/face shell (BMO-inspired, but original)
  ctx.fillStyle = "#84d4c8";
  ctx.strokeStyle = "#4fa89a";
  ctx.lineWidth = 6;
  roundRect(ctx, -120, -105, 240, 210, 26, true, true);

  // Screen
  ctx.fillStyle = "#b5efd6";
  roundRect(ctx, -90, -72, 180, 126, 14, true, false);

  // Eyes
  const eyeY = -20 + (appState.state === "listening" ? -2 : 0);
  const eyeH = Math.max(2, 14 * appState.blink * (appState.state === "sleeping" ? 0.45 : 1));
  ctx.fillStyle = "#234b46";
  roundRect(ctx, -56, eyeY, 34, eyeH, 6, true, false);
  roundRect(ctx, 22, eyeY, 34, eyeH, 6, true, false);

  // Pupils/highlights
  ctx.fillStyle = "#e7fff8";
  ctx.beginPath();
  ctx.arc(-39 + appState.pupilX, eyeY + 4 + appState.pupilY, 2.6, 0, Math.PI * 2);
  ctx.arc(39 + appState.pupilX, eyeY + 4 + appState.pupilY, 2.6, 0, Math.PI * 2);
  ctx.fill();

  // Mouth (friendlier and less robotic movement)
  const baseMouth = appState.state === "sleeping" ? 4 : 10;
  const talk = appState.speakingNow ? Math.abs(Math.sin((appState.mouthPhase += 0.38)) * 9) : 0;
  const mouthH = baseMouth + talk;
  const mouthY = 24;
  ctx.fillStyle = "#245b4c";
  roundRect(ctx, -26, mouthY, 52, mouthH, 7, true, false);

  // Simple button accents for console vibe
  ctx.fillStyle = "#f8dd67";
  ctx.beginPath();
  ctx.arc(-55, 79, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff8da0";
  ctx.beginPath();
  ctx.arc(58, 79, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  requestAnimationFrame(drawBmoFace);
}

function roundRect(c, x, y, w, h, r, fill, stroke) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
  if (fill) c.fill();
  if (stroke) c.stroke();
}

voiceBtn.addEventListener("click", startVoiceChat);
stopSpeakBtn.addEventListener("click", stopSpeaking);
sleepBtn.addEventListener("click", () => {
  markInteraction();
  if (appState.state === "sleeping") wakeUp();
  else goSleep(true);
});

textInput.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = "";
  await sendChat(text);
});

addMessage("assistant", "こんにちは！ボクは前向きアシスタント。日本語で話してね 🌟");
requestAnimationFrame(drawBmoFace);
