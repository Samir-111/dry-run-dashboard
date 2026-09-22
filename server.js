require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Lightweight keep-alive / health-check endpoints
app.get('/api/ping', (req, res) => res.status(200).send('pong'));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', time: new Date().toISOString() }));

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
  networkType: 'WIFI', // 'WIFI' or 'GSM'
  gsmStatus: 'DISCONNECTED', // 'READY', 'SEARCHING', 'DISCONNECTED'
  gsmSignal: 0,
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

  // Send Instant WhatsApp Alert on Dry Run / Fault Cutoff
  if (stopReason && (stopReason.toLowerCase().includes('fault') || stopReason.toLowerCase().includes('dry') || stopReason.toLowerCase().includes('water') || stopReason.toLowerCase().includes('trip'))) {
    try {
      const usersData = loadUsersData();
      const primaryMobile = (usersData.users && usersData.users[0] && usersData.users[0].mobile) || '9371525696';
      sendWhatsAppMessage(primaryMobile, `⚠️ *KisanGuard Alert:* Farm motor was automatically STOPPED due to Dry Run / Water Shortage! Please check your borewell before restarting.`);
    } catch (e) {
      console.warn('[Alert] WhatsApp notification error:', e.message);
    }
  }
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
  if (data.networkType !== undefined) deviceStore.networkType = String(data.networkType);
  if (data.gsmStatus !== undefined) deviceStore.gsmStatus = String(data.gsmStatus);
  if (data.gsmSignal !== undefined) deviceStore.gsmSignal = Number(data.gsmSignal);

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
    wifiStatus: isOnline ? (deviceStore.wifiStatus || 'CONNECTED') : 'DISCONNECTED',
    networkType: isOnline ? (deviceStore.networkType || 'WIFI') : 'OFFLINE',
    gsmStatus: isOnline ? (deviceStore.gsmStatus || 'DISCONNECTED') : 'OFFLINE',
    gsmSignal: isOnline ? (deviceStore.gsmSignal || 0) : 0,
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
    pinVersion: loadUsersData().pinVersion || 1,
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

// ─── 2-User Private Farm Authentication System ─────────────────────────────
const crypto = require('crypto');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(String(pwd || '').trim()).digest('hex');
}

function loadUsersData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('[Auth] Error reading users file:', e.message);
  }

  return {
    isConfigured: false,
    users: []
  };
}

function saveUsersData(data) {
  try {
    fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('[Auth] Error saving users file:', e.message);
  }
}

// ─── WhatsApp Notifications & Authentication System ─────────────────────────

const twilio = require('twilio');

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('[Twilio] WhatsApp client initialized successfully ✓');
  } catch (err) {
    console.warn('[Twilio] WhatsApp client init error:', err.message);
  }
}

// Global WhatsApp Dispatcher
async function sendWhatsAppMessage(mobile, text) {
  if (!mobile) return false;
  let digits = String(mobile).replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits; // Format to Indian country code
  const toWhatsApp = `whatsapp:+${digits}`;
  const fromWhatsApp = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

  console.log(`====================================================`);
  console.log(`📱 [WHATSAPP DISPATCH] To: ${toWhatsApp} (+${digits})`);
  console.log(`💬 Content: ${text}`);
  console.log(`====================================================`);

  if (twilioClient) {
    try {
      const res = await twilioClient.messages.create({
        from: fromWhatsApp,
        to: toWhatsApp,
        body: text
      });
      console.log(`[Twilio] WhatsApp message delivered (SID: ${res.sid})`);
      return true;
    } catch (err) {
      console.warn(`[Twilio] WhatsApp send notice: ${err.message}`);
      return false;
    }
  }
  return false;
}

// In-memory OTP storage: accountKey -> { otp, expiresAt, mobile }
const otpStore = new Map();

// 1. GET /api/auth/config — Public configuration (Safe Farmer Accounts with Name & WhatsApp Number)
app.get('/api/auth/config', (req, res) => {
  const data = loadUsersData();
  const safeUsers = (data.users || []).map((u, idx) => ({
    id: idx,
    name: u.name,
    mobile: u.mobile || '9371525696',
    email: u.email || ''
  }));
  res.json({
    success: true,
    isConfigured: Boolean(data.isConfigured && data.users && data.users.length > 0),
    pinVersion: data.pinVersion || 1,
    pinUpdatedAt: data.pinUpdatedAt || 0,
    users: safeUsers
  });
});

