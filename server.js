const express = require("express");
const path = require("path");
const webPush = require("web-push");

const app = express();

const PORT = Number(process.env.PORT || 8080);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 2500);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const ALERT_SOURCE_URL =
  process.env.ALERT_SOURCE_URL ||
  "https://www.oref.org.il/WarningMessages/alert/alerts.json";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:alerts@example.com";
const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

const clients = new Set();
const pushSubscribers = new Map();
let lastAlertId = "";
let lastRawFingerprint = "";
let activeThreat = null;
let lastBroadcastAlert = null;

if (PUSH_ENABLED) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const THREAT_KIND_LABEL = {
  missile_iran: "טילים מאיראן",
  missile_lebanon: "טילים מלבנון",
  missile_generic: "טילים",
  aircraft: 'כטב"מ',
  prelaunch_iran: "התראה מוקדמת מאיראן"
};

function threatKindToLabel(kind) {
  return THREAT_KIND_LABEL[kind] || "אירוע";
}

function buildEndOfEventMessage(kind) {
  return `סיום אירוע: ${threatKindToLabel(kind)}`;
}

function normalizePayload(rawPayload) {
  if (!rawPayload) {
    return null;
  }

  if (typeof rawPayload === "string") {
    const trimmed = rawPayload.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  return rawPayload;
}

function toText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const dataText = Array.isArray(payload.data) ? payload.data.join(" ") : "";
  return [payload.title, payload.desc, payload.category, dataText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function detectThreatKind(text) {
  if (/כלי\s*טיס|כטב|כטב"מ|כטבמ|uav|drone|חדירת\s*כלי\s*טיס/.test(text)) {
    return {
      threatKind: "aircraft",
      uiType: "aircraft",
      message: 'תִּרְגָּעוֹ, זֶה רַק כַּטְבָּ"מ'
    };
  }

  if (/איראן|iran/.test(text)) {
    if (/מוקדמ|prelaunch|בקרוב/.test(text)) {
      return {
        threatKind: "prelaunch_iran",
        uiType: "prelaunch",
        message: "ירי מאיראן בקרוב"
      };
    }

    return {
      threatKind: "missile_iran",
      uiType: "missile",
      message: "טילים מאיראן, נא להתמגן"
    };
  }

  if (/לבנון|lebanon/.test(text)) {
    return {
      threatKind: "missile_lebanon",
      uiType: "missile",
      message: "טילים מלבנון, נא להתמגן"
    };
  }

  return {
    threatKind: "missile_generic",
    uiType: "missile",
    message: "טילים, נא להתמגן"
  };
}

function classifyAlert(payload) {
  const text = toText(payload);
  const detectedThreat = detectThreatKind(text);
  const isEventEnd =
    /האירוע\s*הסתיים|סיום\s*אירוע|ניתן\s*לצאת\s*מהמרחב\s*המוגן|אפשר\s*לצאת\s*מהמרחב\s*המוגן|אין\s*צורך\s*לשהות\s*בסמיכות\s*למרחב\s*מוגן|all\s*clear|end\s*of\s*event/.test(
      text
    );

  if (isEventEnd) {
    const endedThreatKind = (activeThreat && activeThreat.kind) || detectedThreat.threatKind;
    const endedLabel = threatKindToLabel(endedThreatKind);

    return {
      eventKind: "end",
      uiType: "allclear",
      endedThreatKind,
      message: buildEndOfEventMessage(endedThreatKind),
      spokenMessage: `סיום אירוע ${endedLabel}. ניתן לצאת מהמרחב המוגן.`
    };
  }

  return {
    eventKind: "threat",
    uiType: detectedThreat.uiType,
    threatKind: detectedThreat.threatKind,
    message: detectedThreat.message,
    spokenMessage: detectedThreat.message
  };
}

function updateActiveThreat(classification, eventId) {
  if (!classification || !classification.eventKind) {
    return;
  }

  if (classification.eventKind === "end") {
    activeThreat = null;
    return;
  }

  activeThreat = {
    kind: classification.threatKind,
    startedAt: new Date().toISOString(),
    eventId
  };
}

function buildAlertEvent(payload) {
  const classification = classifyAlert(payload);
  const eventId = String(payload.id || Date.now());

  updateActiveThreat(classification, eventId);

  return {
    id: eventId,
    title: payload.title || "התרעת פיקוד העורף",
    areas: Array.isArray(payload.data) ? payload.data : [],
    type: classification.uiType,
    eventKind: classification.eventKind,
    threatKind: classification.threatKind || null,
    endedThreatKind: classification.endedThreatKind || null,
    message: classification.message,
    spokenMessage: classification.spokenMessage,
    source: "pikud-haoref",
    receivedAt: new Date().toISOString()
  };
}

function writeSse(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function normalizeAreaPrefs(input) {
  if (!input || typeof input !== "object") {
    return {
      filterEnabled: false,
      watchedAreas: []
    };
  }

  const watchedAreas = Array.isArray(input.watchedAreas)
    ? input.watchedAreas.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    filterEnabled: input.filterEnabled !== false,
    watchedAreas
  };
}

function shouldDeliverByArea(event, areaPrefs) {
  if (!areaPrefs || !areaPrefs.filterEnabled) {
    return true;
  }

  if (!areaPrefs.watchedAreas || !areaPrefs.watchedAreas.length) {
    return true;
  }

  const haystack = [
    ...(Array.isArray(event.areas) ? event.areas : []),
    event.message || "",
    event.title || ""
  ]
    .join(" ")
    .toLowerCase();

  return areaPrefs.watchedAreas.some((term) => haystack.includes(term));
}

async function sendPushToSubscribers(event) {
  if (!PUSH_ENABLED || !event) {
    return;
  }

  const payload = {
    title: event.title || "התרעה",
    body: event.message || "התקבלה התרעה חדשה",
    tag: event.id || "alert",
    data: event
  };

  const sendTasks = [];
  for (const [endpoint, entry] of pushSubscribers.entries()) {
    if (!shouldDeliverByArea(event, entry.areaPrefs)) {
      continue;
    }

    sendTasks.push(
      webPush
        .sendNotification(entry.subscription, JSON.stringify(payload), {
          TTL: 60
        })
        .catch((error) => {
          if (error.statusCode === 404 || error.statusCode === 410) {
            pushSubscribers.delete(endpoint);
            return;
          }
          console.error("Push send error:", error.message || error);
        })
    );
  }

  await Promise.all(sendTasks);
}

function broadcast(eventName, payload) {
  if (eventName === "alert") {
    lastBroadcastAlert = payload;
    sendPushToSubscribers(payload).catch((error) => {
      console.error("Push broadcast error:", error.message || error);
    });
  }

  for (const client of clients) {
    writeSse(client, eventName, payload);
  }
}

async function fetchAlerts() {
  const requestUrl = `${ALERT_SOURCE_URL}?_=${Date.now()}`;
  const response = await fetch(requestUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: "https://www.oref.org.il/"
    }
  });

  if (!response.ok) {
    throw new Error(`Alert source returned status ${response.status}`);
  }

  const text = await response.text();
  const payload = normalizePayload(text);

  if (!payload || !payload.id) {
    return null;
  }

  const rawFingerprint = JSON.stringify(payload);
  if (lastRawFingerprint === rawFingerprint || String(payload.id) === lastAlertId) {
    return null;
  }

  lastRawFingerprint = rawFingerprint;
  lastAlertId = String(payload.id);

  return buildAlertEvent(payload);
}

