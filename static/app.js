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

const DEFAULT_AUTO_SLEEP_MS = 90_000;
const SLEEPY_MS = 70_000;

const appState = {
  state: "idle",
  emotion: "neutral",
  manualSleep: false,
  speakingEnabled: true,
  speechRate: 1.0,
  selectedVoiceURI: "",
  recognitionLang: "ja-JP",
  forceMock: false,
  speakingNow: false,
  mouthTalkPhase: 0,
  lastInteractionAt: Date.now(),
  // Animation internals
  blinkValue: 1,
  nextBlinkAt: Date.now() + 2200,
  blinkPhase: "open", // open -> closing -> hold -> opening
  blinkHoldUntil: 0,
  pupilX: 0,
  pupilY: 0,
  pupilTargetX: 0,
  pupilTargetY: 0,
  pupilVX: 0,
  pupilVY: 0,
  nextPupilMoveAt: Date.now() + 1200,
  sleepiness: 0, // smooth sleep transition 0..1
  wakeBoostUntil: 0, // timestamp for wake-up bounce
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
const errorBanner = document.getElementById("errorBanner");
const autoSleepInput = document.getElementById("autoSleepInput");
const voiceEnabledSelect = document.getElementById("voiceEnabledSelect");
const speechRateInput = document.getElementById("speechRateInput");
const speechRateLabel = document.getElementById("speechRateLabel");
const voiceSelect = document.getElementById("voiceSelect");
const recognitionLangSelect = document.getElementById("recognitionLangSelect");
const mockModeSelect = document.getElementById("mockModeSelect");

let autoSleepMs = DEFAULT_AUTO_SLEEP_MS;
let availableVoices = [];

// ------------------------------
// Speech recognition setup
// ------------------------------
const RecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognitionActive = false;
if (RecognitionClass) {
  recognition = new RecognitionClass();
  recognition.lang = appState.recognitionLang;
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

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.textContent = "";
  errorBanner.classList.add("hidden");
}

function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = appState.speechRate;
  utter.pitch = 1.1;
  if (appState.selectedVoiceURI && availableVoices.length) {
    const selected = availableVoices.find((v) => v.voiceURI === appState.selectedVoiceURI);
    if (selected) utter.voice = selected;
  }

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

function saveSettings() {
  localStorage.setItem(
    "avatar_companion_settings",
    JSON.stringify({
      autoSleepMs,
      speakingEnabled: appState.speakingEnabled,
      speechRate: appState.speechRate,
      selectedVoiceURI: appState.selectedVoiceURI,
      recognitionLang: appState.recognitionLang,
      forceMock: appState.forceMock,
    })
  );
}

function loadSettings() {
  try {
    const raw = localStorage.getItem("avatar_companion_settings");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    autoSleepMs = Number(parsed.autoSleepMs) || DEFAULT_AUTO_SLEEP_MS;
    appState.speakingEnabled = parsed.speakingEnabled !== false;
    appState.speechRate = Math.min(1.4, Math.max(0.7, Number(parsed.speechRate) || 1));
    appState.selectedVoiceURI = parsed.selectedVoiceURI || "";
    appState.recognitionLang = parsed.recognitionLang || "ja-JP";
    appState.forceMock = parsed.forceMock === true;
  } catch (err) {
    console.warn("Settings load failed:", err);
  }
}

function refreshVoices() {
  if (!window.speechSynthesis) {
    voiceSelect.innerHTML = '<option value="">Not supported in this browser</option>';
    voiceSelect.disabled = true;
    return;
  }
  availableVoices = window.speechSynthesis.getVoices();
  voiceSelect.innerHTML = '<option value="">Default browser voice</option>';
  availableVoices.forEach((voice) => {
    const opt = document.createElement("option");
    opt.value = voice.voiceURI;
    opt.textContent = `${voice.name} (${voice.lang})`;
    voiceSelect.appendChild(opt);
  });
  // Prefer Japanese voices when available to match recognition language.
  if (!appState.selectedVoiceURI && appState.recognitionLang === "ja-JP") {
    const jpVoice = availableVoices.find((v) => v.lang && v.lang.toLowerCase().startsWith("ja"));
    if (jpVoice) appState.selectedVoiceURI = jpVoice.voiceURI;
  }
  voiceSelect.value = appState.selectedVoiceURI;
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
  appState.wakeBoostUntil = Date.now() + 1200;
  sleepBtn.textContent = "Sleep";
}

async function sendChat(userText, useVoiceReply = true) {
  markInteraction();
  clearError();
  addMessage("user", userText);

  // Short reactive shift before thinking.
  setEmotion("playful");
  await new Promise((r) => setTimeout(r, 120));
  setState("thinking");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_text: userText, force_mock: appState.forceMock }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Server error ${res.status}: ${errorText.slice(0, 180)}`);
    }
    const data = await res.json();

    const reply = data.reply_text || "I may have missed that. Could you try again?";
    addMessage("assistant", reply);
    setEmotion(data.emotion || "neutral");
    setState(data.state || "speaking");

    if (data.sleep_recommended && !appState.manualSleep) {
      // Soft suggestion via expression; avoid forced sleep right away.
      if (appState.state !== "sleeping") setEmotion("sleepy");
    }

    if (useVoiceReply && appState.speakingEnabled && window.speechSynthesis) {
      speakText(reply);
    } else if (!appState.manualSleep) {
      setState("idle");
    }
  } catch (err) {
    console.error(err);
    const humanError =
      "Could not reach chat service. Check if server is running, your API key is valid, and internet is available.";
    addMessage("assistant", `${humanError} (${String(err.message || err)})`);
    showError(humanError);
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
    showError("Microphone speech recognition is unavailable in this browser. Use text input or a Chromium browser.");
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
    showError("Speech recognition failed. Check microphone permission and try again.");
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
    neutral: { eyeOpen: 1, browTilt: 0, browArch: 0.1, mouthCurve: 0.05, bob: 1, blinkMs: 2600, blush: 0, pupilScale: 1 },
    happy: { eyeOpen: 0.82, browTilt: -0.2, browArch: 0.3, mouthCurve: 0.95, bob: 1.25, blinkMs: 2100, blush: 0.22, pupilScale: 0.95 },
    excited: { eyeOpen: 1.16, browTilt: -0.4, browArch: 0.38, mouthCurve: 0.8, bob: 1.65, blinkMs: 1650, blush: 0.16, pupilScale: 1.15 },
    sad: { eyeOpen: 0.62, browTilt: 0.35, browArch: -0.15, mouthCurve: -0.8, bob: 0.55, blinkMs: 3400, blush: 0, pupilScale: 0.9 },
    concerned: { eyeOpen: 0.78, browTilt: 0.22, browArch: -0.1, mouthCurve: -0.3, bob: 0.9, blinkMs: 2550, blush: 0.04, pupilScale: 0.95 },
    surprised: { eyeOpen: 1.28, browTilt: -0.16, browArch: 0.45, mouthCurve: 0.22, bob: 1.1, blinkMs: 1800, blush: 0.08, pupilScale: 1.2 },
    sleepy: { eyeOpen: 0.38, browTilt: 0.12, browArch: -0.2, mouthCurve: -0.1, bob: 0.45, blinkMs: 980, blush: 0, pupilScale: 0.88 },
    playful: { eyeOpen: 0.94, browTilt: -0.32, browArch: 0.22, mouthCurve: 0.55, bob: 1.35, blinkMs: 1950, blush: 0.19, pupilScale: 1.05 },
  };
  return map[emotion] || map.neutral;
}

function updateAutoSleep() {
  if (appState.manualSleep) return;

  const idleMs = Date.now() - appState.lastInteractionAt;
  if (idleMs >= autoSleepMs && appState.state !== "sleeping") {
    goSleep(false);
  } else if (idleMs >= Math.max(SLEEPY_MS, autoSleepMs * 0.75) && appState.state === "idle") {
    setEmotion("sleepy");
  }
}

function animateAvatar(ts) {
  updateAutoSleep();

  const t = ts / 1000;
  const emo = emotionTuning(appState.emotion);

  // Better blink scheduler with short eye-closed hold for cuter timing.
  if (Date.now() > appState.nextBlinkAt && appState.blinkPhase === "open") {
    appState.blinkPhase = "closing";
  }
  if (appState.blinkPhase === "closing") {
    appState.blinkValue = Math.max(0, appState.blinkValue - 0.34);
    if (appState.blinkValue <= 0.02) {
      appState.blinkPhase = "hold";
      appState.blinkHoldUntil = Date.now() + 45 + Math.random() * 70;
    }
  } else if (appState.blinkPhase === "hold") {
    appState.blinkValue = 0.02;
    if (Date.now() >= appState.blinkHoldUntil) {
      appState.blinkPhase = "opening";
    }
  } else if (appState.blinkPhase === "opening") {
    appState.blinkValue = Math.min(1, appState.blinkValue + 0.24);
    if (appState.blinkValue >= 0.99) {
      appState.blinkPhase = "open";
      appState.nextBlinkAt = Date.now() + emo.blinkMs + Math.random() * 780;
    }
  }

  // Smooth sleep transition.
  const sleepTarget = appState.state === "sleeping" ? 1 : 0;
  appState.sleepiness += (sleepTarget - appState.sleepiness) * 0.03;

  if (Date.now() > appState.nextPupilMoveAt) {
    const attentiveBoost = appState.state === "listening" ? 1.3 : 1;
    appState.pupilTargetX = (Math.random() * 2 - 1) * 8 * attentiveBoost;
    appState.pupilTargetY = (Math.random() * 2 - 1) * 5.5;
    appState.nextPupilMoveAt = Date.now() + 800 + Math.random() * 1200;
  }
  // Velocity damping makes movement smoother than direct interpolation.
  appState.pupilVX += (appState.pupilTargetX - appState.pupilX) * 0.018;
  appState.pupilVY += (appState.pupilTargetY - appState.pupilY) * 0.018;
  appState.pupilVX *= 0.86;
  appState.pupilVY *= 0.86;
  appState.pupilX += appState.pupilVX;
  appState.pupilY += appState.pupilVY;

  // Base bobbing (breathing) and state-modulated motion.
  let bobAmp = 6 * emo.bob;
  if (appState.state === "thinking") bobAmp += 3;
  bobAmp = bobAmp * (1 - appState.sleepiness * 0.7) + 2 * appState.sleepiness;
  const wakeWave = Date.now() < appState.wakeBoostUntil ? Math.sin(t * 14) * 3.2 : 0;
  const bobY = Math.sin(t * 2.1) * bobAmp + wakeWave;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background glow
  ctx.fillStyle = "#f7f8ff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2 + bobY;

  // Head (chibi proportions)
  ctx.save();
  ctx.translate(cx, cy);
  const tilt = appState.state === "thinking" ? Math.sin(t * 1.7) * 0.08 : 0;
  ctx.rotate(tilt);

  const faceGrad = ctx.createRadialGradient(-20, -25, 20, 0, 0, 150);
  faceGrad.addColorStop(0, "#fff2ea");
  faceGrad.addColorStop(1, "#ffdccc");
  ctx.fillStyle = faceGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, 126, 112, 0, 0, Math.PI * 2);
  ctx.fill();

  // Blush
  if (emo.blush > 0.01) {
    ctx.globalAlpha = emo.blush * (1 - appState.sleepiness * 0.35);
    ctx.fillStyle = "#ff95a8";
    ctx.beginPath();
    ctx.ellipse(-64, 19, 19, 11, 0, 0, Math.PI * 2);
    ctx.ellipse(64, 19, 19, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Eyes
  const eyeOpen = emo.eyeOpen * appState.blinkValue * (1 - appState.sleepiness * 0.82);
  drawEye(-49, -22, eyeOpen, emo, t);
  drawEye(49, -22, eyeOpen, emo, t);

  // Eyebrows
  drawBrow(-50, -59, emo.browTilt, emo.browArch, true);
  drawBrow(50, -59, emo.browTilt, emo.browArch, false);

  // Mouth with speaking variation
  drawMouth(0, 48, emo.mouthCurve, emo, t);

  // Tiny body bubble (cute floating bean)
  ctx.fillStyle = "#dce3ff";
  ctx.beginPath();
  ctx.ellipse(0, 147, 79, 34 + Math.sin(t * 2) * 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  requestAnimationFrame(animateAvatar);
}

function drawEye(x, y, openness, emo, t) {
  const w = 31;
  const h = Math.max(1.6, 15.5 * openness);
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pupils: slightly larger when listening for attentive effect.
  const pupilScale = (appState.state === "listening" ? 1.2 : 1) * emo.pupilScale;
  const px = x + appState.pupilX;
  const py = y + appState.pupilY;
  ctx.fillStyle = "#2c3354";
  ctx.beginPath();
  ctx.ellipse(px, py, 8 * pupilScale, 9 * pupilScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tiny highlight for kawaii look.
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.ellipse(px - 2, py - 3, 2.5, 2, 0, 0, Math.PI * 2);
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

function drawBrow(x, y, tilt, arch, left) {
  const dir = left ? 1 : -1;
  ctx.strokeStyle = "#5d4a44";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  const sx = x - 18;
  const sy = y + tilt * 15 * dir;
  const ex = x + 18;
  const ey = y - tilt * 15 * dir;
  const cx = x;
  const cy = y - arch * 16;
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(cx, cy, ex, ey);
  ctx.stroke();
}

function drawMouth(x, y, curve, emo, t) {
  // Speaking mouth: layered sinusoidal variation instead of binary open/close.
  if (appState.speakingNow || appState.state === "speaking") {
    appState.mouthTalkPhase += 0.35;
  } else {
    appState.mouthTalkPhase *= 0.9;
  }

  const emoTalkBias = {
    happy: 1.15,
    playful: 1.2,
    excited: 1.28,
    sad: 0.75,
    concerned: 0.82,
    sleepy: 0.6,
    surprised: 1.1,
    neutral: 1,
  }[appState.emotion] || 1;
  const talk =
    Math.abs(Math.sin(appState.mouthTalkPhase) * 7 + Math.sin(appState.mouthTalkPhase * 0.47) * 3) * emoTalkBias;
  const sleepClamp = appState.state === "sleeping" ? 1 : 0;
  const openH = Math.max(1.5, 8 + curve * 4 + talk * (1 - sleepClamp));

  ctx.fillStyle = "#b35668";
  ctx.beginPath();
  const mouthW = 25 + (emo.mouthCurve > 0.5 ? 2.5 : 0);
  ctx.ellipse(x, y, mouthW, openH, 0, 0, Math.PI * 2);
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

autoSleepInput.addEventListener("change", () => {
  const sec = Math.max(15, Math.min(900, Number(autoSleepInput.value) || 90));
  autoSleepMs = sec * 1000;
  autoSleepInput.value = String(sec);
  saveSettings();
});

voiceEnabledSelect.addEventListener("change", () => {
  appState.speakingEnabled = voiceEnabledSelect.value === "on";
  saveSettings();
});

speechRateInput.addEventListener("input", () => {
  const rate = Math.min(1.4, Math.max(0.7, Number(speechRateInput.value) || 1));
  appState.speechRate = rate;
  speechRateLabel.textContent = rate.toFixed(2);
  saveSettings();
});

voiceSelect.addEventListener("change", () => {
  appState.selectedVoiceURI = voiceSelect.value;
  saveSettings();
});

recognitionLangSelect.addEventListener("change", () => {
  appState.recognitionLang = recognitionLangSelect.value || "ja-JP";
  if (recognition) recognition.lang = appState.recognitionLang;
  // If moving to Japanese and no manual voice chosen, auto-pick Japanese voice if possible.
  if (appState.recognitionLang === "ja-JP" && !voiceSelect.value) {
    const jpVoice = availableVoices.find((v) => v.lang && v.lang.toLowerCase().startsWith("ja"));
    if (jpVoice) {
      appState.selectedVoiceURI = jpVoice.voiceURI;
      voiceSelect.value = jpVoice.voiceURI;
    }
  }
  saveSettings();
});

mockModeSelect.addEventListener("change", () => {
  appState.forceMock = mockModeSelect.value === "on";
  saveSettings();
  addMessage("assistant", appState.forceMock ? "Mock mode enabled for chat." : "OpenAI API mode enabled for chat.");
});

loadSettings();
autoSleepInput.value = String(Math.round(autoSleepMs / 1000));
voiceEnabledSelect.value = appState.speakingEnabled ? "on" : "off";
speechRateInput.value = String(appState.speechRate);
speechRateLabel.textContent = appState.speechRate.toFixed(2);
mockModeSelect.value = appState.forceMock ? "on" : "off";
recognitionLangSelect.value = appState.recognitionLang;
if (recognition) recognition.lang = appState.recognitionLang;
refreshVoices();
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

createTestButtons();
addMessage("assistant", "Hi! I'm your Avatar Companion. Type or use voice to chat.");
requestAnimationFrame(animateAvatar);
