// Avatar Companion frontend
// Plain JS + canvas avatar rendering + state machine + text/voice chat orchestration.

// ------------------------------
// Constants and app state
// ------------------------------
const STATES = ["idle", "listening", "thinking", "speaking", "sleeping"];
const EMOTIONS = [
  "neutral",
  "happy",
  "excited",
  "sad",
  "concerned",
  "surprised",
  "sleepy",
  "playful",
];

const AUTO_SLEEP_MS = 90_000;
const SLEEPY_MS = 70_000;

const appState = {
  state: "idle",
  emotion: "neutral",
  manualSleep: false,
  speakingEnabled: true,
  speakingNow: false,
  mouthTalkPhase: 0,
  lastInteractionAt: Date.now(),
  // Animation internals
  blinkValue: 1,
  nextBlinkAt: Date.now() + 2200,
  pupilX: 0,
  pupilY: 0,
  pupilTargetX: 0,
  pupilTargetY: 0,
  nextPupilMoveAt: Date.now() + 1200,
};

// ------------------------------
// DOM references
// ------------------------------
const canvas = document.getElementById("avatarCanvas");
const ctx = canvas.getContext("2d");
const stateBadge = document.getElementById("stateBadge");
const emotionBadge = document.getElementById("emotionBadge");
const chatLog = document.getElementById("chatLog");
const textInput = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");
const voiceBtn = document.getElementById("voiceBtn");
const stopSpeakBtn = document.getElementById("stopSpeakBtn");
const sleepBtn = document.getElementById("sleepBtn");
const stateTests = document.getElementById("stateTests");
const emotionTests = document.getElementById("emotionTests");

// ------------------------------
// Speech recognition setup
// ------------------------------
const RecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognitionActive = false;
if (RecognitionClass) {
  recognition = new RecognitionClass();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
}

// ------------------------------
// Helper functions
// ------------------------------
function setState(nextState) {
  if (!STATES.includes(nextState)) return;
  appState.state = nextState;
  stateBadge.textContent = `state: ${nextState}`;
}

function setEmotion(nextEmotion) {
  if (!EMOTIONS.includes(nextEmotion)) return;
  appState.emotion = nextEmotion;
  emotionBadge.textContent = `emotion: ${nextEmotion}`;
}

function markInteraction() {
  appState.lastInteractionAt = Date.now();
  if (appState.state === "sleeping") {
    wakeUp();
  }
}

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = `${role === "user" ? "You" : "Avatar"}: ${text}`;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.02;
  utter.pitch = 1.1;

  utter.onstart = () => {
    appState.speakingNow = true;
    setState("speaking");
  };
  utter.onend = () => {
    appState.speakingNow = false;
    if (!appState.manualSleep && appState.state !== "sleeping") {
      setState("idle");
    }
  };
  utter.onerror = () => {
    appState.speakingNow = false;
    setState("idle");
  };

  window.speechSynthesis.speak(utter);
}

function stopSpeaking() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  appState.speakingNow = false;
  if (appState.state !== "sleeping") {
    setState("idle");
  }
}

function goSleep(manual = false) {
  appState.manualSleep = manual || appState.manualSleep;
  setEmotion("sleepy");
  setState("sleeping");
  sleepBtn.textContent = "Wake";
}

function wakeUp() {
  appState.manualSleep = false;
  setState("idle");
  setEmotion("happy");
  sleepBtn.textContent = "Sleep";
}

async function sendChat(userText, useVoiceReply = true) {
  markInteraction();
  addMessage("user", userText);

  // Short reactive shift before thinking.
  setEmotion("playful");
  await new Promise((r) => setTimeout(r, 120));
  setState("thinking");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_text: userText }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const reply = data.reply_text || "I may have missed that. Could you try again?";
    addMessage("assistant", reply);
    setEmotion(data.emotion || "neutral");
    setState(data.state || "speaking");

    if (data.sleep_recommended && !appState.manualSleep) {
      // Soft suggestion via expression; avoid forced sleep right away.
      if (appState.state !== "sleeping") setEmotion("sleepy");
    }

    if (useVoiceReply && window.speechSynthesis) {
      speakText(reply);
    } else if (!appState.manualSleep) {
      setState("idle");
    }
  } catch (err) {
    console.error(err);
    addMessage("assistant", "Oops—something went wrong. Please try again.");
    setEmotion("concerned");
    setState("idle");
  }
}

