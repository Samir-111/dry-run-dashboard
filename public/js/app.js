// ============================================================
// Shared logic for every Pump Protector page.
// ============================================================

// ---------------- Auth (mock / local storage session) ----------------
function loadAuth() {
  try {
    const raw = localStorage.getItem('pumpAuth');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveAuth(a) {
  localStorage.setItem('pumpAuth', JSON.stringify(a));
}

function clearAuth() {
  localStorage.removeItem('pumpAuth');
}

// Call at the top of protected pages (home/dashboard/pump/alerts/profile)
function requireAuth() {
  if (!loadAuth()) {
    // Not authenticated — send to the login page
    window.location.replace('login.html');
  }
}

// Call at the top of index.html/login.html so an already authed user can jump right in
function redirectIfAuthed(target) {
  if (loadAuth()) {
    window.location.href = target;
  }
}

function doLogout() {
  clearAuth();
  window.location.href = 'login.html';
}

// ---------------- Duration & Runtime Formatters ----------------
function formatDurationMs(ms, detailed = false) {
  if (!ms || isNaN(ms) || ms <= 0) return detailed ? '00:00:00' : '0m';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (detailed) {
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

// ---------------- Multi-Language Dictionary (English / Hindi / Marathi) ----------------
const I18N = {
  en: {
    brand: 'KisanGuard Pro',
    home: 'Home',
    data: 'Data & History',
    pump: 'Pump Control',
    alerts: 'Alert Center',
    profile: 'Profile & GSM',
    startMotor: 'Start Motor',
    stopMotor: 'Stop Motor',
    motorRunning: 'Motor is Running',
    motorOff: 'Motor is Off',
    motorOffline: 'Motor Offline',
    lockoutActive: 'Dry-Run Lockout',
    waterPresent: 'Water Present',
    waterAbsent: 'Water Absent (Dry)',
    todayRuntime: "Today's Motor ON Time",
    activeSession: 'Active Motor ON Session',
    monthRuntime: '30-Day Motor ON Time',
    timerOff: 'Off (Continuous)',
    timer15m: '15 Minutes',
    timer30m: '30 Minutes',
    timer1h: '1 Hour',
    timer2h: '2 Hours',
    reset: 'Reset Lockout',
    exportCsv: 'Export Sessions (CSV)',
    language: 'Language'
  },
  hi: {
    brand: 'किसानगार्ड प्रो',
    home: 'होम',
    data: 'डेटा और इतिहास',
    pump: 'पंप नियंत्रण',
    alerts: 'अलर्ट केंद्र',
    profile: 'प्रोफाइल और जीएसएम',
    startMotor: 'मोटर चालू करें',
    stopMotor: 'मोटर बंद करें',
    motorRunning: 'मोटर चल रही है',
    motorOff: 'मोटर बंद है',
    motorOffline: 'मोटर ऑफलाइन',
    lockoutActive: 'ड्राय-रन लॉकआउट',
    waterPresent: 'पानी उपलब्ध है',
    waterAbsent: 'पानी अनुपलब्ध (सूखा)',
    todayRuntime: 'आज की मोटर चालू समय',
    activeSession: 'वर्तमान चालू सेशन',
    monthRuntime: '30-दिन की कुल अवधि',
    timerOff: 'बंद (अनवरत)',
    timer15m: '15 मिनट',
    timer30m: '30 मिनट',
    timer1h: '1 घंटा',
    timer2h: '2 घंटे',
    reset: 'लॉकआउट रीसेट करें',
    exportCsv: 'सेशन डाउनलोड (CSV)',
    language: 'भाषा'
  },
  mr: {
    brand: 'किसानगार्ड प्रो',
    home: 'मुख्य पृष्ठ',
    data: 'माहिती व इतिहास',
    pump: 'पंप नियंत्रण',
    alerts: 'अलर्ट केंद्र',
    profile: 'प्रोफाइल व GSM',
    startMotor: 'मोटर सुरू करा',
    stopMotor: 'मोटर बंद करा',
    motorRunning: 'मोटर चालू आहे',
    motorOff: 'मोटर बंद आहे',
    motorOffline: 'मोटर ऑफलाइन',
    lockoutActive: 'ड्राय-रन लॉकआउट',
    waterPresent: 'पाणी उपलब्ध आहे',
    waterAbsent: 'पाणी नाही (ड्राय)',
    todayRuntime: 'आजचा मोटर चालू वेळ',
    activeSession: 'सध्याचा चालू वेळ',
    monthRuntime: '३० दिवसांचा एकूण वेळ',
    timerOff: 'बंद (सतत)',
    timer15m: '१५ मिनिटे',
    timer30m: '३० मिनिटे',
    timer1h: '१ तास',
    timer2h: '२ तास',
    reset: 'रीसेट करा',
    exportCsv: 'सेशन डाऊनलोड (CSV)',
    language: 'भाषा'
  }
};

function getLanguage() {
  return localStorage.getItem('kgLang') || 'en';
}

function setLanguage(lang) {
  if (['en', 'hi', 'mr'].includes(lang)) {
    localStorage.setItem('kgLang', lang);
    window.location.reload();
  }
}

function t(key) {
  const lang = getLanguage();
  return (I18N[lang] && I18N[lang][key]) || I18N['en'][key] || key;
}

// ---------------- Navigation Injector (Desktop Header & Mobile Bottom Bar) ----------------
const NAV_ITEMS = [
  { id: 'home', labelKey: 'home', defaultLabel: 'Home', href: 'home.html', icon: '<path d="M6 9c0-3 2.5-5 6-5s6 2 6 5"/><path d="M5 9c0 1.5 1 2.5 3 2.5h8c2 0 3-1 3-2.5"/><circle cx="12" cy="13" r="3.5"/><path d="M4 21c0-3 3.5-4.5 8-4.5s8 1.5 8 4.5"/>' },
  { id: 'dashboard', labelKey: 'data', defaultLabel: 'Data', href: 'dashboard.html', icon: '<path d="M12 22V8"/><path d="M12 18c-2-1-4-1-5 1"/><path d="M12 18c2-1 4-1 5 1"/><path d="M12 14c-2.5-1.5-5-1.5-6 1"/><path d="M12 14c2.5-1.5 5-1.5 6 1"/><path d="M12 10c-3-2-6-1.5-7 1"/><path d="M12 10c3-2 6-1.5 7 1"/>' },
  { id: 'pump', labelKey: 'pump', defaultLabel: 'Pump', href: 'pump.html', icon: '<path d="M6 18h12M12 18V7M9 7h6M12 7V4M12 4H7v3"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>' },
  { id: 'alerts', labelKey: 'alerts', defaultLabel: 'Alerts', href: 'alerts.html', icon: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>' },
  { id: 'profile', labelKey: 'profile', defaultLabel: 'Profile', href: 'profile.html', icon: '<path d="M3 17h2M19 17h2"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="16" r="4"/><path d="M7 14h6v-6h-3L7 11z"/>' }
];

function injectNav(activeId) {
  const curLang = getLanguage();

  // Mobile Bottom Nav
  let mount = document.getElementById('bottomNav');
  if (!mount) {
    const existing = document.querySelector('.bottom-nav, .mobile-bottom-bar');
    if (existing) mount = existing;
  }

  if (mount) {
    const items = NAV_ITEMS.map(item => {
      const label = t(item.labelKey) || item.defaultLabel;
      return `
      <a class="nav-item ${item.id === activeId ? 'active' : ''}" href="${item.href}" id="nav_${item.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${item.icon}</svg>
        <span>${label}</span>
      </a>`;
    }).join('');
    mount.outerHTML = `<nav class="bottom-nav" id="bottomNav">${items}</nav>`;
  }

  // Desktop Header Nav
  const desktopNav = document.getElementById('desktopNav');
  if (desktopNav) {
    const links = NAV_ITEMS.map(item => {
      const label = t(item.labelKey) || item.defaultLabel;
      return `
      <a class="desktop-nav-link ${item.id === activeId ? 'active' : ''}" href="${item.href}">
        ${label}
      </a>`;
    }).join('');

    const langSelectorHtml = `
      <div style="margin-left:12px; display:inline-flex; align-items:center; gap:4px;">
        <select onchange="setLanguage(this.value)" style="background:rgba(255,255,255,0.15); color:#FFFFFF; border:1px solid rgba(255,255,255,0.3); border-radius:14px; padding:4px 8px; font-size:11.5px; font-weight:700; cursor:pointer; outline:none;">
          <option value="en" ${curLang === 'en' ? 'selected' : ''} style="color:#000;">English 🇬🇧</option>
          <option value="hi" ${curLang === 'hi' ? 'selected' : ''} style="color:#000;">हिन्दी 🇮🇳</option>
          <option value="mr" ${curLang === 'mr' ? 'selected' : ''} style="color:#000;">मराठी 🇮🇳</option>
        </select>
      </div>`;

    desktopNav.innerHTML = links + langSelectorHtml;
  }
}

// ---------------- Toast Notification ----------------
function toast(msg, type = 'info') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ---------------- Audio Alarm Synth for Dry-Run Faults ----------------
let _audioCtx = null;
function playFaultSiren() {
  try {
    if (!localStorage.getItem('sirenEnabled')) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!_audioCtx) _audioCtx = new AudioCtx();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();

    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, _audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, _audioCtx.currentTime + 0.5);

    gain.gain.setValueAtTime(0.3, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, _audioCtx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(_audioCtx.destination);

    osc.start();
    osc.stop(_audioCtx.currentTime + 0.5);
  } catch (e) { /* silent */ }
}

// ---------------- API Calls ----------------
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const state = await res.json();
    return { state, reachable: true, live: !!state.online };
  } catch (err) {
    return { state: {}, reachable: false, live: false };
  }
}

async function fetchSessions(limit = 100) {
  try {
    const res = await fetch(`/api/sessions?limit=${limit}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function postMotor(on, timerMinutes = null) {
  const res = await fetch('/api/motor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on, timerMinutes })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to ${on ? 'start' : 'stop'} pump`);
  }
  return await res.json();
}

async function postThreshold(value) {
  const res = await fetch('/api/threshold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update threshold');
  }
  return await res.json();
}

async function postReset() {
  const res = await fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  return await res.json();
}

// ---------------- Water Sensor Evaluation ----------------
function isWaterPresent(waterStatus, waterRaw) {
  if (waterStatus !== null && waterStatus !== undefined && waterStatus !== '') {
    const str = String(waterStatus).trim().toUpperCase();
    if (['1', 'PRESENT', 'WATER PRESENT', 'OK', 'NORMAL', 'DETECTED', 'YES'].includes(str)) {
      return true;
    }
    if (['0', 'ABSENT', 'WATER ABSENT', 'DRY', 'LOW', 'EMPTY', 'NONE', 'NO'].includes(str)) {
      return false;
    }
    const num = Number(str);
    if (!isNaN(num)) return num > 0;
  }
  if (waterRaw !== null && waterRaw !== undefined) {
    return Number(waterRaw) >= 1500;
  }
  return null;
}

function formatWaterStatus(waterStatus, waterRaw) {
  const present = isWaterPresent(waterStatus, waterRaw);
  if (present === null) return 'Checking…';
  return present ? 'Water Present' : 'Water Absent (Dry)';
}

// ---------------- Pump State Helper ----------------
function pumpIsRunning(state) {
  if (!state) return false;
  if (state.relayStatus === true || state.relayStatus === 1 || state.relayStatus === '1') return true;
  if (state.relay === true || state.relay === 1 || state.relay === '1') return true;
  if (state.pumpStatus) {
    const s = String(state.pumpStatus).trim().toUpperCase();
    if (['RUNNING', 'STARTING', 'ON'].includes(s)) return true;
  }
  if (state.systemState) {
    const s = String(state.systemState).trim().toUpperCase();
    if (['RUNNING', 'STARTING'].includes(s)) return true;
  }
  return false;
}

// ---------------- Status Styling Helpers ----------------
function stateColor(sysState, fault) {
  if (fault && String(fault).toUpperCase() !== 'NONE') return 'red';
  if (!sysState) return 'gray';
  const s = String(sysState).trim().toUpperCase();
  if (s === 'RUNNING' || s === 'ON') return 'green';
  if (s === 'STARTING' || s === 'WAITING FOR WATER') return 'amber';
  if (s.includes('FAULT') || s.includes('PROTECT') || s.includes('WARNING') || s.includes('LOSS')) return 'red';
  if (s === 'OFF' || s === 'IDLE') return 'gray';
  return 'gray';
}

function describeState(s, fault) {
  if (fault && String(fault).toUpperCase() !== 'NONE') {
    return `Alert: ${fault}`;
  }
  const u = (s || '').trim().toUpperCase();
  if (u === 'RUNNING' || u === 'ON') return 'Your pump is running normally';
  if (u === 'STARTING') return 'Startup bypass active (90s)';
  if (u === 'WATER WARNING') return 'Water loss detected — checking response timer';
  if (u === 'PROTECTING' || u.includes('FAULT')) return 'Dry run detected — pump stopped to protect motor';
  if (u === 'WAITING FOR WATER') return 'Waiting for water level to return';
  if (u === 'OFF' || u === 'IDLE') return 'Pump is off and ready';
  return 'System ready';
}

function connLabel(reachable, live) {
  if (!reachable) return 'Server Offline';
  return live ? 'Device Online' : 'Pump Unit Offline';
}

function setPill(id, text, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'status-pill pill-' + color;
  const label = el.querySelector('span:last-child');
  if (label) label.textContent = text;
}

function setCheck(id, ok, text) {
  const icon = document.getElementById(id);
  if (icon) {
    icon.className = 'check-icon ' + (ok ? 'ok' : 'bad');
  }
  const label = document.getElementById(id + 'Text');
  if (label) label.textContent = text;
}

function setConnDot(id, live) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'conn-dot ' + (live ? 'live' : 'down');
}

