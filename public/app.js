const connectionStateEl = document.getElementById("connection-state");
const lastAlertEl = document.getElementById("last-alert");
const alertsFeedEl = document.getElementById("alerts-feed");
const debugStateEl = document.getElementById("debug-state");
const popupEl = document.getElementById("live-popup");
const popupTypeEl = document.getElementById("popup-type");
const popupMessageEl = document.getElementById("popup-message");
const popupAreasEl = document.getElementById("popup-areas");

const enableNotificationsBtn = document.getElementById("enable-notifications");
const enableAudioBtn = document.getElementById("enable-audio");
const testLocalSoundBtn = document.getElementById("test-local-sound");
const testMissileBtn = document.getElementById("test-missile");
const testAircraftBtn = document.getElementById("test-aircraft");
const testPrelaunchBtn = document.getElementById("test-prelaunch");
const testAllclearBtn = document.getElementById("test-allclear");
const citySelectEl = document.getElementById("city-select");
const areasInputEl = document.getElementById("areas-input");
const filterEnabledEl = document.getElementById("filter-enabled");
const voiceEnabledEl = document.getElementById("voice-enabled");
const saveSettingsBtn = document.getElementById("save-settings");
const settingsStateEl = document.getElementById("settings-state");

const configuredApiBase =
  window.APP_CONFIG && typeof window.APP_CONFIG.API_BASE_URL === "string"
    ? window.APP_CONFIG.API_BASE_URL.trim()
    : "";
const API_BASE_URL = configuredApiBase.replace(/\/$/, "");

function apiUrl(path) {
  if (!API_BASE_URL) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

let serviceWorkerRegistration = null;
let audioUnlocked = false;
let lastSeenAlertId = "";
let audioCtx = null;
const activeOscillators = new Set();
let fallbackPollTimer = null;

const SETTINGS_KEY = "missile-calm-settings-v1";
const threatKindLabel = {
  missile_iran: "טילים מאיראן",
  missile_lebanon: "טילים מלבנון",
  missile_generic: "טילים",
  aircraft: 'כטב"מ',
  prelaunch_iran: "התראה מוקדמת מאיראן"
};

const userSettings = {
  city: "",
  extraAreas: [],
  filterEnabled: true,
  voiceEnabled: true
};

const spokenByType = {
  missile: "טילים, נא להתמגן",
  aircraft: "תִּרְגָּעוֹ, זֶה רַק כַּטְבָּ\"מ",
  prelaunch: "ירי מאיראן בקרוב",
  allclear: "סיום אירוע. ניתן לצאת מהמרחב המוגן"
};

const toneByType = {
  missile: [800, 700, 880, 700],
  aircraft: [520, 620, 520],
  prelaunch: [400, 400, 600, 700]
};

function updateConnectionState(text, isError = false) {
  connectionStateEl.textContent = text;
  connectionStateEl.style.color = isError ? "#ff96a0" : "#4cc38a";
}

function updateDebugState(text, isError = false) {
  if (!debugStateEl) {
    return;
  }

  debugStateEl.textContent = text;
  debugStateEl.style.color = isError ? "#ff96a0" : "#9ad9ff";
}

function splitCsvAreas(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function renderSettingsState(text, isError = false) {
  if (!settingsStateEl) {
    return;
  }

  settingsStateEl.textContent = text;
  settingsStateEl.style.color = isError ? "#ff96a0" : "#9ad9ff";
}

function getWatchedAreas() {
  const result = [];
  if (userSettings.city) {
    result.push(userSettings.city);
  }
  for (const area of userSettings.extraAreas) {
    result.push(area);
  }
  return result;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    userSettings.city = typeof parsed.city === "string" ? parsed.city : "";
    userSettings.extraAreas = Array.isArray(parsed.extraAreas)
      ? parsed.extraAreas.map((item) => String(item).trim()).filter(Boolean)
      : [];
    userSettings.filterEnabled = parsed.filterEnabled !== false;
    userSettings.voiceEnabled = parsed.voiceEnabled !== false;
  } catch {
    updateDebugState("הגדרות קיימות לא תקינות, בוצע איפוס", true);
  }
}

function syncSettingsUi() {
  if (citySelectEl) {
    citySelectEl.value = userSettings.city;
  }
  if (areasInputEl) {
    areasInputEl.value = userSettings.extraAreas.join(", ");
  }
  if (filterEnabledEl) {
    filterEnabledEl.checked = userSettings.filterEnabled;
  }
  if (voiceEnabledEl) {
    voiceEnabledEl.checked = userSettings.voiceEnabled;
  }
}

function saveSettingsFromUi() {
  userSettings.city = citySelectEl ? citySelectEl.value.trim() : "";
  userSettings.extraAreas = splitCsvAreas(areasInputEl ? areasInputEl.value : "");
  userSettings.filterEnabled = filterEnabledEl ? filterEnabledEl.checked : true;
  userSettings.voiceEnabled = voiceEnabledEl ? voiceEnabledEl.checked : true;

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(userSettings));

  const watchedAreas = getWatchedAreas();
  const watchSummary = watchedAreas.length ? watchedAreas.join(" | ") : "ללא סינון";
  renderSettingsState(`נשמר. סינון: ${userSettings.filterEnabled ? "פעיל" : "כבוי"} | אזורים: ${watchSummary}`);
}

