const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

initializeApp({
  credential: cert(require("./serviceAccountKey.json"))
});
const db = getFirestore();

const state = {
  alerts: [],
  devices: [
    { id: "SECMS-ESP32-001", name: "Mary bedside unit", owner: "Mary Perera", status: "Online", battery: 84, last: "Just now", signal: 96 },
    { id: "SECMS-ESP32-002", name: "Anil wearable node", owner: "Anil Fernando", status: "Online", battery: 68, last: "1 min ago", signal: 88 },
    { id: "SECMS-ESP32-003", name: "Spare test unit", owner: "Unassigned", status: "Offline", battery: 23, last: "2 days ago", signal: 0 }
  ],
  config: {
    highHeartRate: 110,
    lowHeartRate: 55,
    fallSensitivity: 72,
    voiceAlerts: false
  }
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === "/api/state" && req.method === "GET") {
    return json(res, state);
  }

  if (parsed.pathname === "/api/alerts" && req.method === "POST") {
    const body = await readBody(req);
    const alert = {
      id: Date.now(),
      severity: body.severity || "warning",
      title: body.title || "Care alert",
      person: body.person || "Unknown",
      time: "Just now",
      status: "New",
      detail: body.detail || "Alert received by backend simulator."
    };
    state.alerts.unshift(alert);
    state.alerts = state.alerts.slice(0, 20);
    return json(res, { ok: true, alert }, 201);
  }

  if (parsed.pathname === "/api/config" && req.method === "POST") {
    const body = await readBody(req);
    state.config = { ...state.config, ...body, updatedAt: new Date().toISOString() };
    return json(res, { ok: true, config: state.config });
  }

  if (parsed.pathname === "/api/ingest" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.device_id) {
      return badRequest(res, "device_id is required");
    }

    const patientId = await findPatientIdByDevice(body.device_id);
    if (!patientId) {
      return notFound(res, `No patient registered for device_id "${body.device_id}"`);
    }

    const update = { last_updated: FieldValue.serverTimestamp() };
    if (body.heart_rate !== undefined) update.heart_rate = Number(body.heart_rate);
    if (body.body_temp !== undefined) update.body_temp = Number(body.body_temp);
    if (body.fall_detect !== undefined) update.fall_detect = Boolean(body.fall_detect);
    if (body.longitude !== undefined) update.longitude = Number(body.longitude);
    if (body.latitude !== undefined) update.latitude = Number(body.latitude);

    await db.collection("patients").doc(patientId).set(update, { merge: true });
    return json(res, { ok: true, patientId });
  }

  const filePath = safeFilePath(parsed.pathname);
  if (!filePath) {
    return notFound(res);
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      return notFound(res);
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`SECMS web platform running at http://localhost:${PORT}`);
});

function safeFilePath(requestPath) {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(ROOT, cleanPath));
  if (!filePath.startsWith(ROOT)) return null;
  return filePath;
}

function json(res, payload, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

async function findPatientIdByDevice(deviceId) {
  const snapshot = await db.collection("patients").where("device_id", "==", deviceId).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].id;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}
