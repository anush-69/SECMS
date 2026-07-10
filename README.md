# SECMS Care Console

A full-stack Smart Elderly Care Monitoring System. The frontend is a responsive caregiver dashboard; the backend is a small dependency-light Node.js server that bridges real sensor data (ESP32 + heart rate / fall / GPS / temperature sensors) into **Cloud Firestore**, which the dashboard reads from in real time.

- **Frontend**: static HTML/CSS/vanilla JS dashboard (`index.html`, `app.js`, `styles.css`), no build step.
- **Auth**: Firebase Authentication (email/password with email verification, and Google sign-in).
- **Database**: Cloud Firestore (`patients` collection) — the dashboard listens to it live via `onSnapshot`, so any write shows up instantly with no page refresh.
- **Backend**: `server.js` — a plain Node `http` server that serves the static files, exposes a small demo alerts/config API, and exposes `POST /api/ingest`, which is the only thing allowed to write sensor readings into Firestore (using the Firebase **Admin SDK**, authenticated with a service account key).
- **Hardware**: `arduino/SCEMS_Wemos_Lolin32_Lite/SCEMS_Wemos_Lolin32_Lite.ino` — ESP32 firmware reading a MAX30102 (heart rate), MPU6050 (fall detection), NEO-6M (GPS), and MLX90614 (body temperature) sensor cluster with an OLED status display.

---

## 1. Architecture at a glance

```
ESP32 + sensors  --HTTP POST-->  server.js (/api/ingest)  --Admin SDK-->  Firestore "patients" collection
                                                                                   |
                                                                          onSnapshot (live)
                                                                                   v
                                                                     Browser dashboard (app.js)
```

- The **browser never writes** to Firestore directly — Firestore security rules block all client writes on `patients`. Only the trusted backend (Admin SDK, which bypasses security rules) can write.
- The **browser only reads** `patients` live via `onSnapshot`, and only once the caregiver is signed in and email-verified (enforced both by the UI and by Firestore rules: `allow read: if request.auth != null`).
- Alerts shown in the Alert Center are **not** stored anywhere — they're generated client-side in real time whenever a patient's live values cross a risk threshold (see §5).

---

## 2. Prerequisites