// ---------------- Alert Log (Local client store with deduplication) ----------------
let _lastLoggedEvent = '';

function loadAlerts() {
  try {
    return JSON.parse(localStorage.getItem('pumpAlerts')) || [];
  } catch {
    return [];
  }
}

function saveAlerts(list) {
  localStorage.setItem('pumpAlerts', JSON.stringify(list));
}

function logAlertIfNew(fault, sysState) {
  const hasFault = fault && String(fault).toUpperCase() !== 'NONE';
  const hasLock = sysState && (String(sysState).toUpperCase().includes('FAULT') || String(sysState).toUpperCase().includes('PROTECT'));
  
  if (!hasFault && !hasLock) {
    _lastLoggedEvent = '';
    return;
  }
  
  const title = hasFault ? fault : sysState;
  const key = `${title}`;
  if (key === _lastLoggedEvent) return;
  _lastLoggedEvent = key;

  const list = loadAlerts();
  list.unshift({
    fault: title,
    detail: hasFault ? 'Dry-run or system fault triggered automatic pump shutdown' : 'Pump safety lock activated',
    time: new Date().toISOString()
  });
  saveAlerts(list.slice(0, 50));
}

function clearAlerts() {
  saveAlerts([]);
}

// ---------------- Polling Loop ----------------
// Poll every 2 s in direct IoT mode for fast real-time updates.
function startPolling(renderFn, intervalMs = 2000) {
  let isPolling = false;
  async function tick() {
    if (isPolling) return;
    isPolling = true;
    try {
      const { state, reachable, live } = await fetchStatus();
      if (live) {
        logAlertIfNew(state.fault, state.systemState);
      }
      renderFn(state, reachable, live);
    } catch (err) {
      console.error('Polling error:', err);
    } finally {
      isPolling = false;
    }
  }
  tick();
  return setInterval(tick, intervalMs);
}

