// ==========================================================================
// 1. FIREBASE MODULAR SDK IMPORTS & CONFIGURATION
// ==========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBXAYTtaJnG_B1RY5c9J6Bh9U-rJxoDKJk",
  authDomain: "secms-2a30a.firebaseapp.com",
  projectId: "secms-2a30a",
  storageBucket: "secms-2a30a.firebasestorage.app",
  messagingSenderId: "840714831115",
  appId: "1:840714831115:web:d037560c6d324d03dece0e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
let unsubscribePatients = null;
let alertIdCounter = 0;
const activeRiskAlerts = {};

// ==========================================================================
// 2. MAIN APPLICATION STATE ENGINE (Your original 'const state = { ... }' goes below)
// ==========================================================================

const state = {
  activeSection: "dashboard",
  selectedPatient: null,
  soundEnabled: false,
  voiceEnabled: false,
  patients: [],
  alerts: [],
  devices: [
    { id: "SECMS-ESP32-001", name: "Mary bedside unit", owner: "Mary Perera", status: "Online", battery: 84, last: "Just now", signal: 96 },
    { id: "SECMS-ESP32-002", name: "Anil wearable node", owner: "Anil Fernando", status: "Online", battery: 68, last: "1 min ago", signal: 88 },
    { id: "SECMS-ESP32-003", name: "Spare test unit", owner: "Unassigned", status: "Offline", battery: 23, last: "2 days ago", signal: 0 }
  ],
  heartTrend: [],
  fallTrend: [0, 1, 0, 0, 2, 1, 0],
  locationTrail: [
    { place: "Bedroom", time: "7:10 AM", detail: "Morning vitals check completed." },
    { place: "Garden path", time: "9:30 AM", detail: "Short walk logged by GPS trail." },
    { place: "Kitchen", time: "12:45 PM", detail: "Stationary for 32 minutes." },
    { place: "Home entrance", time: "2:48 PM", detail: "Fall alert location fix." }
  ]
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));