// ------------------------------
// Voice flow
// ------------------------------
function startVoiceChat() {
  markInteraction();

  if (!recognition) {
    addMessage("assistant", "Voice input is not available in this browser. Text still works great.");
    setEmotion("concerned");
    return;
  }

  if (recognitionActive) return;
  recognitionActive = true;
  setState("listening");
  setEmotion("neutral");

  recognition.onresult = async (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    recognitionActive = false;
    if (!transcript) {
      setEmotion("concerned");
      setState("idle");
      return;
    }
    await sendChat(transcript, true);
  };

  recognition.onerror = () => {
    recognitionActive = false;
    setEmotion("concerned");
    setState("idle");
    addMessage("assistant", "I couldn't hear that clearly. Try again or type your message.");
  };

  recognition.onend = () => {
    if (recognitionActive) {
      recognitionActive = false;
      if (appState.state === "listening") setState("idle");
    }
  };

  recognition.start();
}

// ------------------------------
// Canvas avatar rendering
// ------------------------------
function emotionTuning(emotion) {
  const map = {
    neutral: { eyeOpen: 1, browTilt: 0, mouthCurve: 0, bob: 1, blinkMs: 2600, blush: 0 },
    happy: { eyeOpen: 0.9, browTilt: -0.2, mouthCurve: 0.8, bob: 1.2, blinkMs: 2200, blush: 0.35 },
    excited: { eyeOpen: 1.1, browTilt: -0.35, mouthCurve: 0.9, bob: 1.5, blinkMs: 1800, blush: 0.25 },
    sad: { eyeOpen: 0.7, browTilt: 0.35, mouthCurve: -0.6, bob: 0.6, blinkMs: 3200, blush: 0 },
    concerned: { eyeOpen: 0.85, browTilt: 0.2, mouthCurve: -0.25, bob: 0.9, blinkMs: 2400, blush: 0 },
    surprised: { eyeOpen: 1.25, browTilt: -0.1, mouthCurve: 0.15, bob: 1.1, blinkMs: 1700, blush: 0.1 },
    sleepy: { eyeOpen: 0.45, browTilt: 0.15, mouthCurve: -0.1, bob: 0.45, blinkMs: 900, blush: 0 },
    playful: { eyeOpen: 0.95, browTilt: -0.25, mouthCurve: 0.45, bob: 1.3, blinkMs: 2000, blush: 0.15 },
  };
  return map[emotion] || map.neutral;
}

function updateAutoSleep() {
  if (appState.manualSleep) return;

  const idleMs = Date.now() - appState.lastInteractionAt;
  if (idleMs >= AUTO_SLEEP_MS && appState.state !== "sleeping") {
    goSleep(false);
  } else if (idleMs >= SLEEPY_MS && appState.state === "idle") {
    setEmotion("sleepy");
  }
}

