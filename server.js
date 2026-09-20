require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Direct In-Memory IoT State Store ─────────────────────────────────────
let deviceStore = {
  lastSeen: 0,
  relay: false,
  pumpStatus: 'OFF',
  waterStatus: 'ABSENT',
  waterRaw: 0,
  protectionStatus: 'NORMAL',
  runtime: '00:00:00',
  fault: 'NONE',
  countdown: 0,
  wifiStatus: 'DISCONNECTED',
  relayStatus: false,
  waterThreshold: 1500,
  systemState: 'IDLE'
};

// Pending commands for ESP32
let pendingCommands = {
  relay: null,       // 1 (ON), 0 (OFF), or null (no new command)
  threshold: null,   // integer threshold or null
  reset: false       // true if reset requested
};

// ─── Motor Session & Runtime Tracking Store ───────────────────────────────
const SESSIONS_FILE = path.join(__dirname, 'data', 'sessions.json');

function loadSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSessions(list) {
  try {
    fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    console.warn('[Sessions] Write error:', err.message);
  }
}

let activeSession = null; // { id, startTime, timerMinutes, timerEndsAt }

function startMotorSession(timerMinutes = null) {
  const now = Date.now();
  let timerEndsAt = null;
  if (timerMinutes && Number(timerMinutes) > 0) {
    timerEndsAt = now + Number(timerMinutes) * 60 * 1000;
  }
  activeSession = {
    id: 'sess_' + now,
    startTime: now,
    timerMinutes: timerMinutes ? Number(timerMinutes) : null,
    timerEndsAt
  };
  console.log(`[Session] Motor session started. Timer: ${timerMinutes ? timerMinutes + ' mins' : 'None'}`);
}

function stopMotorSession(stopReason = 'User Stop') {
  if (!activeSession) return;
  const now = Date.now();
  const durationMs = Math.max(0, now - activeSession.startTime);
  const sessionRecord = {
    id: activeSession.id,
    startTime: activeSession.startTime,
    stopTime: now,
    durationMs,
    stopReason: stopReason || 'User Stop',
    dateStr: new Date(activeSession.startTime).toLocaleDateString('en-IN')
  };
  
  let sessions = loadSessions();
  sessions.unshift(sessionRecord);
  // Keep last 1000 sessions
  if (sessions.length > 1000) sessions = sessions.slice(0, 1000);
  saveSessions(sessions);
  
  console.log(`[Session] Motor session stopped. Duration: ${Math.round(durationMs / 1000)}s. Reason: ${sessionRecord.stopReason}`);
  activeSession = null;
}

function calculateRuntimeStats() {
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const thirtyDaysAgo = now - THIRTY_DAYS_MS;
  const sessions = loadSessions();

  let todayTotalMs = 0;
  let monthTotalMs = 0;

  for (const s of sessions) {
    if (s.startTime >= thirtyDaysAgo) {
      monthTotalMs += s.durationMs || 0;
      if (s.startTime >= todayStart) {
        todayTotalMs += s.durationMs || 0;
      }
    }
  }

  let currentSessionMs = 0;
  if (activeSession) {
    currentSessionMs = now - activeSession.startTime;
    todayTotalMs += currentSessionMs;
    monthTotalMs += currentSessionMs;
  }

  return { currentSessionMs, todayTotalMs, monthTotalMs };
}

// Check auto-off timer
setInterval(() => {
  if (activeSession && activeSession.timerEndsAt) {
    const remaining = activeSession.timerEndsAt - Date.now();
    if (remaining <= 0) {
      console.log('[Timer] Auto-off irrigation timer expired! Stopping motor.');
      pendingCommands.relay = 0;
      deviceStore.relay = false;
      deviceStore.pumpStatus = 'OFF';
      deviceStore.systemState = 'OFF';
      stopMotorSession('Auto-Off Timer Expired');
    }
  }
}, 1000);

// ─── 1-Month Rolling History ───────────────────────────────────────────────