document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindActions();
  bindSettings();
  
  hydrateFromBackend();
  renderAll();

  // Elements mapping
  const shield = document.getElementById("guest-interaction-shield");
  const authModal = document.getElementById("authPortalModal");
  const authClose = document.getElementById("authPortalClose");
  const authForm = document.getElementById("authPortalForm");
  const authFields = document.getElementById("authFormFields");
  const toggleModeBtn = document.getElementById("authToggleModeBtn");
  const toggleContainer = document.getElementById("authToggleContainer");
  const submitBtn = document.getElementById("authSubmitButton");
  
  const signInHeaderBtn = document.getElementById("header-signin-btn");
  const getFreeHeaderBtn = document.getElementById("header-getfree-btn");

  let authPortalMode = "signup"; // Mode options: 'signup', 'signin', 'verify'

  function openAuthPortal(mode = "signup", userEmail = "") {
    authPortalMode = mode;
    const title = document.getElementById("authPortalTitle");
    const desc = document.getElementById("authPortalDescription");

    // Make sure standard layout elements are visible again by default
    authForm.style.display = "grid";
    toggleContainer.style.display = "block";

    if (authPortalMode === "signup") {
      title.textContent = "Create your free account";
      desc.textContent = "Access remote tracking telemetry tools, smart emergency SOS actions, and real-time alerts.";
      submitBtn.textContent = "Create Account";
      document.getElementById("authToggleText").textContent = "Already using SECMS?";
      toggleModeBtn.textContent = "Sign In instead";
      
      authFields.innerHTML = `
        <input type="text" id="auth-name" placeholder="Full name" required>
        <input type="email" id="auth-email" placeholder="Email address" required>
        <input type="password" id="auth-pass" placeholder="Password (min 6 characters)" required minlength="6">
      `;
      appendGoogleBtn();
    } 
    else if (authPortalMode === "signin") {
      title.textContent = "Welcome back";
      desc.textContent = "Sign in to securely access your registered family hardware monitoring metrics.";
      submitBtn.textContent = "Sign In";
      document.getElementById("authToggleText").textContent = "New to our platform?";
      toggleModeBtn.textContent = "Get Started for Free";
      
      authFields.innerHTML = `
        <input type="email" id="auth-email" placeholder="Email address" required>
        <input type="password" id="auth-pass" placeholder="Password" required>
      `;
      appendGoogleBtn();
    } 
    else if (authPortalMode === "verify") {
      // THE VERIFICATION SCREEN CAPSULE
      title.textContent = "Verify your email";
      desc.textContent = `We have sent you a verification email to ${userEmail}. Please verify it and log in.`;
      
      // Completely clean out and rewrite form structure to meet requirements
      authForm.style.display = "none"; 
      toggleContainer.style.display = "none";
      
      // Inject a clean static Login button option right onto the screen container layout
      const verifyWrapper = document.createElement("div");
      verifyWrapper.id = "verify-screen-container";
      verifyWrapper.innerHTML = `
        <button class="primary-button inline-submit-auth" type="button" id="verify-login-switch-btn" style="margin-top:20px;">
          Go to Login
        </button>
      `;
      
      // Remove older wrapper if it exists before appending a new one
      const oldWrapper = document.getElementById("verify-screen-container");
      if (oldWrapper) oldWrapper.remove();
      
      authFields.parentNode.insertBefore(verifyWrapper, authFields.nextSibling);

      document.getElementById("verify-login-switch-btn").addEventListener("click", () => {
        verifyWrapper.remove();
        openAuthPortal("signin");
      });
    }

    authModal.showModal();
  }

  function appendGoogleBtn() {
    const oldWrapper = document.getElementById("verify-screen-container");
    if (oldWrapper) oldWrapper.remove();

    const googleBtnHtml = document.createElement("div");
    googleBtnHtml.className = "google-auth-zone";
    googleBtnHtml.id = "google-zone-wrapper";
    googleBtnHtml.innerHTML = `
      <div class="auth-divider-text"><span>or</span></div>
      <button type="button" id="google-signin-action-btn" class="secondary-button google-btn">
        <svg class="google-icon" viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </button>
    `;
    
    const oldZone = document.getElementById("google-zone-wrapper");
    if (oldZone) oldZone.remove();
    authFields.appendChild(googleBtnHtml);

    document.getElementById("google-signin-action-btn").addEventListener("click", () => {
      signInWithPopup(auth, googleProvider)
        .then(() => authModal.close())
        .catch((err) => toast(`Google Auth Error: ${err.message}`));
    });
  }

  if (shield) {
    shield.addEventListener("click", () => {
      openAuthPortal("signup");
      toast("Authentication required to access active logs.");
    });
  }

  if (signInHeaderBtn) signInHeaderBtn.addEventListener("click", () => openAuthPortal("signin"));
  if (getFreeHeaderBtn) getFreeHeaderBtn.addEventListener("click", () => openAuthPortal("signup"));
  if (authClose) authClose.addEventListener("click", () => authModal.close());
  if (toggleModeBtn) toggleModeBtn.addEventListener("click", () => openAuthPortal(authPortalMode === "signup" ? "signin" : "signup"));

  // Handle Form Submission logic
  if (authForm) {
    authForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-pass").value;

      if (authPortalMode === "signup") {
        createUserWithEmailAndPassword(auth, email, password)
          .then((userCredential) => {
            // Send Verification email sequence immediately
            sendEmailVerification(userCredential.user)
              .then(() => {
                // FORCE THE USER OUT OUT (Do not let them auto-login)
                signOut(auth).then(() => {
                  openAuthPortal("verify", email);
                });
              });
          })
          .catch((err) => toast(`Sign Up Error: ${err.message}`));
      } else if (authPortalMode === "signin") {
        signInWithEmailAndPassword(auth, email, password)
          .then((userCredential) => {
            if (!userCredential.user.emailVerified) {
              // BLOCK ACCESS IF UNVERIFIED: Inform and Sign back out immediately
              toast("Access Blocked: Email not verified.");
              openAuthPortal("verify", email);
              signOut(auth);
            } else {
              authModal.close();
            }
          })
          .catch((err) => toast(`Login Error: ${err.message}`));
      }
    });
  }

  // Real-Time Auth State Observer Stream Sync Engine
  onAuthStateChanged(auth, (user) => {
    // Only unlock dashboard if user profile exists AND email is fully verified
    if (user && user.emailVerified) {
      if (shield) shield.classList.add("hidden");
      if (signInHeaderBtn) signInHeaderBtn.style.display = "none";
      if (getFreeHeaderBtn) {
        getFreeHeaderBtn.textContent = "Sign Out";
        getFreeHeaderBtn.onclick = (e) => { e.preventDefault(); signOut(auth); };
      }
      subscribeToPatients();
    } else {
      // Fallback state matches lock constraints
      if (shield) shield.classList.remove("hidden");
      if (signInHeaderBtn) signInHeaderBtn.style.display = "inline-block";
      if (getFreeHeaderBtn) {
        getFreeHeaderBtn.textContent = "Get it free";
        getFreeHeaderBtn.onclick = (e) => { e.preventDefault(); openAuthPortal("signup"); };
      }
      unsubscribeFromPatients();
    }
  });
});

