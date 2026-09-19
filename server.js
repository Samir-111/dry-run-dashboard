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

// ─── ESP32 Direct Communication Endpoints ─────────────────────────────────

// ESP32 sends telemetry JSON here every 1.5 seconds
app.post('/api/device/telemetry', (req, res) => {
  const data = req.body || {};
  const now = Date.now();
  
  deviceStore.lastSeen = now;
  deviceStore.wifiStatus = 'CONNECTED';

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
  // Device is online if it synced within last 12 seconds
  const online = (now - deviceStore.lastSeen) < 12000;

  res.json({
    online,
    relay: deviceStore.relay,
    pumpStatus: deviceStore.pumpStatus,
    waterStatus: deviceStore.waterStatus,
    waterRaw: deviceStore.waterRaw,
    protectionStatus: deviceStore.protectionStatus,
    runtime: deviceStore.runtime,
    fault: deviceStore.fault,
    countdown: deviceStore.countdown,
    wifiStatus: online ? 'CONNECTED' : 'DISCONNECTED',
    relayStatus: deviceStore.relayStatus,
    waterThreshold: deviceStore.waterThreshold,
    systemState: deviceStore.systemState,
    device: {
      mode: 'DIRECT_IOT_SERVER',
      cachedAt: new Date().toISOString(),
      lastSeenSecondsAgo: Math.round((now - deviceStore.lastSeen) / 1000)
    }
  });
});

// Farmer's pump on/off request from Dashboard
app.post('/api/motor', (req, res) => {
  try {
    const targetState = req.body.on ? 1 : 0;
    pendingCommands.relay = targetState;
    // Optimistic UI update
    deviceStore.relay = Boolean(req.body.on);
    if (!req.body.on) {
      deviceStore.pumpStatus = 'OFF';
      if (deviceStore.systemState === 'RUNNING' || deviceStore.systemState === 'STARTING') {
        deviceStore.systemState = 'OFF';
      }
    } else {
      deviceStore.pumpStatus = 'STARTING';
      deviceStore.systemState = 'STARTING';
    }
    console.log(`[Dashboard] Pump command queued: ${targetState ? 'START' : 'STOP'}`);
    res.json({ success: true, on: req.body.on });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  console.log(`====================================================`);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
