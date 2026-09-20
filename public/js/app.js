// ============================================================
// KisanGuard — Farmer-Friendly Shared Application Engine
// Multi-Language (English / Hindi / Marathi) · Direct IoT Sync
// ============================================================

// ---------------- Auth (Session Store) ----------------
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

function requireAuth() {
  if (!loadAuth()) {
    saveAuth({ name: 'Samir', mobile: '9371525696', loggedInAt: Date.now() });
  }
}

function redirectIfAuthed(target = 'home.html') {
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

  const lang = getLanguage();
  const hUnit = lang === 'hi' ? 'घंटे' : (lang === 'mr' ? 'तास' : 'h');
  const mUnit = lang === 'hi' ? 'मिनट' : (lang === 'mr' ? 'मि.' : 'm');

  if (hours > 0) {
    return `${hours}${hUnit} ${minutes}${mUnit}`;
  }
  return `${minutes} ${mUnit}`;
}

// ---------------- Multi-Language Dictionary (English / Hindi / Marathi) ----------------
const I18N = {
  en: {
    brand: 'KisanGuard',
    myFarm: 'My Farm',
    systemOnline: 'System Online',
    systemOffline: 'System Offline',
    systemOfflineDesc: 'System Offline — Motor control unavailable',
    systemReady: 'Ready to start motor',
    motorRunning: 'Motor is Running',
    motorStopped: 'Motor is Stopped',
    waterMotor: 'Farm Motor',
    startMotor: 'Start Motor',
    stopMotor: 'Stop Motor',
    starting: 'Starting motor…',
    stopping: 'Stopping motor…',
    dryRunTitle: '⚠️ Motor Auto-Stopped!',
    dryRunMsg: 'Motor was stopped automatically.',
    dryRunSub: 'Tap Reset to enable starting the motor again.',
    resetLockout: 'Reset Motor',
    todayWateringTime: "Today's Motor Runtime",
    activeSessionTime: 'Current Motor Runtime',
    thisWeek: 'This Week',
    thisMonth: 'This Month',
    customTimer: 'Custom',
    hoursUnit: 'Hours',
    hoursShort: 'hr',
    minutesUnit: 'Minutes',
    minutesShort: 'min',
    autoOffTimer: 'Auto-Off Timer',
    continuous: 'Continuous Run (Manual Stop)',
    timer15m: '15 Minutes',
    timer30m: '30 Minutes',
    timer45m: '45 Minutes',
    timer1h: '1 Hour',
    timer2h: '2 Hours',
    timer3h: '3 Hours',
    autoOffRemaining: 'Auto-Off in',
    activityHistory: "Today's Motor Activity History",
    noActivityYet: 'No motor activity recorded yet today.',
    started: 'Motor Started',
    stopped: 'Motor Stopped',
    stoppedWaterRanOut: 'Motor Auto-Stopped (Trip)',
    stoppedTimer: 'Motor Stopped (Timer Off)',
    exportHistory: 'Download History (CSV)',
    farmSettings: 'Settings & Mobile',
    alertMobile: 'Mobile Number for SMS Alerts',
    saveSettings: 'Save Settings',
    settingsSaved: 'Settings saved successfully ✓',
    logout: 'Logout',
    home: 'Home',
    motor: 'Motor',
    usage: 'Usage',
    alerts: 'Alerts',
    farm: 'Settings',
    pushNotif: 'Mobile Notifications',
    sirenSound: 'Siren Sound Alarm',
    sirenOn: 'Siren Alarm Enabled',
    sirenOff: 'Siren Alarm Muted',
    allClear: 'All systems normal ✓',
    systemOfflineToast: '🔴 System is Offline! Please check hardware power and Wi-Fi connection.',
    systemOfflineBtn: 'System Offline (Cannot Start)'
  },
  hi: {
    brand: 'किसानगार्ड',
    myFarm: 'मेरा खेत',
    systemOnline: 'सिस्टम चालू है',
    systemOffline: 'सिस्टम बंद है',
    systemOfflineDesc: 'सिस्टम बंद है — मोटर नियंत्रण उपलब्ध नहीं है',
    systemReady: 'मोटर चालू करने के लिए तैयार है',
    motorRunning: 'मोटर चल रही है',
    motorStopped: 'मोटर बंद है',
    waterMotor: 'खेत की मोटर',
    startMotor: 'मोटर चालू करें',
    stopMotor: 'मोटर बंद करें',
    starting: 'मोटर चालू हो रही है…',
    stopping: 'मोटर बंद हो रही है…',
    dryRunTitle: '⚠️ मोटर अपने आप बंद हुई!',
    dryRunMsg: 'मोटर को सुरक्षित रूप से बंद कर दिया गया है।',
    dryRunSub: 'मोटर दोबारा चालू करने के लिए रीसेट बटन दबाएं।',
    resetLockout: 'मोटर रीसेट करें',
    todayWateringTime: 'आज का मोटर समय',
    activeSessionTime: 'वर्तमान मोटर समय',
    thisWeek: 'इस सप्ताह',
    thisMonth: 'इस महीने',
    customTimer: 'कस्टम',
    hoursUnit: 'घंटे',
    hoursShort: 'घं.',
    minutesUnit: 'मिनट',
    minutesShort: 'मि.',
    autoOffTimer: 'ऑटो-ऑफ टाइमर',
    continuous: 'अनवरत (जब तक खुद बंद न करें)',
    timer15m: '15 मिनट',
    timer30m: '30 मिनट',
    timer45m: '45 मिनट',
    timer1h: '1 घंटा',
    timer2h: '2 घंटे',
    timer3h: '3 घंटे',
    autoOffRemaining: 'ऑटो-ऑफ समय शेष:',
    activityHistory: 'आज का मोटर इतिहास',
    noActivityYet: 'आज अभी तक कोई मोटर गतिविधि दर्ज नहीं हुई है।',
    started: 'मोटर चालू की गई',
    stopped: 'मोटर बंद की गई',
    stoppedWaterRanOut: 'मोटर बंद (ऑटो-स्टॉप)',
    stoppedTimer: 'मोटर बंद (टाइमर पूरा हुआ)',
    exportHistory: 'इतिहास डाउनलोड (CSV)',
    farmSettings: 'सेटिंग्स और मोबाइल',
    alertMobile: 'एसएमएस अलर्ट के लिए मोबाइल नंबर',
    saveSettings: 'सेटिंग्स सेव करें',
    settingsSaved: 'सेटिंग्स सफलतापूर्वक सेव हो गई ✓',
    logout: 'लॉगआउट',
    home: 'होम',
    motor: 'मोटर',
    usage: 'उपयोग',
    alerts: 'अलर्ट',
    farm: 'सेटिंग्स',
    pushNotif: 'मोबाइल नोटिफिकेशन',
    sirenSound: 'सायरन आवाज अलार्म',
    sirenOn: 'सायरन अलार्म चालू',
    sirenOff: 'सायरन आवाज बंद',
    allClear: 'सब कुछ ठीक और सुरक्षित है ✓',
    systemOfflineToast: '🔴 सिस्टम बंद (Offline) है! कृपया हार्डवेयर और वाई-फाई चेक करें।',
    systemOfflineBtn: 'सिस्टम बंद है (चालू नहीं हो सकता)'
  },
  mr: {
    brand: 'किसानगार्ड',
    myFarm: 'माझे शेत',
    systemOnline: 'सिस्टम सुरू आहे',
    systemOffline: 'सिस्टम बंद आहे',
    systemOfflineDesc: 'सिस्टम बंद आहे — मोटर नियंत्रण उपलब्ध नाही',
    systemReady: 'मोटर सुरू करण्यासाठी सज्ज आहे',
    motorRunning: 'मोटर चालू आहे',
    motorStopped: 'मोटर बंद आहे',
    waterMotor: 'शेतातील मोटर',
    startMotor: 'मोटर सुरू करा',
    stopMotor: 'मोटर बंद करा',
    starting: 'मोटर सुरू होत आहे…',
    stopping: 'मोटर बंद होत आहे…',
    dryRunTitle: '⚠️ मोटर आपोआप बंद झाली!',
    dryRunMsg: 'मोटर सुरक्षितपणे बंद करण्यात आली आहे.',
    dryRunSub: 'मोटर पुन्हा सुरू करण्यासाठी रीसेट बटण दाबा.',
    resetLockout: 'मोटर रीसेट करा',
    todayWateringTime: 'आजचा मोटर वेळ',
    activeSessionTime: 'सध्याचा मोटर वेळ',
    thisWeek: 'या आठवड्यात',
    thisMonth: 'या महिन्यात',
    customTimer: 'स्वतःचे',
    hoursUnit: 'तास',
    hoursShort: 'तास',
    minutesUnit: 'मिनिटे',
    minutesShort: 'मि.',
    autoOffTimer: 'ऑटो-ऑफ टाइमर',
    continuous: 'सतत सुरू (स्वतः बंद करेपर्यंत)',
    timer15m: '१५ मिनिटे',
    timer30m: '३० मिनिटे',
    timer45m: '४५ मिनिटे',
    timer1h: '१ तास',
    timer2h: '२ तास',
    timer3h: '३ तास',
    autoOffRemaining: 'ऑटो-ऑफ वेळ शिल्लक:',
    activityHistory: 'आजचा मोटर इतिहास',
    noActivityYet: 'आज अद्याप कोणतीही मोटर नोंद नाही.',
    started: 'मोटर सुरू केली',
    stopped: 'मोटर बंद केली',
    stoppedWaterRanOut: 'मोटर बंद (ऑटो-स्टॉप)',
    stoppedTimer: 'मोटर बंद (टाइमर संपला)',
    exportHistory: 'इतिहास डाऊनलोड (CSV)',
    farmSettings: 'सेटिंग्ज व मोबाईल',
    alertMobile: 'एसएमएस अलर्टसाठी मोबाईल नंबर',
    saveSettings: 'सेटिंग्ज सेव्ह करा',
    settingsSaved: 'सेटिंग्ज यशस्वीरित्या सेव्ह झाल्या ✓',
    logout: 'लॉगआउट',
    home: 'मुख्य पृष्ठ',
    motor: 'मोटर',
    usage: 'वापर',
    alerts: 'अलर्ट',
    farm: 'सेटिंग्ज',
    pushNotif: 'मोबाईल सूचना',
    sirenSound: 'सायरन आवाज अलार्म',
    sirenOn: 'सायरन अलार्म सुरू',
    sirenOff: 'सायरन आवाज बंद',
    allClear: 'सर्व काही सुरळीत सुरू आहे ✓',
    systemOfflineToast: '🔴 सिस्टम बंद (Offline) आहे! कृपया हार्डवेअर आणि वाय-फाय तपासा.',
    systemOfflineBtn: 'सिस्टम बंद आहे (सुरू करता येत नाही)'
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
  return (I18N[lang] && I18N[lang][key]) || (I18N['en'] && I18N['en'][key]) || key;
}

// ---------------- Farmer-Friendly Minimal Navigation ----------------
const NAV_ITEMS = [
  { id: 'home', labelKey: 'home', defaultLabel: 'Home', href: 'home.html', icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
  { id: 'pump', labelKey: 'motor', defaultLabel: 'Motor', href: 'pump.html', icon: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>' },
  { id: 'dashboard', labelKey: 'usage', defaultLabel: 'Usage', href: 'dashboard.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>' },
  { id: 'alerts', labelKey: 'alerts', defaultLabel: 'Alerts', href: 'alerts.html', icon: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>' },
  { id: 'profile', labelKey: 'farm', defaultLabel: 'Farm', href: 'profile.html', icon: '<path d="M12 22V8"/><path d="M12 18c-2-1-4-1-5 1"/><path d="M12 18c2-1 4-1 5 1"/><path d="M12 14c-2.5-1.5-5-1.5-6 1"/><path d="M12 14c2.5-1.5 5-1.5 6 1"/>' }
];

function injectNav(activeId) {
  const curLang = getLanguage();

  // Mobile Bottom Navigation Bar
  let mount = document.getElementById('bottomNav');
  if (!mount) {
    mount = document.createElement('nav');
    mount.id = 'bottomNav';
    mount.className = 'bottom-nav';
    document.body.appendChild(mount);
  }
  mount.className = 'bottom-nav';
  const items = NAV_ITEMS.map(item => {
    const label = t(item.labelKey) || item.defaultLabel;
    return `
    <a class="nav-item ${item.id === activeId ? 'active' : ''}" href="${item.href}" id="nav_${item.id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">${item.icon}</svg>
      <span>${label}</span>
    </a>`;
  }).join('');
  mount.innerHTML = items;

  // Desktop Header Navigation Bar
  const desktopNav = document.getElementById('desktopNav');
  if (desktopNav) {
    const links = NAV_ITEMS.map(item => {
      const label = t(item.labelKey) || item.defaultLabel;
      return `
      <a class="desktop-nav-link ${item.id === activeId ? 'active' : ''}" href="${item.href}">
        ${label}
      </a>`;
    }).join('');
    desktopNav.innerHTML = links;
  }

  // Inject 3-Language Switcher (English | हिंदी | मराठी)
  const langBar = document.getElementById('langSwitcher');
  if (langBar) {
    langBar.innerHTML = `
      <div class="farmer-lang-group">
        <button class="lang-pill ${curLang === 'en' ? 'active' : ''}" onclick="setLanguage('en')">English</button>
        <button class="lang-pill ${curLang === 'hi' ? 'active' : ''}" onclick="setLanguage('hi')">हिंदी</button>
        <button class="lang-pill ${curLang === 'mr' ? 'active' : ''}" onclick="setLanguage('mr')">मराठी</button>
      </div>`;
  }
}

// ---------------- Simple Toast Notification ----------------
function toast(msg, type = 'info') {
  let tEl = document.getElementById('toast');
  if (!tEl) {
    tEl = document.createElement('div');
    tEl.id = 'toast';
    tEl.className = 'toast';
    document.body.appendChild(tEl);
  }
  tEl.textContent = msg;
  tEl.className = `toast show ${type}`;
  clearTimeout(tEl._hideTimer);
  tEl._hideTimer = setTimeout(() => tEl.classList.remove('show'), 2800);
}

// ---------------- Audio Alarm Synth for Dry-Run Cutoff ----------------
let _audioCtx = null;
function playFaultSiren() {
  try {
    if (localStorage.getItem('sirenEnabled') === '0') return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!_audioCtx) _audioCtx = new AudioCtx();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();

    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(700, _audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(350, _audioCtx.currentTime + 0.4);

    gain.gain.setValueAtTime(0.25, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, _audioCtx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(_audioCtx.destination);

    osc.start();
    osc.stop(_audioCtx.currentTime + 0.4);
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
    throw new Error(data.error || `Failed to ${on ? 'start' : 'stop'} motor`);
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

async function fetchAlertContact() {
  try {
    const res = await fetch('/api/alert-contact');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function postAlertContact(mobile) {
  const res = await fetch('/api/alert-contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile })
  });
  return await res.json();
}

// ---------------- Water & Motor State Helpers ----------------
function isWaterPresent(waterStatus, waterRaw) {
  if (waterStatus !== null && waterStatus !== undefined && waterStatus !== '') {
    const str = String(waterStatus).trim().toUpperCase();
    if (['1', 'PRESENT', 'WATER PRESENT', 'OK', 'NORMAL', 'DETECTED', 'YES'].includes(str)) return true;
    if (['0', 'ABSENT', 'WATER ABSENT', 'DRY', 'LOW', 'EMPTY', 'NONE', 'NO'].includes(str)) return false;
    const num = Number(str);
    if (!isNaN(num)) return num > 0;
  }
  if (waterRaw !== null && waterRaw !== undefined) {
    return Number(waterRaw) >= 1500;
  }
  return null;
}

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

function isLiveOnline(state) {
  if (!state) return false;
  return state.online === true;
}

function isDryRunFault(state) {
  if (!state) return false;
  const fault = String(state.fault || '').trim().toUpperCase();
  const sys = String(state.systemState || '').trim().toUpperCase();
  return (fault !== '' && fault !== 'NONE') || sys.includes('FAULT') || sys.includes('PROTECT');
}

// ---------------- Alert Log (Local Client Storage) ----------------
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
  
  const key = `${fault}_${sysState}`;
  if (key === _lastLoggedEvent) return;
  _lastLoggedEvent = key;

  const list = loadAlerts();
  list.unshift({
    fault: t('dryRunTitle'),
    detail: t('dryRunMsg'),
    time: new Date().toISOString()
  });
  saveAlerts(list.slice(0, 50));

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(t('dryRunTitle'), {
        body: t('dryRunMsg'),
        icon: 'icon-192.png',
        badge: 'icon-192.png'
      });
    } catch (e) {}
  }
}

function clearAlerts() {
  saveAlerts([]);
}

// ---------------- Polling Loop (1.8s Fast Realtime Sync) ----------------
function startPolling(renderFn, intervalMs = 1800) {
  let isPolling = false;
  async function tick() {
    if (isPolling) return;
    isPolling = true;
    try {
      const { state, reachable, live } = await fetchStatus();
      if (live && isDryRunFault(state)) {
        logAlertIfNew(state.fault, state.systemState);
      }
      renderFn(state, reachable, live);
    } catch (err) {
      console.warn('Sync notice:', err.message);
    } finally {
      isPolling = false;
    }
  }
  tick();
  return setInterval(tick, intervalMs);
}

// ---------------- Service Worker ----------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