function bindNavigation() {
  $$("[data-section-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showSection(link.dataset.sectionLink);
    });
  });

  $$("[data-section-jump]").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.sectionJump));
  });

  $("#patientSegments").addEventListener("click", (event) => {
    const button = event.target.closest(".segment");
    if (!button) return;
    state.selectedPatient = button.dataset.patient;
    renderPatientSegments();
    const patient = getSelectedPatient();
    state.heartTrend = patient ? [patient.heart] : [];
    renderDashboard();
    renderCharts();
    toast(`Viewing ${button.textContent.trim()} care data`);
  });
}

function bindActions() {
  $("[data-theme-toggle]").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    renderCharts();
  });

  $("[data-sound-toggle]").addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    toast(`Alert sound ${state.soundEnabled ? "enabled" : "muted"}`);
    if (state.soundEnabled) playTone();
  });

  $(".fab-main").addEventListener("click", () => $(".fab-menu").classList.toggle("open"));

  $$("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action));
  });

  $("#alertFilter").addEventListener("change", renderAlerts);
  $("#globalSearch").addEventListener("input", renderSearch);
  $("[data-open-contact]").addEventListener("click", () => openFormModal("Add emergency contact", "Create a quick contact card with call, SMS, and email actions.", "contact"));
  $("[data-open-device]").addEventListener("click", () => openFormModal("Add device", "Register a device by QR code or manual ESP32 ID entry.", "device"));
  $("[data-open-tour]").addEventListener("click", () => runTour());
  $("[data-push-config]").addEventListener("click", () => confirmModal("Push remote configuration", "This will send updated module toggles and thresholds to the selected ESP32 device.", () => {
    toast("Configuration pushed to device queue");
    postBackend("/api/config", collectConfig());
  }));
}

function bindSettings() {
  const sliders = [
    ["highHr", "highHrLabel", " bpm"],
    ["lowHr", "lowHrLabel", " bpm"],
    ["fallSensitivity", "fallSensitivityLabel", "%"]
  ];

  sliders.forEach(([inputId, labelId, suffix]) => {
    const input = $(`#${inputId}`);
    const label = $(`#${labelId}`);
    input.addEventListener("input", () => {
      label.textContent = `${input.value}${suffix}`;
    });
  });

  $("#voiceToggle").addEventListener("change", (event) => {
    state.voiceEnabled = event.target.checked;
    toast(`Voice alerts ${state.voiceEnabled ? "enabled" : "disabled"}`);
  });
}

function subscribeToPatients() {
  if (unsubscribePatients) return;
  unsubscribePatients = onSnapshot(collection(db, "patients"), (snapshot) => {
    state.patients = snapshot.docs.map(mapPatientDoc);

    const validIds = new Set([...state.patients.map((patient) => patient.id), "unified"]);
    if (!validIds.has(state.selectedPatient)) {
      state.selectedPatient = state.patients[0]?.id ?? null;
    }

    snapshot.docChanges().forEach((change) => {
      if (change.doc.id === state.selectedPatient && change.type !== "removed") {
        state.heartTrend = [...state.heartTrend, mapPatientDoc(change.doc).heart].slice(-12);
      }
    });

    state.patients.forEach(evaluateRiskAlerts);
    renderAll();
  }, (error) => {
    toast(`Live data error: ${error.message}`);
  });
}