const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
// Max entries: 1 per 1.5s for 30 days ≈ 1,728,000 — cap at 50,000 for practicality
const MAX_HISTORY_ENTRIES = 50000;

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveHistory(list) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(list));
}

function appendHistory(data) {
  const now = Date.now();
  const cutoff = now - THIRTY_DAYS_MS;

  let history = loadHistory();

  // Append new record
  history.push({
    ts: now,
    pumpStatus: data.pumpStatus || 'OFF',
    waterStatus: data.waterStatus || 'ABSENT',
    waterRaw: data.waterRaw || 0,
    fault: data.fault || 'NONE',
    runtime: data.runtime || '00:00:00',
    systemState: data.systemState || 'IDLE',
    relay: data.relay || 0
  });

  // Prune entries older than 30 days (rolling overwrite)
  history = history.filter(e => e.ts >= cutoff);

  // Also cap at max entries (remove oldest first)
  if (history.length > MAX_HISTORY_ENTRIES) {
    history = history.slice(history.length - MAX_HISTORY_ENTRIES);
  }

  saveHistory(history);
}

// ─── ESP32 Direct Communication Endpoints ─────────────────────────────────

// ESP32 sends telemetry JSON here every 1.5 seconds
app.post('/api/device/telemetry', (req, res) => {
  const data = req.body || {};
  const now = Date.now();
  
  deviceStore.lastSeen = now;
  deviceStore.wifiStatus = 'CONNECTED';

  const prevRelay = deviceStore.relay;

  if (data.relay !== undefined) deviceStore.relay = (data.relay === 1 || data.relay === true || data.relay === '1');
  if (data.pumpStatus !== undefined) deviceStore.pumpStatus = String(data.pumpStatus);
  if (data.waterStatus !== undefined) deviceStore.waterStatus = String(data.waterStatus);
  if (data.waterRaw !== undefined) deviceStore.waterRaw = Number(data.waterRaw);
  if (data.protectionStatus !== undefined) deviceStore.protectionStatus = String(data.protectionStatus);
  if (data.runtime !== undefined) deviceStore.runtime = String(data.runtime);
  if (data.fault !== undefined) deviceStore.fault = String(data.fault);
  if (data.countdown !== undefined) deviceStore.countdown = Number(data.countdown);
  if (data.relayStatus !== undefined) deviceStore.relayStatus = (data.relayStatus === 1 || data.relayStatus === true);
  if (data.waterThreshold !== undefined) deviceStore.waterThreshold = Number(data.waterThreshold);
  if (data.systemState !== undefined) deviceStore.systemState = String(data.systemState);

  // Sync active motor session state with hardware relay
  if (deviceStore.relay && !activeSession) {
    startMotorSession();
  } else if (!deviceStore.relay && activeSession) {
    const reason = deviceStore.fault && deviceStore.fault !== 'NONE' ? `Fault: ${deviceStore.fault}` : 'Hardware Stop';
    stopMotorSession(reason);
  }

  // Append snapshot to 1-month rolling history
  try {
    appendHistory({
      pumpStatus: deviceStore.pumpStatus,
      waterStatus: deviceStore.waterStatus,
      waterRaw: deviceStore.waterRaw,
      fault: deviceStore.fault,
      runtime: deviceStore.runtime,
      systemState: deviceStore.systemState,
      relay: deviceStore.relay ? 1 : 0
    });
  } catch (histErr) {
    console.warn('[History] Write error:', histErr.message);
  }

  // Send pending commands back to ESP32 in response
  const commandsToReturn = {
    relay: pendingCommands.relay,
    threshold: pendingCommands.threshold,
    reset: pendingCommands.reset
  };

  // If ESP32 state matches pending command, clear pending
  if (pendingCommands.relay !== null && data.relay !== undefined) {
    const cur = (data.relay === 1 || data.relay === true) ? 1 : 0;
    if (cur === pendingCommands.relay) {
      pendingCommands.relay = null;
    }
  }

  // Clear one-time reset flag
  pendingCommands.reset = false;

  res.json({
    success: true,
    command: commandsToReturn,
    serverTime: new Date().toISOString()
  });
});