function formatType(type) {
  if (type === "aircraft") {
    return "כלי טיס";
  }
  if (type === "prelaunch") {
    return "התראה מוקדמת";
  }
  if (type === "allclear") {
    return "סיום אירוע";
  }
  return "טילים";
}

function buildSpokenText(alert) {
  if (!alert) {
    return "התקבלה התרעה";
  }

  if (alert.type === "allclear") {
    const ended = alert.endedThreatKind ? threatKindLabel[alert.endedThreatKind] || "אירוע" : "אירוע";
    return `סיום אירוע: ${ended}. ניתן לצאת מהמרחב המוגן.`;
  }

  const areaText = Array.isArray(alert.areas) && alert.areas.length
    ? ` באזורים ${alert.areas.join(" ו-")}`
    : "";
  const fallback = spokenByType[alert.type] || alert.message || "התקבלה התרעה";
  return `סוג ההתרעה: ${formatType(alert.type)}. ${fallback}${areaText}`;
}

function shouldHandleAlertByArea(alert) {
  if (!userSettings.filterEnabled) {
    return true;
  }

  if (alert.type === "allclear") {
    return true;
  }

  const watchedAreas = getWatchedAreas().map((item) => item.toLowerCase());
  if (!watchedAreas.length) {
    return true;
  }

  const haystack = [
    ...(Array.isArray(alert.areas) ? alert.areas : []),
    alert.message || "",
    alert.title || ""
  ]
    .join(" ")
    .toLowerCase();

  return watchedAreas.some((term) => haystack.includes(term));
}

function popupForAlert(alert) {
  popupTypeEl.textContent = formatType(alert.type);
  popupMessageEl.textContent = alert.message;
  popupAreasEl.textContent = alert.areas.length ? `אזורים: ${alert.areas.join(" | ")}` : "אזורים לא דווחו";

  popupEl.classList.add("show");
  popupEl.setAttribute("aria-hidden", "false");

  setTimeout(() => {
    popupEl.classList.remove("show");
    popupEl.setAttribute("aria-hidden", "true");
  }, 9000);
}

function addToFeed(alert) {
  const item = document.createElement("li");
  item.className = "alert-item";

  item.innerHTML = `
    <span class="alert-tag ${alert.type}">${formatType(alert.type)}</span>
    <p><strong>${alert.message}</strong></p>
    <p>${alert.areas.length ? alert.areas.join(" | ") : "ללא פירוט אזורים"}</p>
    <p>${new Date(alert.receivedAt).toLocaleTimeString("he-IL")}</p>
  `;

  alertsFeedEl.prepend(item);
  while (alertsFeedEl.children.length > 40) {
    alertsFeedEl.lastElementChild.remove();
  }

  lastAlertEl.textContent = `${formatType(alert.type)} | ${alert.message}`;
}