function unsubscribeFromPatients() {
  if (unsubscribePatients) {
    unsubscribePatients();
    unsubscribePatients = null;
  }
  state.patients = [];
  state.selectedPatient = null;
  state.heartTrend = [];
  Object.keys(activeRiskAlerts).forEach((key) => delete activeRiskAlerts[key]);
  renderAll();
}

function mapPatientDoc(docSnap) {
  const data = docSnap.data();
  const fname = data.fname || "";
  const lname = data.lname || "";
  const heart = Number(data.heart_rate ?? 0);
  return {
    id: docSnap.id,
    name: `${fname} ${lname}`.trim() || data.username || docSnap.id,
    initials: `${fname[0] || ""}${lname[0] || ""}`.toUpperCase() || "?",
    age: data.age ?? "-",
    condition: data.condition || "General monitoring",
    contactPhone: data.contact_phone || "",
    heart,
    bodyTemp: Number(data.body_temp ?? 0),
    fallDetected: Boolean(data.fall_detect),
    longitude: typeof data.longitude === "number" ? data.longitude : undefined,
    latitude: typeof data.latitude === "number" ? data.latitude : undefined,
    deviceId: data.device_id || "",
    risk: data.fall_detect ? "High" : heart > 100 || heart < 55 ? "Medium" : "Low",
    lastUpdated: data.last_updated
  };
}

function evaluateRiskAlerts(patient) {
  const heartLevel = patient.heart > 105 ? "critical" : patient.heart > 96 ? "warning" : "normal";
  const tempLevel = patient.bodyTemp > 38.5 ? "critical" : patient.bodyTemp > 37.5 ? "warning" : "normal";
  const fallLevel = patient.fallDetected ? "critical" : "normal";

  updateRiskAlert(patient, "fall", fallLevel, "Fall detected", `Impact signature detected for ${patient.name}. Emergency contacts should be notified.`);
  updateRiskAlert(patient, "heart", heartLevel, heartLevel === "critical" ? "Heart rate critical" : "Heart rate elevated", `${patient.heart} bpm recorded for ${patient.name}.`);
  updateRiskAlert(patient, "temp", tempLevel, tempLevel === "critical" ? "Fever detected" : "Body temperature elevated", `${patient.bodyTemp.toFixed(1)}°C recorded for ${patient.name}.`);
}

function updateRiskAlert(patient, axis, level, title, detail) {
  const key = `${patient.id}:${axis}`;
  const existing = activeRiskAlerts[key];

  if (level === "normal") {
    if (existing) {
      const alert = state.alerts.find((item) => item.id === existing.id);
      if (alert) alert.status = "Resolved";
      delete activeRiskAlerts[key];
    }
    return;
  }

  if (existing && existing.severity === level) return;

  if (existing) {
    const alert = state.alerts.find((item) => item.id === existing.id);
    if (alert) alert.status = "Resolved";
  }

  const alert = {
    id: `${Date.now()}-${alertIdCounter++}`,
    severity: level,
    title,
    person: patient.name,
    time: "Just now",
    status: "New",
    detail
  };
  state.alerts.unshift(alert);
  state.alerts = state.alerts.slice(0, 20);
  activeRiskAlerts[key] = { id: alert.id, severity: level };
}

function formatLastUpdated(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") return "just now";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp.toDate().getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function renderPatientSegments() {
  const container = $("#patientSegments");
  if (!container) return;
  const buttons = state.patients.map((patient) => `
    <button class="segment${state.selectedPatient === patient.id ? " active" : ""}" type="button" data-patient="${patient.id}">${patient.name.split(" ")[0]}</button>
  `);
  if (state.patients.length > 1) {
    buttons.push(`<button class="segment${state.selectedPatient === "unified" ? " active" : ""}" type="button" data-patient="unified">Unified</button>`);
  }
  container.innerHTML = buttons.join("");
}