// Register service worker if available
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ─── Browser Notification API ────────────────────────────────────────────────

/**
 * Request notification permission once (e.g. after login).
 * Stores result in localStorage so we don't ask every page load.
 */
function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') return;
  if (localStorage.getItem('notifAsked')) return;
  localStorage.setItem('notifAsked', '1');
  Notification.requestPermission();
}

/**
 * Show a browser notification.
 * Safe-guards: checks support and permission before firing.
 */
function sendBrowserNotification(title, body, icon) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body: body || '',
      icon: icon || 'icon-192.png',
      badge: 'icon-192.png',
      tag: title   // deduplicates by title
    });
  } catch (e) { /* silent fail in restricted contexts */ }
}

// ─── Extended logAlertIfNew — also fires browser notification ────────────────

const _origLogAlertIfNew = logAlertIfNew;
// Shadow the original: runs same logic then adds notification
function logAlertIfNew(fault, sysState) {
  const wasFault = fault && String(fault).toUpperCase() !== 'NONE';
  const wasLock  = sysState && (
    String(sysState).toUpperCase().includes('FAULT') ||
    String(sysState).toUpperCase().includes('PROTECT')
  );
  // Call original to maintain existing deduplication & localStorage logic
  _origLogAlertIfNew(fault, sysState);

  if (wasFault || wasLock) {
    const title = wasFault ? `⚠️ Pump Fault: ${fault}` : '⚠️ Pump Protection Activated';
    const body  = 'Dry-run detected. Pump stopped. SMS alert sent to farmer.';
    sendBrowserNotification(title, body);
  }
}