async function playTone(type) {
  if (type === "allclear") {
    return;
  }

  const frequencies = toneByType[type] || toneByType.missile;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    updateDebugState("אין תמיכה באודיו בדפדפן", true);
    return;
  }

  if (!audioCtx) {
    audioCtx = new AudioContextCtor();
  }

  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }

  const ctx = audioCtx;

  let when = ctx.currentTime;
  for (const frequency of frequencies) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type === "aircraft" ? "triangle" : "square";
    osc.frequency.value = frequency;

    gain.gain.setValueAtTime(0.001, when);
    gain.gain.exponentialRampToValueAtTime(0.15, when + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    activeOscillators.add(osc);

    osc.onended = () => {
      activeOscillators.delete(osc);
    };

    osc.start(when);
    osc.stop(when + 0.25);
    when += 0.28;
  }
}

function stopActiveSounds() {
  for (const osc of activeOscillators) {
    try {
      osc.stop();
    } catch {
      // Ignore oscillators that already stopped.
    }
  }
  activeOscillators.clear();
}

function startFallbackPolling() {
  if (fallbackPollTimer) {
    return;
  }

  updateDebugState("SSE לא זמין, עובר למצב גיבוי (Polling)", true);

  const poll = async () => {
    try {
      const response = await fetch(apiUrl("/api/last-alert"));
      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      if (payload && payload.event) {
        handleAlert(payload.event);
      }
    } catch {
      updateConnectionState("אין חיבור לשרת כרגע", true);
    }
  };

  fallbackPollTimer = setInterval(() => {
    poll().catch(() => {});
  }, 6000);

  poll().catch(() => {});
}

function stopFallbackPolling() {
  if (!fallbackPollTimer) {
    return;
  }

  clearInterval(fallbackPollTimer);
  fallbackPollTimer = null;
}

function speakAlert(type, fallbackMessage, spokenMessage) {
  const message = spokenMessage || spokenByType[type] || fallbackMessage;
  if (!("speechSynthesis" in window)) {
    updateDebugState("אין תמיכה בהקראה בדפדפן", true);
    return;
  }

  window.speechSynthesis.resume();
  const utter = new SpeechSynthesisUtterance(message);
  utter.lang = "he-IL";
  utter.rate = 0.95;
  utter.pitch = type === "aircraft" ? 1.18 : 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

async function showNotification(alert) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  if (serviceWorkerRegistration && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: "SHOW_ALERT_NOTIFICATION",
      payload: alert
    });
    return;
  }

  new Notification(alert.title || "התרעה", {
    body: alert.message,
    icon: "./icons/icon.svg"
  });
}

async function handleAlert(alert) {
  if (!alert || !alert.id || alert.id === lastSeenAlertId) {
    return;
  }

  if (!shouldHandleAlertByArea(alert)) {
    updateDebugState("התרעה התקבלה אך סוננה לפי הגדרות אזור");
    return;
  }

  lastSeenAlertId = alert.id;
  addToFeed(alert);
  popupForAlert(alert);
  showNotification(alert).catch(() => {});

  if (alert.type === "allclear") {
    stopActiveSounds();
  }

  if (userSettings.voiceEnabled) {
    speakAlert(alert.type, alert.message, buildSpokenText(alert));
  }

  if (audioUnlocked && alert.type !== "allclear") {
    playTone(alert.type).catch((error) => {
      updateDebugState(`שגיאת שמע: ${error.message || error}`, true);
    });
  }

  if (alert.type === "allclear") {
    updateDebugState("התקבל סיום אירוע והצליל הופסק");
    return;
  }

  updateDebugState(`התקבלה התראה: ${formatType(alert.type)}`);
}

function connectSse() {
  updateConnectionState("מחובר...", false);
  updateDebugState("פותח חיבור זמן אמת...");

  const source = new EventSource(apiUrl("/api/stream"));

  source.onopen = () => {
    stopFallbackPolling();
    updateConnectionState("מחובר בזמן אמת", false);
    updateDebugState("SSE מחובר");
  };

  source.addEventListener("connected", () => {
    updateConnectionState("מחובר בזמן אמת", false);
  });

  source.addEventListener("alert", (event) => {
    try {
      const alert = JSON.parse(event.data);
      handleAlert(alert);
    } catch {
      updateConnectionState("שגיאה בפענוח התרעה", true);
      updateDebugState("שגיאה בפענוח נתון התראה", true);
    }
  });

  source.onerror = () => {
    updateConnectionState("נותק. ניסיון התחברות מחדש...", true);
    startFallbackPolling();
  };
}