function renderAll() {
  renderPatientSegments();
  renderDashboard();
  renderAlerts();
  renderProfiles();
  renderDevices();
  renderCharts();
  renderTimeline();
}

function renderDashboard() {
  const patient = getSelectedPatient();
  if (!patient) {
    $("#heroName").textContent = "Waiting for patient data...";
    $("#priorityAlerts").innerHTML = "";
    return;
  }
  $("#heroName").innerHTML = patient.id === "unified"
    ? `Monitoring <span class="hero-name-highlight">all enrolled loved ones</span>`
    : `Monitoring <span class="hero-name-highlight">${patient.name}</span>`;
  $("#heartRate").textContent = patient.heart;
  $("#bodyTemp").textContent = patient.bodyTemp.toFixed(1);
  $("#tempStatus").className = `status-pill ${patient.bodyTemp > 38.5 ? "critical" : patient.bodyTemp > 37.5 ? "warning" : "normal"}`;
  $("#tempStatus").textContent = patient.bodyTemp > 38.5 ? "Fever" : patient.bodyTemp > 37.5 ? "Elevated" : "Normal";
  $("#tempHint").textContent = patient.bodyTemp > 38.5 ? "Above fever threshold. Contact caregiver." : patient.bodyTemp > 37.5 ? "Slightly elevated. Keep watch." : "Within normal care threshold.";
  $("#heartRange").style.width = `${Math.min(96, Math.max(12, patient.heart - 25))}%`;
  $("#heartStatus").className = `status-pill ${patient.heart > 105 ? "critical" : patient.heart > 96 ? "warning" : "normal"}`;
  $("#heartStatus").textContent = patient.heart > 105 ? "Critical" : patient.heart > 96 ? "Warning" : "Normal";
  $("#heartHint").textContent = patient.heart > 105 ? "Above configured threshold. Contact caregiver." : patient.heart > 96 ? "Slightly elevated. Keep watch." : "Within normal care threshold.";
  $("#fallScore").textContent = patient.fallDetected ? "Detected" : "Clear";
  $("#fallStatus").className = `status-pill ${patient.fallDetected ? "critical" : "normal"}`;
  $("#fallStatus").textContent = patient.fallDetected ? "Fall detected" : "Calm";
  $("#fallHint").textContent = patient.fallDetected ? "Impact signature detected. Emergency contacts notified." : "No current fall detected.";
  const hasGps = typeof patient.latitude === "number" && typeof patient.longitude === "number";
  $("#gpsHint").textContent = hasGps
    ? `${patient.latitude.toFixed(4)}, ${patient.longitude.toFixed(4)}, updated ${formatLastUpdated(patient.lastUpdated)}.`
    : "Waiting for GPS fix.";
  renderPriorityAlerts(patient);
}

function renderPriorityAlerts(patient) {
  const items = [];

  if (patient.fallDetected) {
    items.push({
      severity: "critical",
      title: "Fall detected",
      detail: `Impact signature detected for ${patient.name}. Emergency contacts should be notified.`
    });
  }

  if (patient.heart > 105) {
    items.push({ severity: "critical", title: "Heart rate critical", detail: `${patient.heart} bpm — above the critical threshold.` });
  } else if (patient.heart > 96) {
    items.push({ severity: "warning", title: "Heart rate elevated", detail: `${patient.heart} bpm — slightly above the normal range.` });
  }

  if (patient.bodyTemp > 38.5) {
    items.push({ severity: "critical", title: "Fever detected", detail: `${patient.bodyTemp.toFixed(1)}°C — above the fever threshold.` });
  } else if (patient.bodyTemp > 37.5) {
    items.push({ severity: "warning", title: "Body temperature elevated", detail: `${patient.bodyTemp.toFixed(1)}°C — slightly above normal.` });
  }

  $("#priorityAlerts").innerHTML = items.map((item) => `
    <div class="priority-alert ${item.severity}">
      <div><span class="alert-ring ${item.severity}" aria-hidden="true">!</span></div>
      <div>
        <h3>${item.title}</h3>
        <p>${item.detail}</p>
      </div>
      <div class="priority-actions">
        <button class="secondary-button small" type="button" data-section-jump="alerts">View alert</button>
      </div>
    </div>
  `).join("");

  $$("#priorityAlerts [data-section-jump]").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.sectionJump));
  });
}