// ─── Frontend Dashboard Endpoints ──────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const now = Date.now();
  // Device is online ONLY if it synced with real ESP32 telemetry within last 12 seconds
  const isOnline = (now - deviceStore.lastSeen) < 12000;
  
  // If hardware is offline for > 15s while activeSession was running, auto-close session
  if (!isOnline && activeSession) {
    if ((now - deviceStore.lastSeen) > 15000) {
      stopMotorSession('Hardware Disconnected (Offline)');
      deviceStore.relay = false;
      deviceStore.relayStatus = false;
      deviceStore.pumpStatus = 'OFF';
      deviceStore.systemState = 'OFF';
    }
  }

  const runtimeStats = calculateRuntimeStats();

  let autoOffRemainingMs = 0;
  if (activeSession && activeSession.timerEndsAt) {
    autoOffRemainingMs = Math.max(0, activeSession.timerEndsAt - now);
  }

  res.json({
    online: isOnline,
    relay: isOnline ? deviceStore.relay : false,
    pumpStatus: isOnline ? deviceStore.pumpStatus : 'OFF',
    waterStatus: deviceStore.waterStatus,
    waterRaw: deviceStore.waterRaw,
    protectionStatus: deviceStore.protectionStatus,
    runtime: isOnline ? deviceStore.runtime : '00:00:00',
    fault: deviceStore.fault,
    countdown: deviceStore.countdown,
    wifiStatus: isOnline ? 'CONNECTED' : 'DISCONNECTED',
    relayStatus: isOnline ? deviceStore.relayStatus : false,
    waterThreshold: deviceStore.waterThreshold,
    systemState: isOnline ? deviceStore.systemState : 'OFFLINE',
    runtimeStats: {
      currentSessionMs: isOnline ? runtimeStats.currentSessionMs : 0,
      todayTotalMs: runtimeStats.todayTotalMs,
      monthTotalMs: runtimeStats.monthTotalMs,
      activeSessionStart: isOnline && activeSession ? activeSession.startTime : null,
      autoOffTimerMinutes: isOnline && activeSession ? activeSession.timerMinutes : null,
      autoOffRemainingMs: isOnline ? autoOffRemainingMs : 0
    },
    device: {
      mode: 'DIRECT_IOT_SERVER',
      cachedAt: new Date().toISOString(),
      lastSeenSecondsAgo: Math.round((now - deviceStore.lastSeen) / 1000)
    }
  });
});

// ─── History & Session APIs ────────────────────────────────────────────────