async function pollingLoop() {
  try {
    const event = await fetchAlerts();
    if (event) {
      broadcast("alert", event);
      console.log(`[ALERT] ${event.type} ${event.message} (${event.id})`);
    }
  } catch (error) {
    console.error("Polling error:", error.message);
  }
}

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    pollIntervalMs: POLL_INTERVAL_MS,
    corsOrigin: CORS_ORIGIN,
    source: ALERT_SOURCE_URL,
    clients: clients.size,
    activeThreat,
    pushEnabled: PUSH_ENABLED,
    pushSubscribers: pushSubscribers.size
  });
});

app.get("/api/push/public-key", (_, res) => {
  res.json({
    enabled: PUSH_ENABLED,
    publicKey: PUSH_ENABLED ? VAPID_PUBLIC_KEY : null
  });
});

app.post("/api/push/subscribe", (req, res) => {
  if (!PUSH_ENABLED) {
    res.status(503).json({
      subscribed: false,
      reason: "push-disabled"
    });
    return;
  }

  const body = req.body || {};
  const subscription = body.subscription;
  if (!subscription || typeof subscription.endpoint !== "string") {
    res.status(400).json({
      subscribed: false,
      reason: "invalid-subscription"
    });
    return;
  }

  pushSubscribers.set(subscription.endpoint, {
    subscription,
    areaPrefs: normalizeAreaPrefs(body.areaPrefs),
    updatedAt: new Date().toISOString()
  });

  res.json({
    subscribed: true,
    subscribers: pushSubscribers.size
  });
});

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  clients.add(res);
  writeSse(res, "connected", { connected: true, at: new Date().toISOString() });

  req.on("close", () => {
    clients.delete(res);
  });
});