function renderAlerts() {
  const filter = $("#alertFilter")?.value || "all";
  const alerts = state.alerts
    .filter((alert) => filter === "all" || alert.severity === filter)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  $("#alertFeed").innerHTML = alerts.map((alert) => `
    <article class="alert-item ${alert.severity}" data-alert="${alert.id}">
      <span class="metric-icon ${alert.severity === "critical" ? "heart" : "fall"}" aria-hidden="true">${alert.severity === "critical" ? "!" : "~"}</span>
      <div>
        <span class="status-pill ${alert.severity}">${alert.status}</span>
        <h3>${alert.title}</h3>
        <p>${alert.person} - ${alert.time} - ${alert.detail}</p>
      </div>
      <div class="alert-actions">
        <button class="primary-button small" type="button" data-alert-action="ack" data-id="${alert.id}">Acknowledge</button>
        <button class="secondary-button small" type="button" data-alert-action="call" data-id="${alert.id}">Call</button>
        <button class="secondary-button small" type="button" data-alert-action="location" data-id="${alert.id}">Location</button>
        <button class="secondary-button small" type="button" data-alert-action="dismiss" data-id="${alert.id}">Dismiss</button>
      </div>
    </article>
  `).join("");

  $$("[data-alert-action]").forEach((button) => {
    button.addEventListener("click", () => updateAlert(button.dataset.id, button.dataset.alertAction));
  });
}

function renderProfiles() {
  $("#profileGrid").innerHTML = state.patients.map((patient) => `
    <article class="profile-card">
      <div class="profile-header">
        <span class="avatar">${patient.initials}</span>
        <div>
          <h3>${patient.name}</h3>
          <p>${patient.age} years - ${patient.condition}</p>
        </div>
      </div>
      <p>Primary device: ${patient.deviceId || "Not assigned"}. Current risk level is ${patient.risk.toLowerCase()} with live monitoring enabled.</p>
      ${patient.contactPhone ? `
        <div class="contact-list">
          <div class="contact-card">
            <strong>Emergency contact</strong>
            <span>${patient.contactPhone}</span>
            <div class="contact-actions">
              <button class="secondary-button small" type="button" data-contact-action="call" data-phone="${patient.contactPhone}">Call</button>
            </div>
          </div>
        </div>
      ` : ""}
    </article>
  `).join("");

  $$("[data-contact-action]").forEach((button) => {
    button.addEventListener("click", () => toast(`Calling ${button.dataset.phone}`));
  });
}

function renderDevices() {
  $("#deviceGrid").innerHTML = state.devices.map((device) => `
    <article class="device-card">
      <div class="card-topline">
        <h3>${device.name}</h3>
        <span class="status-pill ${device.status === "Online" ? "normal" : "critical"}">${device.status}</span>
      </div>
      <p>${device.id} - ${device.owner}</p>
      <div class="device-meta">
        <span>Battery: ${device.battery}%</span>
        <span>Signal: ${device.signal}%</span>
        <span>Last: ${device.last}</span>
      </div>
      <div class="device-actions">
        <button class="primary-button small" type="button" data-device-action="view">View data</button>
        <button class="secondary-button small" type="button" data-device-action="configure">Configure</button>
        <button class="secondary-button small" type="button" data-device-action="test">Test alert</button>
      </div>
    </article>
  `).join("");

  $$("[data-device-action]").forEach((button) => {
    button.addEventListener("click", () => toast(`${button.textContent.trim()} queued`));
  });
}

function renderCharts() {
  drawLineChart($("#heartChart"), state.heartTrend, { min: 50, max: 120, color: "#0f9f9a" });
  drawBarChart($("#fallChart"), state.fallTrend, "#2563eb");
}