- [Node.js](https://nodejs.org/) 18+ (only needed to run `server.js`; the frontend alone can be opened as a static file).
- A Firebase project with **Authentication** and **Cloud Firestore** enabled.
- (Optional, for real hardware) Arduino IDE with ESP32 board support, and the libraries listed in the `.ino` file header.

---

## 3. Firebase project setup (one-time)

### 3.1 Create/open the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and open (or create) your project.
2. Under **Build → Authentication → Sign-in method**, enable:
   - **Email/Password**
   - **Google**
3. Copy the web app config (Project settings → General → Your apps → SDK setup and configuration) into `firebaseConfig` at the top of `app.js` — this repo already has a config wired in; replace it with your own project's values if you fork this.

### 3.2 Create the Firestore database

1. **Build → Firestore Database → Create database.**
2. Choose **Production mode** and pick a region close to your users (can't be changed later).
3. Create a collection named **`patients`**. Each document represents one monitored patient, with the **Document ID equal to the patient's `user_id`** (e.g. `mary`, `anush69`) — see §4 for the full field list.

### 3.3 Publish Firestore security rules

Go to **Firestore Database → Rules** and publish:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Root user document restriction (per-caregiver profile data, if used)
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      match /{allPaths=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // Patient telemetry — any signed-in user can read. A signed-in user may
    // CREATE only a document whose ID equals their own UID (this is how
    // sign-up provisions a new patient record client-side). Updates/deletes
    // are blocked from the client entirely — only the trusted backend
    // (Admin SDK, bypasses these rules) can write sensor readings.
    match /patients/{patientId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == patientId;
      allow update, delete: if false;
    }
  }
}
```

### 3.4 Generate a service account key (lets the backend write to Firestore)

1. **Project settings (gear icon) → Service accounts → Generate new private key.**
2. This downloads a JSON file. **Never commit this file or share its contents.**
3. Rename it to `serviceAccountKey.json` and place it in the project root (`D:\Z_notes\SLIIT-1-1\SECMS\serviceAccountKey.json`). `.gitignore` already excludes it.

---

## 4. Firestore data model

### Collection: `patients`

One document per patient. **Document ID = `user_id`** (the patient's Firebase Auth UID for accounts created through the app's sign-up flow; a hand-picked slug like `mary` for anything added manually).

| Field | Type | Set by | Description |
|---|---|---|---|
| `user_id` | string | sign-up (auto) / you (console) | Same value as the document ID; kept as a field too so it's available on any document snapshot without extra lookup code. |
| `fname` | string | sign-up (auto) / you (console) | First name — split from the account's display name. |
| `lname` | string | sign-up (auto) / you (console) | Last name. |
| `username` | string | sign-up (auto) / you (console) | Auto-derived from the email address's local part at sign-up (e.g. `anush69@gmail.com` → `anush69`). |
| `age` | number | you (console) | Patient age — not collected at sign-up; add manually if needed. |
| `condition` | string | you (console) | Free-text monitoring note, e.g. `"Hypertension watch"` — not collected at sign-up. |
| `contact_phone` | string | you (console) | A single emergency contact number (kept intentionally simple — no nested contact list) — not collected at sign-up. |
| `device_id` | string | you (console) | The ESP32 device assigned to this patient, e.g. `"SECMS-ESP32-001"`. Created empty (`""`) at sign-up — assign it manually once you know which device belongs to this patient. This is how `/api/ingest` maps an incoming sensor payload to the right patient document. |
| `heart_rate` | number \| null | backend (`/api/ingest`) | Latest BPM reading. `null` until the first sensor payload arrives. |
| `body_temp` | number \| null | backend (`/api/ingest`) | Latest body temperature, °C. `null` until the first sensor payload arrives. |
| `fall_detect` | boolean | sign-up (`false`) / backend (`/api/ingest`) | `true` while a fall/impact condition is active. |
| `longitude` | number \| null | backend (`/api/ingest`) | Latest GPS longitude. `null` until the first GPS fix. |
| `latitude` | number \| null | backend (`/api/ingest`) | Latest GPS latitude. `null` until the first GPS fix. |
| `last_updated` | timestamp \| null | backend (`/api/ingest`, server-generated) | Set automatically via `FieldValue.serverTimestamp()` on every ingest write. `null` until the first one. |

### How a patient document gets created

**Automatically at sign-up** (the normal path): when a caregiver creates an account — either email/password or Google — `app.js` writes a new `patients/{uid}` document via `createPatientDocument()`, populating `user_id`/`fname`/`lname`/`username`/`device_id` (empty)/`fall_detect` (`false`), and leaving the five sensor fields as `null` since there's no reading yet. This only fires once per account (checked via Firebase's `isNewUser` flag for Google, and inherently true for every `createUserWithEmailAndPassword` call).

Firestore rules permit this narrowly: a signed-in user may `create` (not `update`/`delete`) only a document whose ID equals their own UID — see §3.3.

**Manually, in the console** (for test data or patients who won't sign in themselves):

1. Firestore Database → `patients` → **Add document**.
2. Document ID: pick a short handle (this becomes `user_id`), e.g. `mary`.
3. Add each field from the table above with the matching type (`string`, `number`, `boolean`, `timestamp`).
4. For the five backend-owned fields, seed any placeholder values (they'll be overwritten on the first real ingest) — e.g. `heart_rate: 0`, `body_temp: 0`, `fall_detect: false`, `longitude: 0`, `latitude: 0`, `last_updated`: today's date/time.

---

## 5. Running the project

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

- `npm install` pulls in `firebase-admin` (the only real dependency this project has).
- `server.js` needs `serviceAccountKey.json` to exist in the project root (see §3.4) — it will crash on startup otherwise.
- Sign in via the auth modal (email/password, with email verification required, or Google). The dashboard stays blank/locked until you're signed in **and** verified — this matches the Firestore rule that blocks reads for anonymous users.
- Once signed in, `app.js` opens a live `onSnapshot` listener on `patients` — any document in that collection appears immediately, no page refresh needed.

### What's simulated vs. real right now

- **Real**: patient data on the dashboard (heart rate, fall status, temperature, GPS) comes straight from Firestore.
- **Real**: the Alert Center is generated live from that same data — the moment a patient's heart rate/temperature crosses a warning/critical threshold, or `fall_detect` flips to `true`, a new alert appears (and auto-resolves when the condition clears). Nothing here is stored — it's recomputed from current Firestore state.
- **Demo/local only**: the `alerts`/`devices`/`config` returned by `GET /api/state` are an in-memory, non-persistent placeholder — restarting `server.js` resets them. These aren't part of the Firebase-backed data path.
- **Real (once flashed)**: the ESP32 firmware (§7) connects to WiFi and POSTs live sensor readings to `/api/ingest` every ~8 seconds, in addition to its existing Serial/OLED output. You must fill in your WiFi credentials, server IP, and device ID in the sketch before flashing — see §7.

---

## 6. Backend API (`server.js`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/ingest` | `POST` | **The real one.** Body: `{ device_id, heart_rate?, body_temp?, fall_detect?, longitude?, latitude? }`. Looks up the `patients` document whose `device_id` matches, merges the given fields into it via the Admin SDK, and stamps `last_updated`. Returns `404` if no patient is registered for that `device_id`. |
| `/api/state` | `GET` | Returns the in-memory demo `alerts`/`devices`/`config` (not Firestore-backed). |
| `/api/alerts` | `POST` | Appends a demo alert to the in-memory list (used by the "SOS"/"Test alert" UI actions when a backend is running). |
| `/api/config` | `POST` | Updates the in-memory demo config (threshold sliders on the Settings page). |

Manual test of the real path:

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"device_id":"SECMS-ESP32-001","heart_rate":91,"body_temp":37.4,"fall_detect":false,"longitude":79.8620,"latitude":6.9280}'
```

A successful response looks like `{"ok":true,"patientId":"mary"}`, and the matching Firestore document updates immediately — which you'll see reflected live on the dashboard if it's open.

---

## 7. Hardware integration (ESP32)

`arduino/SCEMS_Wemos_Lolin32_Lite/SCEMS_Wemos_Lolin32_Lite.ino` reads all four sensors, shows live values on the OLED, **and** POSTs readings to the backend over WiFi. No Firebase credentials live on the device — only the Node server (via the Admin SDK) is trusted to write to Firestore; the ESP32 just talks to your server's `/api/ingest` endpoint.

### Before flashing

1. Install the extra library this sketch now needs beyond the sensor libs already listed in its header: **ArduinoJson** (v7+), via Arduino IDE → Library Manager.
2. Open the sketch and fill in the placeholders near the top:
   ```cpp
   const char *WIFI_SSID = "YOUR_WIFI_SSID";
   const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   const char *INGEST_URL = "http://192.168.1.50:3000/api/ingest"; // your PC's LAN IP, not "localhost"
   const char *DEVICE_ID = "SECMS-ESP32-001"; // must match a patient's device_id field in Firestore
   ```
3. Make sure the ESP32 and the machine running `server.js` are on the **same WiFi network**, and that Windows Firewall allows inbound connections on port 3000 (otherwise the ESP32's POSTs will time out even though `localhost:3000` works fine from the same PC).

### What it sends

Every ~8 seconds (`INGEST_INTERVAL_MS`), `sendTelemetry()` POSTs a JSON body to `/api/ingest` containing only the fields it currently has a valid reading for:

- `device_id` — always included.
- `heart_rate` — only if a finger is detected and a BPM average has been computed.
- `body_temp` — only if the MLX90614 initialized and returned a non-NaN reading.
- `fall_detect` — boolean, included whenever the MPU6050 initialized.
- `latitude`/`longitude` — only once the GPS has a valid fix.

This mirrors `/api/ingest`'s own partial-update behavior (`server.js`), so a temporarily missing GPS fix or an unplaced finger never overwrites good data already stored for that patient — it just skips that field for one cycle.

### Notes on the implementation

- WiFi connects once in `setup()` (15s timeout, then continues in offline/Serial-only mode if it fails — the sketch never gets stuck waiting for WiFi).
- The HTTP POST is synchronous/blocking (simple `HTTPClient`, no separate task/core), so `INGEST_INTERVAL_MS` is deliberately not too short — a slow network response could otherwise start delaying `readMotion()`'s fall-detection polling. `HTTP_TIMEOUT_MS` caps how long a single stalled request can block the loop.
- Both `Serial` (`logSerial()`) and the POST response (`Serial.println` of the HTTP status code) are logged for debugging over USB.

Wiring reference (from the sketch header):

| Component | Pin |
|---|---|
| I2C SDA (OLED, MLX90614, MPU6050, MAX30102) | GPIO19 |
| I2C SCL | GPIO23 |
| GPS TX → ESP32 RX | GPIO16 |
| GPS RX → ESP32 TX | GPIO17 |
| All sensor VCC | ESP32 3V |
| All GND | common ground |

---

## 8. Project structure

```
SECMS/
├── index.html                 Dashboard markup
├── app.js                     Frontend logic: Firebase Auth, Firestore live listener, rendering
├── styles.css                 Styling, including a "temporarily hidden" section for UI toggles
├── server.js                  Node backend: static file server + /api/ingest (Firebase Admin SDK)
├── server.ps1                 Windows PowerShell fallback backend (demo data only, not Firebase-integrated)
├── favicon.svg                Generated favicon matching the sidebar brand mark
├── serviceAccountKey.json     Firebase Admin credentials (you provide this — gitignored)
├── .gitignore                 Excludes serviceAccountKey.json, node_modules, .env
├── package.json
└── arduino/
    └── SCEMS_Wemos_Lolin32_Lite/
        └── SCEMS_Wemos_Lolin32_Lite.ino   ESP32 sensor firmware
```

---

## 9. Security notes

- `serviceAccountKey.json` is a full-trust credential for your Firebase project — treat it like a password. It's git-ignored; never paste its contents anywhere, including chat or commit messages.
- Firestore rules block **all** client-side writes to `patients` — the only write path is the backend's Admin SDK, which bypasses rules by design. If you ever add a feature that needs the browser to write data, do it through a new backend endpoint, not by loosening the Firestore rule.
- Firebase Auth requires email verification before the dashboard unlocks (see `onAuthStateChanged` in `app.js`) — an unverified sign-in is immediately signed back out.
- This is a coursework/prototype project. For a real production deployment you'd also want: TLS in front of `server.js`, rate limiting on `/api/ingest`, per-device auth (so one compromised ESP32 can't POST readings for another patient's `device_id`), and audit logging.
