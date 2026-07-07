const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const state = {
  patients: [
    {
      id: "mary",
      name: "Mary Perera",
      age: 78,
      initials: "MP",
      risk: "High",
      condition: "Hypertension watch",
      location: "Colombo 07",
      heart: 78,
      fallRisk: 24,
      deviceId: "SECMS-ESP32-001",
      contacts: [
        { name: "Nimal Perera", relation: "Son", phone: "+94 77 123 4567", email: "nimal@example.com" },
        { name: "Dr. Silva", relation: "Physician", phone: "+94 11 222 3344", email: "care@example.com" }
      ]
    },
    {
      id: "anil",
      name: "Anil Fernando",
      age: 82,
      initials: "AF",
      risk: "Medium",
      condition: "Mobility support",
      location: "Nugegoda",
      heart: 86,
      fallRisk: 18,
      deviceId: "SECMS-ESP32-002",
      contacts: [
        { name: "Maya Fernando", relation: "Daughter", phone: "+94 76 222 4577", email: "maya@example.com" },
        { name: "Care Desk", relation: "Care team", phone: "+94 11 888 0199", email: "desk@example.com" }
      ]
    }
  ],
  alerts: [
    { id: 1, severity: "critical", title: "Fall detected near home entrance", person: "Mary Perera", time: "2 min ago", status: "New", detail: "MPU6050 impact pattern crossed sensitivity threshold. SMS sent." },
    { id: 2, severity: "warning", title: "Heart rate above normal band", person: "Anil Fernando", time: "18 min ago", status: "Acknowledged", detail: "Heart rate peaked at 104 bpm for 3 minutes." },
    { id: 3, severity: "resolved", title: "GPS signal restored", person: "Mary Perera", time: "1 hr ago", status: "Resolved", detail: "NEO-6M reacquired a stable location lock." }
  ],
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

setInterval(() => {
  state.patients = state.patients.map((patient, index) => {
    const heartDelta = Math.round(Math.sin((Date.now() / 3500) + index) * 4);
    const fallDelta = Math.round(Math.cos((Date.now() / 5200) + index) * 3);
    return {
      ...patient,
      heart: clamp(patient.heart + heartDelta - 1, 54, 118),
      fallRisk: clamp(patient.fallRisk + fallDelta, 8, 85)
    };
  });
}, 3500);

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

function notFound(res) {
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not found" }));
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