// 2. POST /api/auth/register-initial — Initial One-Time Setup for Farmer Account(s)
app.post('/api/auth/register-initial', (req, res) => {
  try {
    const { user1, user2, pin, recoveryPin } = req.body;
    if (!user1 || !user1.name || !user1.mobile) {
      return res.status(400).json({ success: false, error: 'Please provide Farmer Name and WhatsApp Mobile Number.' });
    }

    const mob1 = String(user1.mobile).replace(/\D/g, '');
    const userPin = String(pin || user1.password || recoveryPin || '1234').trim();

    const users = [
      {
        name: (user1.name || 'Farmer').trim(),
        mobile: mob1,
        email: (user1.email || '').trim().toLowerCase(),
        passwordHash: hashPassword(userPin)
      }
    ];

    if (user2 && user2.mobile) {
      const mob2 = String(user2.mobile).replace(/\D/g, '');
      users.push({
        name: (user2.name || 'Family Member').trim(),
        mobile: mob2,
        email: (user2.email || '').trim().toLowerCase(),
        passwordHash: hashPassword(user2.password || userPin)
      });
    }

    const newUserData = {
      isConfigured: true,
      pinVersion: 1,
      pinUpdatedAt: Date.now(),
      recoveryPin: String(recoveryPin || userPin || '1234').trim(),
      users
    };

    saveUsersData(newUserData);
    console.log(`[Auth] Farm Registered: ${users.map(u => `${u.name} (${u.mobile})`).join(', ')}`);
    res.json({ success: true, message: 'Farm account registered successfully', pinVersion: 1 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/auth/login — Authenticate against authorized farmer accounts with PIN / Password
app.post('/api/auth/login', (req, res) => {
  try {
    const { identifier, password, pin } = req.body;
    const inputPwd = String(password || pin || '').trim();

    if (!identifier || !inputPwd) {
      return res.status(400).json({ success: false, error: 'Please enter your Mobile Number and Security PIN.' });
    }

    const cleanId = String(identifier).trim().toLowerCase();
    const data = loadUsersData();
    const user = (data.users || []).find(u => 
      String(u.name).toLowerCase() === cleanId || 
      String(u.mobile) === cleanId.replace(/\D/g, '') ||
      (u.email && String(u.email).toLowerCase() === cleanId)
    );

    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized farmer account. Number not registered.' });
    }

    const inputHash = hashPassword(inputPwd);
    const masterPin = String(data.recoveryPin || '1234').trim();
    const isMasterPin = inputPwd === masterPin;
    const isPasswordMatch = user.passwordHash ? user.passwordHash === inputHash : false;

    if (!isPasswordMatch && !isMasterPin) {
      return res.status(401).json({ success: false, error: 'Incorrect 4-digit PIN / Password. Please try again.' });
    }

    const token = crypto.randomBytes(16).toString('hex');
    console.log(`[Auth] User authenticated successfully: ${user.name} (${user.mobile})`);
    
    res.json({
      success: true,
      user: {
        name: user.name,
        mobile: user.mobile,
        email: user.email
      },
      pinVersion: data.pinVersion || 1,
      token
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/auth/send-otp — Generate and send 6-digit OTP to Farmer's WhatsApp
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ success: false, error: 'Please select a farmer account.' });
    }

    const cleanId = String(identifier).trim().toLowerCase();
    const data = loadUsersData();
    const user = (data.users || []).find(u => 
      String(u.name).toLowerCase() === cleanId || 
      String(u.mobile) === cleanId.replace(/\D/g, '') ||
      (u.email && String(u.email).toLowerCase() === cleanId)
    );

    if (!user) {
      return res.status(404).json({ success: false, error: 'Account not found in authorized farm users.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    const key = String(user.mobile || user.name).toLowerCase();
    otpStore.set(key, { otp, expiresAt, mobile: user.mobile });

    console.log(`====================================================`);
    console.log(`🔑 [WHATSAPP OTP GENERATED] For: ${user.name} (${user.mobile})`);
    console.log(`👉 6-Digit OTP: ${otp} (Valid for 10 minutes)`);
    console.log(`====================================================`);

    const whatsAppMessage = `🌾 *KisanGuard Smart Farm Security*\n\nHello *${user.name}*,\nYour 6-digit password reset OTP is:\n👉 *${otp}*\n\n(This code is valid for 10 minutes. Do not share with anyone.)`;

    const sent = await sendWhatsAppMessage(user.mobile, whatsAppMessage);

    res.json({
      success: true,
      mobile: user.mobile,
      formattedMobile: `+91 ${user.mobile}`,
      userName: user.name,
      message: `6-digit OTP sent to WhatsApp number: +91 ${user.mobile}`,
      devOtp: otp,
      whatsAppSent: sent
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. POST /api/auth/verify-otp-reset — Verify WhatsApp OTP & Reset Password
app.post('/api/auth/verify-otp-reset', (req, res) => {
  try {
    const { identifier, otp, recoveryPin, newPassword } = req.body;
    if (!identifier || !newPassword) {
      return res.status(400).json({ success: false, error: 'Please provide account and new password.' });
    }

    if (String(newPassword).length < 4) {
      return res.status(400).json({ success: false, error: 'Password must be at least 4 characters long.' });
    }

    const cleanId = String(identifier).trim().toLowerCase();
    const data = loadUsersData();
    const userIdx = (data.users || []).findIndex(u => 
      String(u.name).toLowerCase() === cleanId || 
      String(u.mobile) === cleanId.replace(/\D/g, '') ||
      (u.email && String(u.email).toLowerCase() === cleanId)
    );

    if (userIdx === -1) {
      return res.status(404).json({ success: false, error: 'Authorized farmer account not found.' });
    }

    const user = data.users[userIdx];
    let isAuthorized = false;

    const key = String(user.mobile || user.name).toLowerCase();
    const storedOtp = otpStore.get(key);

    if (otp && storedOtp) {
      if (Date.now() <= storedOtp.expiresAt && String(storedOtp.otp).trim() === String(otp).trim()) {
        isAuthorized = true;
        otpStore.delete(key);
      }
    }

    // Secondary master backup: Farm Recovery PIN
    const masterPin = String(data.recoveryPin || '1234').trim();
    if (recoveryPin && String(recoveryPin).trim() === masterPin) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return res.status(401).json({ success: false, error: 'Invalid or expired WhatsApp OTP / Recovery PIN.' });
    }

    const newHash = hashPassword(newPassword);
    data.users[userIdx].passwordHash = newHash;
    data.recoveryPin = String(newPassword).trim();
    data.pinVersion = (data.pinVersion || 1) + 1;
    data.pinUpdatedAt = Date.now();
    saveUsersData(data);
    console.log(`[Auth] PIN updated for farm. New pinVersion: ${data.pinVersion}`);

    res.json({ success: true, message: 'PIN updated successfully. All other devices will now require the new PIN.', pinVersion: data.pinVersion });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. POST /api/auth/update-accounts — Update authorized farmer names, mobile numbers and Security PIN
app.post('/api/auth/update-accounts', (req, res) => {
  try {
    const { user1, user2, recoveryPin } = req.body;
    const data = loadUsersData();

    if (!data.users || !Array.isArray(data.users)) {
      data.users = [];
    }

    if (user1 && (user1.name || user1.mobile)) {
      if (!data.users[0]) data.users[0] = { name: '', mobile: '', email: '', passwordHash: '' };
      if (user1.name !== undefined) data.users[0].name = String(user1.name).trim();
      if (user1.mobile !== undefined) data.users[0].mobile = String(user1.mobile).replace(/\D/g, '');
    }

    if (user2 && (user2.name || user2.mobile)) {
      if (!data.users[1]) data.users[1] = { name: '', mobile: '', email: '', passwordHash: '' };
      if (user2.name !== undefined) data.users[1].name = String(user2.name).trim();
      if (user2.mobile !== undefined) data.users[1].mobile = String(user2.mobile).replace(/\D/g, '');
    }

    let pinChanged = false;
    if (recoveryPin && String(recoveryPin).trim().length >= 4) {
      const trimmedPin = String(recoveryPin).trim();
      if (trimmedPin !== String(data.recoveryPin || '')) {
        data.recoveryPin = trimmedPin;
        const newHash = hashPassword(trimmedPin);
        if (data.users && data.users.length > 0) {
          data.users.forEach(u => { u.passwordHash = newHash; });
        }
        data.pinVersion = (data.pinVersion || 1) + 1;
        data.pinUpdatedAt = Date.now();
        pinChanged = true;
        console.log(`[Auth] Farm PIN changed to new code! New pinVersion: ${data.pinVersion}`);
      }
    }

    data.isConfigured = data.users.length > 0;
    saveUsersData(data);
    console.log(`[Auth] Farm accounts updated successfully`);

    res.json({
      success: true,
      message: pinChanged 
        ? 'PIN & settings updated! Other devices will now require the new PIN.'
        : 'Settings updated successfully',
      pinVersion: data.pinVersion || 1,
      pinChanged
    });
  } catch (err) {
    console.error('[Auth] Error in update-accounts:', err);
    res.status(500).json({ success: false, error: err.message });
  }
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