function renderTimeline() {
  $("#locationTimeline").innerHTML = state.locationTrail.map((item) => `
    <div class="timeline-item">
      <strong>${item.place}</strong>
      <p>${item.detail}</p>
      <small class="muted">${item.time}</small>
    </div>
  `).join("");
}

function drawLineChart(canvas, values, options) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getCanvasSurface();
  ctx.fillRect(0, 0, width, height);
  const pad = 34;
  const xStep = (width - pad * 2) / (values.length - 1);
  const yFor = (value) => height - pad - ((value - options.min) / (options.max - options.min)) * (height - pad * 2);

  ctx.fillStyle = "rgba(26, 155, 97, 0.10)";
  ctx.fillRect(pad, yFor(100), width - pad * 2, yFor(60) - yFor(100));

  ctx.strokeStyle = "rgba(102, 118, 122, 0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = pad + i * ((height - pad * 2) / 4);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  ctx.beginPath();
  values.forEach((value, index) => {
    const x = pad + index * xStep;
    const y = yFor(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = options.color;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.lineTo(width - pad, height - pad);
  ctx.lineTo(pad, height - pad);
  ctx.closePath();
  ctx.fillStyle = "rgba(15, 159, 154, 0.12)";
  ctx.fill();
}

function drawBarChart(canvas, values, color) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getCanvasSurface();
  ctx.fillRect(0, 0, width, height);
  const pad = 34;
  const gap = 18;
  const barWidth = (width - pad * 2 - gap * (values.length - 1)) / values.length;
  const max = Math.max(2, ...values);
  values.forEach((value, index) => {
    const barHeight = ((height - pad * 2) * value) / max;
    const x = pad + index * (barWidth + gap);
    const y = height - pad - barHeight;
    ctx.fillStyle = value > 1 ? "#d83a3a" : color;
    roundedRect(ctx, x, y, barWidth, barHeight || 4, 8);
    ctx.fill();
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted");
    ctx.font = "18px Inter, sans-serif";
    ctx.fillText(String(value), x + barWidth / 2 - 5, y - 8);
  });
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function getSelectedPatient() {
  if (!state.patients.length) return null;
  if (state.selectedPatient === "unified") {
    const highestPriority = [...state.patients].sort(
      (a, b) => Number(b.fallDetected) - Number(a.fallDetected) || b.heart - a.heart
    )[0];
    return { ...highestPriority, name: "Unified dashboard", id: "unified" };
  }
  return state.patients.find((patient) => patient.id === state.selectedPatient) || state.patients[0];
}

function showSection(section) {
  state.activeSection = section;
  $$(".page-section").forEach((item) => item.classList.toggle("active", item.dataset.section === section));
  $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.sectionLink === section));
  history.replaceState(null, "", `#${section}`);
}

function handleAction(action) {
  const patient = getSelectedPatient();
  const actions = {
    sos: () => confirmModal("Trigger Emergency SOS", "This will notify emergency contacts, start voice alerting, and mark the current location as critical.", () => {
      createAlert("critical", "Emergency SOS triggered", patient.name, "Caregiver activated dashboard SOS.");
      voice("Emergency SOS triggered.");
      toast("Emergency SOS sent");
    }),
    report: () => toast("Branded care report generated with vitals, alerts, notes, and device history"),
    "test-alert": () => {
      createAlert("warning", "Test alert sent", patient.name, "Caregiver test alert completed successfully.");
      playTone();
      toast("Test alert added to feed");
    },
    voice: () => {
      const location = typeof patient.latitude === "number"
        ? `${patient.latitude.toFixed(4)}, ${patient.longitude.toFixed(4)}`
        : "an unknown location";
      voice(`Fall detected. Location is ${location}. Emergency contacts have been notified.`);
    },
    export: () => exportCsv(),
    share: () => toast("Shareable report link prepared")
  };
  if (!patient && ["sos", "test-alert", "voice"].includes(action)) {
    toast("No patient data yet — sign in and wait for live data.");
    return;
  }
  actions[action]?.();
}