async function registerSw() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  serviceWorkerRegistration = await navigator.serviceWorker.register("./sw.js");
  if (serviceWorkerRegistration) {
    serviceWorkerRegistration.update().catch(() => {});
  }
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    alert("הדפדפן לא תומך בהתראות.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    enableNotificationsBtn.textContent = "התראות מאושרות";
    updateDebugState("הרשאת התראות אושרה");
  } else {
    updateDebugState("הרשאת התראות לא אושרה", true);
  }
}

async function unlockAudio() {
  if (audioUnlocked) {
    return;
  }

  try {
    await playTone("missile");
    if ("speechSynthesis" in window) {
      window.speechSynthesis.resume();
      const utter = new SpeechSynthesisUtterance("הקראה הופעלה");
      utter.lang = "he-IL";
      utter.volume = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    }
    audioUnlocked = true;
    enableAudioBtn.textContent = "שמע מאושר";
    updateDebugState("שמע והקראה נפתחו בהצלחה");
  } catch {
    audioUnlocked = false;
    enableAudioBtn.textContent = "שמע נחסם, נסה שוב";
    updateDebugState("הדפדפן חסם שמע, לחץ שוב", true);
  }
}

async function runLocalSoundTest() {
  if (!audioUnlocked) {
    await unlockAudio();
  }

  await playTone("missile");
  if (userSettings.voiceEnabled) {
    speakAlert("missile", "", "בדיקת סאונד מקומית. סוג ההתרעה: טילים.");
  }
  updateDebugState("בדיקת סאונד מקומית הושלמה");
}

async function sendTest(type) {
  updateDebugState(`שולח בדיקה: ${formatType(type)}`);

  const response = await fetch(apiUrl("/api/test-alert"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ type })
  });

  if (!response.ok) {
    throw new Error("שליחת בדיקה נכשלה");
  }

  const result = await response.json();

  if (result && result.event) {
    handleAlert(result.event);
  }
}

async function fetchSourceInfo() {
  try {
    const response = await fetch(apiUrl("/health"));
    if (!response.ok) {
      updateDebugState(`לא ניתן למשוך מקור התרעות מהשרת (${apiUrl("/health")})`, true);
      return;
    }

    const payload = await response.json();
    const source = payload && payload.source ? payload.source : "לא זוהה";
    updateDebugState(`מקור התרעות: ${source}`);
  } catch {
    updateDebugState(`אין גישה לשרת (${API_BASE_URL || "local"})`, true);
  }
}

enableNotificationsBtn.addEventListener("click", () => {
  requestNotificationPermission().catch((error) => {
    updateDebugState(`שגיאת התראות: ${error.message || error}`, true);
  });
});

enableAudioBtn.addEventListener("click", () => {
  unlockAudio().catch((error) => {
    updateDebugState(`שגיאת שמע: ${error.message || error}`, true);
  });
});

if (testLocalSoundBtn) {
  testLocalSoundBtn.addEventListener("click", () => {
    runLocalSoundTest().catch((error) => {
      updateDebugState(`בדיקת סאונד מקומית נכשלה: ${error.message || error}`, true);
    });
  });
}

testMissileBtn.addEventListener("click", () => {
  sendTest("missile").catch((error) => {
    updateDebugState(`בדיקת טיל נכשלה: ${error.message || error}`, true);
  });
});

testAircraftBtn.addEventListener("click", () => {
  sendTest("aircraft").catch((error) => {
    updateDebugState(`בדיקת כלי טיס נכשלה: ${error.message || error}`, true);
  });
});

testPrelaunchBtn.addEventListener("click", () => {
  sendTest("prelaunch").catch((error) => {
    updateDebugState(`בדיקת התראה מוקדמת נכשלה: ${error.message || error}`, true);
  });
});

if (testAllclearBtn) {
  testAllclearBtn.addEventListener("click", () => {
    sendTest("allclear").catch((error) => {
      updateDebugState(`בדיקת סיום אירוע נכשלה: ${error.message || error}`, true);
    });
  });
}

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener("click", () => {
    saveSettingsFromUi();
  });
}

loadSettings();
syncSettingsUi();
renderSettingsState("הגדרות נטענו");

registerSw().catch(() => {});
fetchSourceInfo().catch(() => {});
connectSse();