// GET /api/history?days=7 — returns records for last N days (max 30)
app.get('/api/history', (req, res) => {
  try {
    const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 30));
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const history = loadHistory().filter(e => e.ts >= cutoff);
    const sessions = loadSessions().filter(s => s.startTime >= cutoff);
    res.json({ success: true, count: history.length, days, history, sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions — returns detailed motor run sessions log
app.get('/api/sessions', (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
    const sessions = loadSessions().slice(0, limit);
    const stats = calculateRuntimeStats();
    res.json({ success: true, count: sessions.length, stats, sessions, activeSession });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export-csv — Download telemetry & sessions in CSV format
app.get('/api/export-csv', (req, res) => {
  try {
    const sessions = loadSessions();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="KisanGuard_Motor_Sessions.csv"');

    let csv = 'Session ID,Start Time,Stop Time,Duration (Seconds),Duration (HH:MM:SS),Stop Reason\n';
    for (const s of sessions) {
      const start = new Date(s.startTime).toLocaleString('en-IN');
      const stop = new Date(s.stopTime).toLocaleString('en-IN');
      const secs = Math.round((s.durationMs || 0) / 1000);
      const h = String(Math.floor(secs / 3600)).padStart(2, '0');
      const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
      const sec = String(secs % 60).padStart(2, '0');
      const formatted = `${h}:${m}:${sec}`;
      csv += `"${s.id}","${start}","${stop}",${secs},"${formatted}","${s.stopReason || 'User Stop'}"\n`;
    }
    res.send(csv);
  } catch (err) {
    res.status(500).send('Error generating CSV: ' + err.message);
  }
});

// Farmer's pump on/off request from Dashboard
app.post('/api/motor', (req, res) => {
  try {
    const now = Date.now();
    const isOnline = (now - deviceStore.lastSeen) < 12000;

    // Strict Offline Protection: Reject motor START if hardware is offline!
    if (req.body.on && !isOnline) {
      return res.status(400).json({
        success: false,
        error: 'System is Offline. Please ensure ESP32 hardware is connected and powered ON before starting the motor.'
      });
    }

    const targetState = req.body.on ? 1 : 0;
    const timerMinutes = req.body.timerMinutes ? Number(req.body.timerMinutes) : null;
    
    pendingCommands.relay = targetState;

    if (!req.body.on) {
      deviceStore.relay = false;
      deviceStore.relayStatus = false;
      deviceStore.pumpStatus = 'OFF';
      deviceStore.systemState = 'OFF';
      stopMotorSession('User Manual Stop');
    } else {
      deviceStore.relay = true;
      deviceStore.relayStatus = true;
      deviceStore.pumpStatus = 'RUNNING';
      deviceStore.systemState = 'RUNNING';
      startMotorSession(timerMinutes);
    }

    res.json({
      success: true,
      relay: deviceStore.relay,
      pumpStatus: deviceStore.pumpStatus,
      timerMinutes
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Calibrate the dry-detection threshold
app.post('/api/threshold', (req, res) => {
  try {
    const val = Number(req.body.value);
    if (isNaN(val)) return res.status(400).json({ error: 'Invalid threshold number' });
    pendingCommands.threshold = val;
    deviceStore.waterThreshold = val;
    res.json({ success: true, value: val });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset command
app.post('/api/reset', (req, res) => {
  try {
    pendingCommands.relay = 0;
    pendingCommands.reset = true;
    deviceStore.relay = false;
    deviceStore.fault = 'NONE';
    deviceStore.protectionStatus = 'NORMAL';
    deviceStore.systemState = 'IDLE';
    deviceStore.pumpStatus = 'OFF';
    stopMotorSession('Emergency Lockout Reset');
    console.log('[Dashboard] Pump Reset command queued');
    res.json({ success: true, message: 'Pump reset command sent to device' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GSM & Alert Contact Helpers ──────────────────────────────────────────

const CONTACT_FILE = path.join(__dirname, 'data', 'alert-contact.json');

function loadContact() {
  try { return JSON.parse(fs.readFileSync(CONTACT_FILE, 'utf8')); }
  catch { return { mobile: null, twilioBackupEnabled: true }; }
}

function saveContact(contact) {
  fs.mkdirSync(path.dirname(CONTACT_FILE), { recursive: true });
  fs.writeFileSync(CONTACT_FILE, JSON.stringify(contact, null, 2));
}

app.get('/api/alert-contact', (req, res) => res.json(loadContact()));

app.post('/api/alert-contact', (req, res) => {
  try {
    const mobile = (req.body.mobile || '').trim();
    const twilioBackupEnabled = req.body.twilioBackupEnabled !== false;
    const contact = { mobile: mobile || null, twilioBackupEnabled };
    saveContact(contact);
    res.json({ success: true, contact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gsm', (req, res) => {
  res.json({
    status: 'READY',
    signal: 25,
    smsLog: [],
    callLog: []
  });
});

const PORT = process.env.PORT || 8081;

const server = app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🌾 BOREWELL PUMP PROTECTOR DIRECT IOT SERVER`);
  console.log(`🌐 Dashboard URL: http://localhost:${PORT}`);
  console.log(`⚡ Direct ESP32 Telemetry: POST /api/device/telemetry`);
  console.log(`📅 History API: GET /api/history?days=30`);
  console.log(`====================================================`);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