function updateAlert(id, action) {
  const alert = state.alerts.find((item) => String(item.id) === String(id));
  if (!alert) return;
  if (action === "ack") alert.status = "Acknowledged";
  if (action === "dismiss") alert.status = "Resolved";
  if (action === "call") toast(`Calling emergency contact for ${alert.person}`);
  if (action === "location") showSection("dashboard");
  renderAlerts();
  if (action === "ack" || action === "dismiss") toast(`Alert marked ${alert.status.toLowerCase()}`);
}

function createAlert(severity, title, person, detail) {
  state.alerts.unshift({ id: Date.now(), severity, title, person, time: "Just now", status: "New", detail });
  renderAlerts();
  postBackend("/api/alerts", { severity, title, person, detail });
}

function openFormModal(title, text, type) {
  $("#modalTitle").textContent = title;
  $("#modalText").textContent = text;
  $("#modalBody").innerHTML = type === "contact"
    ? `<div class="modal-form"><input placeholder="Contact name"><input placeholder="Relationship"><input placeholder="Phone number"><input placeholder="Email"></div>`
    : `<div class="modal-form"><input placeholder="Device name"><input placeholder="ESP32 device ID"><input placeholder="Assigned profile"><input placeholder="SIM number"></div>`;
  $("#careModal").showModal();
  $("#modalConfirm").onclick = () => toast(`${title} saved`);
}

function confirmModal(title, text, onConfirm) {
  $("#modalTitle").textContent = title;
  $("#modalText").textContent = text;
  $("#modalBody").innerHTML = "";
  $("#careModal").showModal();
  $("#modalConfirm").onclick = () => {
    onConfirm();
  };
}

function runTour() {
  const steps = [
    "Dashboard cards show live heart rate, fall risk, GPS, and device connectivity.",
    "Alert Center auto-sorts urgent events and gives one-click care actions.",
    "Settings push module toggles and thresholds to the device queue."
  ];
  let index = 0;
  const next = () => {
    toast(steps[index]);
    index += 1;
    if (index < steps.length) setTimeout(next, 2300);
  };
  next();
}

function renderSearch() {
  const query = $("#globalSearch").value.trim().toLowerCase();
  if (!query) {
    renderAlerts();
    return;
  }
  const alertMatches = state.alerts.filter((alert) => `${alert.title} ${alert.person} ${alert.detail}`.toLowerCase().includes(query));
  $("#alertFeed").innerHTML = alertMatches.map((alert) => `
    <article class="alert-item ${alert.severity}">
      <span class="metric-icon fall" aria-hidden="true">~</span>
      <div><span class="status-pill ${alert.severity}">${alert.status}</span><h3>${alert.title}</h3><p>${alert.person} - ${alert.detail}</p></div>
    </article>
  `).join("");
}

function collectConfig() {
  return {
    highHeartRate: Number($("#highHr").value),
    lowHeartRate: Number($("#lowHr").value),
    fallSensitivity: Number($("#fallSensitivity").value),
    voiceAlerts: $("#voiceToggle").checked
  };
}

async function hydrateFromBackend() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    state.alerts = data.alerts || state.alerts;
    state.devices = data.devices || state.devices;
    renderAlerts();
    renderDevices();
  } catch {
    // No backend running: alerts/devices stay on their local demo values.
  }
}

async function postBackend(path, payload) {
  try {
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch {
    // Static mode keeps working without a server.
  }
}

function exportCsv() {
  const rows = [
    ["type", "person", "title", "time", "status"],
    ...state.alerts.map((alert) => [alert.severity, alert.person, alert.title, alert.time, alert.status])
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll("\"", "\"\"")}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "secms-alert-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function severityRank(severity) {
  return { resolved: 0, warning: 1, critical: 2 }[severity] || 0;
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  $("#toastRegion").appendChild(node);
  setTimeout(() => node.remove(), 3300);
}

function playTone() {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 620;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.32);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.34);
  } catch {
    toast("Audio is unavailable in this browser");
  }
}

function voice(text) {
  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 0.95;
    speechSynthesis.speak(utterance);
  }
  toast(text);
}

function getCanvasSurface() {
  return document.body.classList.contains("dark") ? "#1e3032" : "#eef7f5";
}