function animateAvatar(ts) {
  updateAutoSleep();

  const t = ts / 1000;
  const emo = emotionTuning(appState.emotion);

  // Blink scheduler influenced by emotion/state.
  if (Date.now() > appState.nextBlinkAt) {
    appState.blinkValue = Math.max(0, appState.blinkValue - 0.28);
    if (appState.blinkValue <= 0) {
      appState.nextBlinkAt = Date.now() + emo.blinkMs + Math.random() * 800;
    }
  } else {
    appState.blinkValue = Math.min(1, appState.blinkValue + 0.2);
  }

  if (Date.now() > appState.nextPupilMoveAt) {
    const attentiveBoost = appState.state === "listening" ? 1.3 : 1;
    appState.pupilTargetX = (Math.random() * 2 - 1) * 7 * attentiveBoost;
    appState.pupilTargetY = (Math.random() * 2 - 1) * 5;
    appState.nextPupilMoveAt = Date.now() + 800 + Math.random() * 1200;
  }
  appState.pupilX += (appState.pupilTargetX - appState.pupilX) * 0.07;
  appState.pupilY += (appState.pupilTargetY - appState.pupilY) * 0.07;

  // Base bobbing (breathing) and state-modulated motion.
  let bobAmp = 6 * emo.bob;
  if (appState.state === "thinking") bobAmp += 3;
  if (appState.state === "sleeping") bobAmp = 2;
  const bobY = Math.sin(t * 2.1) * bobAmp;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background glow
  ctx.fillStyle = "#f7f8ff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2 + bobY;

  // Head
  ctx.save();
  ctx.translate(cx, cy);
  const tilt = appState.state === "thinking" ? Math.sin(t * 1.7) * 0.08 : 0;
  ctx.rotate(tilt);

  ctx.fillStyle = "#ffe6d7";
  ctx.beginPath();
  ctx.ellipse(0, 0, 115, 105, 0, 0, Math.PI * 2);
  ctx.fill();

  // Blush
  if (emo.blush > 0) {
    ctx.globalAlpha = emo.blush;
    ctx.fillStyle = "#ff95a8";
    ctx.beginPath();
    ctx.ellipse(-58, 16, 16, 10, 0, 0, Math.PI * 2);
    ctx.ellipse(58, 16, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Eyes
  const eyeOpen = emo.eyeOpen * appState.blinkValue * (appState.state === "sleeping" ? 0.2 : 1);
  drawEye(-45, -18, eyeOpen, emo, t);
  drawEye(45, -18, eyeOpen, emo, t);

  // Eyebrows
  drawBrow(-45, -52, emo.browTilt, true);
  drawBrow(45, -52, emo.browTilt, false);

  // Mouth with speaking variation
  drawMouth(0, 44, emo.mouthCurve, t);

  // Tiny body bubble
  ctx.fillStyle = "#dce3ff";
  ctx.beginPath();
  ctx.ellipse(0, 145, 72, 30 + Math.sin(t * 2) * 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  requestAnimationFrame(animateAvatar);
}

function drawEye(x, y, openness, emo, t) {
  const w = 28;
  const h = Math.max(2, 14 * openness);
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pupils: slightly larger when listening for attentive effect.
  const pupilScale = appState.state === "listening" ? 1.2 : 1;
  const px = x + appState.pupilX;
  const py = y + appState.pupilY;
  ctx.fillStyle = "#2c3354";
  ctx.beginPath();
  ctx.ellipse(px, py, 7 * pupilScale, 8 * pupilScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Playful wink pulse.
  if (appState.emotion === "playful") {
    ctx.strokeStyle = "#2d355a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 24, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }

  if (appState.state === "thinking") {
    ctx.strokeStyle = "rgba(72,82,130,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 34 + Math.sin(t * 3) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawBrow(x, y, tilt, left) {
  const dir = left ? 1 : -1;
  ctx.strokeStyle = "#5d4a44";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x - 18, y + tilt * 14 * dir);
  ctx.lineTo(x + 18, y - tilt * 14 * dir);
  ctx.stroke();
}

function drawMouth(x, y, curve, t) {
  // Speaking mouth: layered sinusoidal variation instead of binary open/close.
  if (appState.speakingNow || appState.state === "speaking") {
    appState.mouthTalkPhase += 0.35;
  } else {
    appState.mouthTalkPhase *= 0.9;
  }

  const talk = Math.abs(Math.sin(appState.mouthTalkPhase) * 8 + Math.sin(appState.mouthTalkPhase * 0.5) * 2);
  const sleepClamp = appState.state === "sleeping" ? 1 : 0;
  const openH = Math.max(2, 8 + curve * 4 + talk * (1 - sleepClamp));

  ctx.fillStyle = "#b35668";
  ctx.beginPath();
  ctx.ellipse(x, y, 24, openH, 0, 0, Math.PI * 2);
  ctx.fill();

  // Lip line to help expression when not speaking strongly.
  ctx.strokeStyle = "#8e4454";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 20, y);
  ctx.quadraticCurveTo(x, y + curve * 10 + Math.sin(t * 1.3), x + 20, y);
  ctx.stroke();
}

// ------------------------------
// UI setup and events
// ------------------------------
function createTestButtons() {
  STATES.forEach((s) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = s;
    b.onclick = () => {
      markInteraction();
      if (s === "sleeping") {
        goSleep(true);
      } else {
        appState.manualSleep = false;
        sleepBtn.textContent = "Sleep";
        setState(s);
      }
    };
    stateTests.appendChild(b);
  });

  EMOTIONS.forEach((e) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = e;
    b.onclick = () => {
      markInteraction();
      setEmotion(e);
    };
    emotionTests.appendChild(b);
  });
}

sendBtn.addEventListener("click", async () => {
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = "";
  await sendChat(text, true);
});

textInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const text = textInput.value.trim();
    if (!text) return;
    textInput.value = "";
    await sendChat(text, true);
  }
});

voiceBtn.addEventListener("click", () => startVoiceChat());
stopSpeakBtn.addEventListener("click", () => stopSpeaking());

sleepBtn.addEventListener("click", () => {
  markInteraction();
  if (appState.state === "sleeping") wakeUp();
  else goSleep(true);
});

["mousemove", "keydown", "click", "touchstart"].forEach((evt) => {
  window.addEventListener(evt, () => markInteraction(), { passive: true });
});

createTestButtons();
addMessage("assistant", "Hi! I'm your Avatar Companion. Type or use voice to chat.");
requestAnimationFrame(animateAvatar);
