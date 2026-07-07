# SECMS Care Console

A full-stack prototype for the Smart Elderly Care Monitoring System. The frontend is a premium responsive dashboard for caregivers and family members, and the backend is a dependency-free Node.js simulator that exposes API endpoints for live state, alerts, and remote configuration.

## What is included

- Live dashboard cards for heart rate, fall status, GPS location, and device connectivity.
- Alert center with severity sorting, acknowledge/dismiss actions, call/location actions, sound, and voice alert support.
- Elderly profiles and emergency contact cards.
- Analytics with canvas charts, location timeline, filters, CSV export, and generated report actions.
- Remote configuration toggles and thresholds for ESP32 hardware modules.
- Device management cards with quick actions.
- Caregiver notes, dark mode, onboarding tour, mobile-first responsive layout, and floating quick action menu.
- Browser fallback simulator, so `index.html` works even without the backend.

## Run

If Node.js is installed:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

If Node.js is not installed, open `index.html` directly in a browser. The frontend will use its built-in simulator.

This workspace also includes a PowerShell backend for Windows machines without Node.js:

```powershell
powershell -ExecutionPolicy Bypass -File .\server.ps1 -Port 3000
```

## Backend API

- `GET /api/state` returns patients, alerts, devices, and configuration.
- `POST /api/alerts` creates a simulated alert.
- `POST /api/config` stores remote configuration changes.

## Hardware integration path

Replace the simulator inside `server.js` with MQTT/WebSocket ingestion from the ESP32 system:

- `MAX30105` or pulse sensor publishes heart rate.
- `MPU6050` publishes fall risk and impact events.
- `NEO-6M` publishes latitude and longitude.
- `SIM800L` alert status can be mirrored into `/api/alerts`.

For production, add authentication, persistent storage, TLS, audit logs, and a proper MQTT broker bridge.