app.get("/api/last-alert", (_, res) => {
  res.json({ event: lastBroadcastAlert });
});

app.post("/api/test-alert", (req, res) => {
  const payload = req.body || {};
  const requestedType = payload.type || "missile";
  const eventId = String(Date.now());
  let event;

  if (requestedType === "allclear") {
    const endedThreatKind =
      payload.endedThreatKind ||
      (activeThreat && activeThreat.kind) ||
      "missile_generic";

    event = {
      id: eventId,
      title: payload.title || "בדיקת מערכת",
      areas: Array.isArray(payload.areas) ? payload.areas : ["בדיקה"],
      type: "allclear",
      eventKind: "end",
      threatKind: null,
      endedThreatKind,
      message: payload.message || buildEndOfEventMessage(endedThreatKind),
      spokenMessage:
        payload.spokenMessage ||
        `סיום אירוע ${threatKindToLabel(endedThreatKind)}. ניתן לצאת מהמרחב המוגן.`,
      source: "manual-test",
      receivedAt: new Date().toISOString()
    };

    activeThreat = null;
  } else {
    const threatByRequestedType = {
      missile: {
        uiType: "missile",
        threatKind: "missile_generic",
        message: "טילים, נא להתמגן"
      },
      missile_iran: {
        uiType: "missile",
        threatKind: "missile_iran",
        message: "טילים מאיראן, נא להתמגן"
      },
      missile_lebanon: {
        uiType: "missile",
        threatKind: "missile_lebanon",
        message: "טילים מלבנון, נא להתמגן"
      },
      aircraft: {
        uiType: "aircraft",
        threatKind: "aircraft",
        message: 'תִּרְגָּעוֹ, זֶה רַק כַּטְבָּ"מ'
      },
      prelaunch: {
        uiType: "prelaunch",
        threatKind: "prelaunch_iran",
        message: "ירי מאיראן בקרוב"
      }
    };

    const selected = threatByRequestedType[requestedType] || threatByRequestedType.missile;

    event = {
      id: eventId,
      title: payload.title || "בדיקת מערכת",
      areas: Array.isArray(payload.areas) ? payload.areas : ["בדיקה"],
      type: selected.uiType,
      eventKind: "threat",
      threatKind: selected.threatKind,
      endedThreatKind: null,
      message: payload.message || selected.message,
      spokenMessage: payload.spokenMessage || selected.message,
      source: "manual-test",
      receivedAt: new Date().toISOString()
    };

    activeThreat = {
      kind: selected.threatKind,
      startedAt: new Date().toISOString(),
      eventId
    };
  }

  broadcast("alert", event);
  res.json({ sent: true, event });
});

setInterval(pollingLoop, POLL_INTERVAL_MS);
pollingLoop();

app.listen(PORT, () => {
  console.log(`Missile Calm server listening on http://localhost:${PORT}`);
});
