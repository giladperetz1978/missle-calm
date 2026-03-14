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
const testMissileBtn = document.getElementById("test-missile");
const testAircraftBtn = document.getElementById("test-aircraft");
const testPrelaunchBtn = document.getElementById("test-prelaunch");
const testAllclearBtn = document.getElementById("test-allclear");

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

function speakAlert(type, fallbackMessage, spokenMessage) {
  const message = spokenMessage || spokenByType[type] || fallbackMessage;
  if (!("speechSynthesis" in window)) {
    return;
  }

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

  lastSeenAlertId = alert.id;
  addToFeed(alert);
  popupForAlert(alert);
  showNotification(alert).catch(() => {});

  if (alert.type === "allclear") {
    stopActiveSounds();
  }

  speakAlert(alert.type, alert.message, alert.spokenMessage);

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
    updateDebugState("SSE נותק, מבצע חיבור מחדש", true);
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
    audioUnlocked = true;
    enableAudioBtn.textContent = "שמע מאושר";
    updateDebugState("שמע נפתח בהצלחה");
  } catch {
    audioUnlocked = false;
    enableAudioBtn.textContent = "שמע נחסם, נסה שוב";
    updateDebugState("הדפדפן חסם שמע, לחץ שוב", true);
  }
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

registerSw().catch(() => {});
connectSse();