// ─── History API helper ───────────────────────────────────────────────────────

/**
 * Fetch telemetry history from the server.
 * @param {number} days - Number of days to retrieve (max 30)
 */
async function fetchHistory(days = 30) {
  try {
    const res = await fetch(`/api/history?days=${days}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── GSM / SIM800L client helpers ────────────────────────────────────────────

function loadGSMLog() {
  try { return JSON.parse(localStorage.getItem('pumpGSMLog')) || []; }
  catch { return []; }
}

function saveGSMLog(list) {
  localStorage.setItem('pumpGSMLog', JSON.stringify(list.slice(0, 50)));
}

function logGSMEvent(entry) {
  const list = loadGSMLog();
  list.unshift({ ...entry, time: entry.time || new Date().toISOString() });
  saveGSMLog(list);
}

function clearGSMLog() {
  saveGSMLog([]);
}

/** Fetch live GSM state from the Node server (non-blocking). */
async function fetchGSMStatus() {
  try {
    const res = await fetch('/api/gsm');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Send a test SMS via the server -> Blynk V12. */
async function postTestSMS() {
  const res = await fetch('/api/gsm/test-sms', { method: 'POST' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Failed to send test SMS');
  }
  return await res.json();
}

/** Trigger a test call via the server -> Blynk V12. */
async function postTestCall() {
  const res = await fetch('/api/gsm/test-call', { method: 'POST' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Failed to trigger test call');
  }
  return await res.json();
}

/**
 * Render GSM signal bars element.
 * signal: 0-31 (99 = unknown). Returns HTML string.
 */
function gsmSignalHTML(signal) {
  let cls = 'sig-none';
  if (signal !== null && signal !== 99) {
    if (signal >= 20) cls = 'sig-good';
    else if (signal >= 10) cls = 'sig-fair';
    else if (signal >= 1) cls = 'sig-weak';
  }
  return `<span class="signal-bars ${cls}" title="GSM signal ${signal === 99 ? 'unknown' : (signal + '/31')}">
    <span class="bar"></span><span class="bar"></span>
    <span class="bar"></span><span class="bar"></span>
  </span>`;
}

/**
 * Render GSM status badge HTML.
 * statusStr: e.g. "READY SIG:18/31", "ERROR", "INITIALIZING"
 */
function gsmBadgeHTML(statusStr) {
  const s = (statusStr || '').toUpperCase();
  let cls = 'unknown', label = statusStr || 'Unknown';
  if (s.startsWith('READY')) { cls = 'ready'; label = 'Ready'; }
  else if (s === 'ERROR' || s === 'NO SIM') { cls = 'error'; label = s; }
  else if (s === 'INITIALIZING' || s === 'CHECKING') { cls = 'check'; label = 'Checking…'; }
  return `<span class="gsm-badge ${cls}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="12" height="12">
      <rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>
    </svg>${label}
  </span>`;
}

// ─── Alert contact + Twilio fallback (server-persisted) ──────────────────────

/** Fetch the saved alert contact number + Twilio-backup preference. */
async function fetchAlertContact() {
  try {
    const res = await fetch('/api/alert-contact');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Save/update the alert contact number and Twilio-backup preference. */
async function postAlertContact(mobile, twilioBackupEnabled) {
  const res = await fetch('/api/alert-contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile, twilioBackupEnabled })
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Failed to save alert contact');
  }
  return await res.json();
}

/** Fetch Twilio fallback status (configured?, last fallback SMS/call, log). */
async function fetchTwilioStatus() {
  try {
    const res = await fetch('/api/twilio');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
