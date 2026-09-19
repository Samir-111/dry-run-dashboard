/************************************************************
 * REAL-TIME BOREWELL PUMP PROTECTION AND CONTROL SYSTEM
 * 
 * 100% Exact Protection Logic — Direct IoT Server (Blynk Bypassed)
 *
 * MCU:
 *   DOIT ESP32 DevKit V1 - 30 Pin
 *
 * Hardware:
 *   Relay       -> GPIO 4 (Active LOW)
 *   Water ADC   -> GPIO 36 / VP (10K Pulldown to GND)
 *
 * Exact Logic:
 *   ADC >= 1500 -> WATER PRESENT
 *   ADC <  1500 -> WATER ABSENT
 *
 * Timers:
 *   Startup bypass        = 90 seconds
 *   Dry-run verification = 5 seconds
 *   User response window  = 30 seconds
 *   Water probe delay     = 60 seconds (1 minute initial probe wait)
 ************************************************************/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

/******************** WIFI CONFIGURATION ********************/
char ssid[] = "samir";
char pass[] = "987654321";

/******************** LIVE SERVER URL ***********************/
// 👉 When deployed on Render: "https://your-dashboard.onrender.com"
// 👉 For local/tunnel testing: "http://192.168.101.191:8081" (or your deployed URL)
const char* SERVER_URL = "http://192.168.101.191:8081";

/******************** PIN CONFIGURATION **********************/
const int RELAY_PIN = 4;
const int WATER_SENSOR_PIN = 36;
const bool RELAY_ACTIVE_LOW = true;

/******************** WATER SENSOR ***************************/
int waterThreshold = 1500;

/******************** TIMING CONFIGURATION *******************/
const unsigned long STARTUP_BYPASS_TIME = 90000UL;  // 90 sec
const unsigned long DRY_VERIFY_TIME    = 5000UL;   // 5 sec
const unsigned long USER_RESPONSE_TIME = 30000UL;  // 30 sec
const unsigned long WATER_PROBE_DELAY  = 60000UL;  // 1 minute

bool waitingForWaterProbe = false;

/******************** SYSTEM STATES **************************/
enum PumpState {
  SYSTEM_OFF,
  STARTING,
  RUNNING,
  WATER_WARNING,
  FAULT_LOCK
};

PumpState currentState = SYSTEM_OFF;

/******************** GLOBAL VARIABLES ***********************/
int waterADC = 0;
bool waterPresent = false;
bool dryVerificationStarted = false;
bool warningNotificationSent = false;
bool shutdownNotificationSent = false;
bool waterRestoredNotificationSent = false;

unsigned long startupStartTime = 0;
unsigned long dryVerificationStartTime = 0;
unsigned long waterProbeStartTime = 0;
unsigned long responseStartTime = 0;
unsigned long pumpStartTime = 0;
unsigned long totalRuntime = 0;

int countdownSeconds = 0;
String protectionStatusText = "NORMAL";
String faultText = "NONE";
String runtimeText = "00:00:00";

/******************** HELPER FUNCTIONS ***********************/
void pumpRelayOn() {
  if (RELAY_ACTIVE_LOW) digitalWrite(RELAY_PIN, LOW);
  else digitalWrite(RELAY_PIN, HIGH);
  Serial.println("PUMP RELAY GPIO4 -> ON (PUMP ON)");
}

void pumpRelayOff() {
  if (RELAY_ACTIVE_LOW) digitalWrite(RELAY_PIN, HIGH);
  else digitalWrite(RELAY_PIN, LOW);
  Serial.println("PUMP RELAY GPIO4 -> OFF (PUMP OFF)");
}

bool isPumpRelayOn() {
  if (RELAY_ACTIVE_LOW) return digitalRead(RELAY_PIN) == LOW;
  else return digitalRead(RELAY_PIN) == HIGH;
}

/*************************************************************
 * READ WATER SENSOR
 *************************************************************/
void readWaterSensor() {
  waterADC = analogRead(WATER_SENSOR_PIN);
  waterPresent = (waterADC >= waterThreshold);
}

/*************************************************************
 * START PUMP
 *************************************************************/
void startPump() {
  Serial.println("\n=================================");
  Serial.println("START PUMP COMMAND RECEIVED");
  Serial.println("=================================");

  pumpRelayOn();
  startupStartTime = millis();
  pumpStartTime = millis();
  dryVerificationStarted = false;
  waterProbeStartTime = millis();
  waitingForWaterProbe = true;

  warningNotificationSent = false;
  shutdownNotificationSent = false;
  waterRestoredNotificationSent = false;

  currentState = STARTING;
  protectionStatusText = "90 SEC STARTUP BYPASS";
  faultText = "NONE";
  countdownSeconds = STARTUP_BYPASS_TIME / 1000;
  Serial.println("Pump STARTING...");
}

/*************************************************************
 * STOP PUMP
 *************************************************************/
void stopPump(const char* reason) {
  Serial.println("\n=================================");
  Serial.println("STOPPING PUMP");
  Serial.println(reason);
  Serial.println("=================================");

  pumpRelayOff();

  if (pumpStartTime > 0) {
    totalRuntime += (millis() - pumpStartTime);
  }
  pumpStartTime = 0;

  dryVerificationStarted = false;
  waitingForWaterProbe = false;
  currentState = SYSTEM_OFF;
  protectionStatusText = "NORMAL";
  faultText = "NONE";
  countdownSeconds = 0;
}

/*************************************************************
 * DRY-RUN WARNING
 *************************************************************/
void startDryRunWarning() {
  Serial.println("\n=================================");
  Serial.println("DRY-RUN WARNING");
  Serial.println("=================================");

  currentState = WATER_WARNING;
  responseStartTime = millis();
  warningNotificationSent = true;
  protectionStatusText = "DRY-RUN WARNING";
  faultText = "Water not detected";
  countdownSeconds = USER_RESPONSE_TIME / 1000;
}

/*************************************************************
 * DRY-RUN PROTECTION SHUTDOWN
 *************************************************************/
void activateDryRunProtection() {
  Serial.println("\n#################################");
  Serial.println("DRY-RUN PROTECTION ACTIVATED");
  Serial.println("#################################");

  pumpRelayOff();

  if (pumpStartTime > 0) {
    totalRuntime += (millis() - pumpStartTime);
  }
  pumpStartTime = 0;

  currentState = FAULT_LOCK;
  dryVerificationStarted = false;
  shutdownNotificationSent = true;
  protectionStatusText = "DRY-RUN PROTECTION";
  faultText = "DRY-RUN FAULT";
  countdownSeconds = 0;
}

/*************************************************************
 * STARTUP BYPASS HANDLER
 *************************************************************/
void handleStartup() {
  unsigned long elapsed = millis() - startupStartTime;
  unsigned long remaining = (elapsed < STARTUP_BYPASS_TIME) ? (STARTUP_BYPASS_TIME - elapsed) : 0;
  countdownSeconds = remaining / 1000;
  protectionStatusText = "STARTUP BYPASS";

  if (elapsed >= STARTUP_BYPASS_TIME) {
    Serial.println("\n90 SECOND STARTUP BYPASS COMPLETED");
    readWaterSensor();

    if (waterPresent) {
      currentState = RUNNING;
      protectionStatusText = "NORMAL";
      countdownSeconds = 0;
      Serial.println("Water detected. Pump RUNNING.");
    } else {
      dryVerificationStarted = true;
      dryVerificationStartTime = millis();
      Serial.println("Water absent after startup. Starting 5-second verification.");
    }
  }
}

/*************************************************************
 * RUNNING STATE HANDLER
 *************************************************************/
void handleRunning() {
  if (waterPresent) {
    dryVerificationStarted = false;
    protectionStatusText = "NORMAL";
    countdownSeconds = 0;
    return;
  }

  if (!dryVerificationStarted) {
    dryVerificationStarted = true;
    dryVerificationStartTime = millis();
    Serial.println("\nLOW WATER DETECTED. Starting 5-second verification...");
  }

  unsigned long verificationElapsed = millis() - dryVerificationStartTime;
  if (verificationElapsed >= DRY_VERIFY_TIME) {
    readWaterSensor();
    if (waterPresent) {
      dryVerificationStarted = false;
      Serial.println("Water returned during verification.");
      return;
    }
    if (!warningNotificationSent) {
      startDryRunWarning();
    }
  }
}

/*************************************************************
 * WATER WARNING STATE
 *************************************************************/
void handleWaterWarning() {
  if (waterPresent) {
    Serial.println("\nWATER RESTORED. Cancelling dry-run warning.");
    currentState = RUNNING;
    dryVerificationStarted = false;
    warningNotificationSent = false;
    protectionStatusText = "WATER RESTORED";
    faultText = "NONE";
    countdownSeconds = 0;
    return;
  }

  unsigned long elapsed = millis() - responseStartTime;
  if (elapsed < USER_RESPONSE_TIME) {
    unsigned long remaining = USER_RESPONSE_TIME - elapsed;
    countdownSeconds = remaining / 1000;
    protectionStatusText = "WAITING FOR RESPONSE";
    return;
  }

  if (!shutdownNotificationSent) {
    activateDryRunProtection();
  }
}

/*************************************************************
 * FAULT LOCK STATE
 *************************************************************/
void handleFaultLock() {
  pumpRelayOff();
  protectionStatusText = "FAULT LOCK";
  faultText = "DRY-RUN FAULT";
  countdownSeconds = 0;
}

/*************************************************************
 * RUNTIME UPDATE
 *************************************************************/
void updateRuntime() {
  unsigned long cur = totalRuntime;
  if (pumpStartTime > 0) cur += (millis() - pumpStartTime);

  unsigned long totalSec = cur / 1000;
  unsigned long h = totalSec / 3600;
  unsigned long m = (totalSec % 3600) / 60;
  unsigned long s = totalSec % 60;

  char buf[20];
  snprintf(buf, sizeof(buf), "%02lu:%02lu:%02lu", h, m, s);
  runtimeText = String(buf);
}

/*************************************************************
 * STATE MACHINE & SENSOR TASK
 *************************************************************/
void sensorTask() {
  if (waitingForWaterProbe) {
    unsigned long elapsed = millis() - waterProbeStartTime;
    if (elapsed < WATER_PROBE_DELAY) {
      updateRuntime();
      return;
    }
    waitingForWaterProbe = false;
    Serial.println("\n1 MINUTE WATER PROBE WAIT COMPLETE. CHECKING WATER LEVEL NOW");
    readWaterSensor();
    if (!waterPresent) {
      Serial.println("WATER NOT DETECTED AFTER 1 MINUTE. STOPPING PUMP");
      activateDryRunProtection();
      return;
    }
    Serial.println("WATER DETECTED AFTER 1 MINUTE. PUMP CONTINUES RUNNING.");
  }

  readWaterSensor();

  if (isPumpRelayOn() && !waterPresent && currentState == RUNNING) {
    activateDryRunProtection();
    return;
  }

  switch (currentState) {
    case SYSTEM_OFF:    pumpRelayOff(); break;
    case STARTING:      handleStartup(); break;
    case RUNNING:       handleRunning(); break;
    case WATER_WARNING: handleWaterWarning(); break;
    case FAULT_LOCK:    handleFaultLock(); break;
  }

  updateRuntime();
}

/*************************************************************
 * DIRECT SERVER SYNC (NO BLYNK)
 *************************************************************/
String getSystemStateString() {
  switch (currentState) {
    case SYSTEM_OFF:    return "OFF";
    case STARTING:      return "STARTING";
    case RUNNING:       return "RUNNING";
    case WATER_WARNING: return "WATER WARNING";
    case FAULT_LOCK:    return "FAULT LOCK";
    default:            return "IDLE";
  }
}

String getPumpStatusString() {
  switch (currentState) {
    case STARTING:   return "STARTING";
    case RUNNING:    return "RUNNING";
    case WATER_WARNING: return "WATER LOSS";
    case FAULT_LOCK: return "FAULT - PUMP OFF";
    default:         return "OFF";
  }
}

void syncWithServer() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/device/telemetry";

  if (url.startsWith("https://")) {
    WiFiClientSecure client;
    client.setInsecure();
    http.begin(client, url);
  } else {
    http.begin(url);
  }

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(3000);

  // Build Telemetry JSON matching exact pin format
  String json = "{";
  json += "\"relay\":" + String(isPumpRelayOn() ? 1 : 0) + ",";
  json += "\"pumpStatus\":\"" + getPumpStatusString() + "\",";
  json += "\"waterStatus\":\"" + String(waterPresent ? "PRESENT" : "ABSENT") + "\",";
  json += "\"waterRaw\":" + String(waterADC) + ",";
  json += "\"protectionStatus\":\"" + protectionStatusText + "\",";
  json += "\"runtime\":\"" + runtimeText + "\",";
  json += "\"fault\":\"" + faultText + "\",";
  json += "\"countdown\":" + String(countdownSeconds) + ",";
  json += "\"relayStatus\":" + String(isPumpRelayOn() ? 1 : 0) + ",";
  json += "\"waterThreshold\":" + String(waterThreshold) + ",";
  json += "\"systemState\":\"" + getSystemStateString() + "\",";
  json += "\"wifiStatus\":\"CONNECTED\"";
  json += "}";

  int code = http.POST(json);

  if (code == 200) {
    String resp = http.getString();

    // 1. Process Relay / Motor Command from Dashboard
    if (resp.indexOf("\"relay\":1") >= 0) {
      if (currentState != STARTING && currentState != RUNNING && currentState != WATER_WARNING) {
        if (currentState == FAULT_LOCK) {
          shutdownNotificationSent = false;
          warningNotificationSent = false;
          waterRestoredNotificationSent = false;
        }
        startPump();
      }
    } else if (resp.indexOf("\"relay\":0") >= 0) {
      if (currentState != SYSTEM_OFF) {
        stopPump("Pump stopped manually from Dashboard.");
      }
    }

    // 2. Process Reset Command
    if (resp.indexOf("\"reset\":true") >= 0) {
      stopPump("System Reset from Dashboard.");
      currentState = SYSTEM_OFF;
      protectionStatusText = "NORMAL";
      faultText = "NONE";
      countdownSeconds = 0;
    }

    // 3. Process Threshold Command
    int thIdx = resp.indexOf("\"threshold\":");
    if (thIdx >= 0) {
      int endIdx = resp.indexOf(",", thIdx);
      if (endIdx < 0) endIdx = resp.indexOf("}", thIdx);
      if (endIdx > thIdx) {
        String valStr = resp.substring(thIdx + 12, endIdx);
        valStr.trim();
        if (valStr != "null") {
          int newTh = valStr.toInt();
          if (newTh > 0) waterThreshold = newTh;
        }
      }
    }
  }

  http.end();
}

/*************************************************************
 * SETUP & MAIN LOOP
 *************************************************************/
unsigned long lastSensorTick = 0;
unsigned long lastSyncTick = 0;

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n=========================================");
  Serial.println("BOREWELL PUMP PROTECTION SYSTEM");
  Serial.println("ESP32 DIRECT IOT SERVER MODE (NO BLYNK)");
  Serial.println("=========================================");

  pinMode(RELAY_PIN, OUTPUT);
  pumpRelayOff();
  pinMode(WATER_SENSOR_PIN, INPUT);

  analogReadResolution(12);
  analogSetPinAttenuation(WATER_SENSOR_PIN, ADC_11db);
  readWaterSensor();

  Serial.println("Connecting to WiFi: " + String(ssid));
  WiFi.begin(ssid, pass);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(400);
    Serial.print(".");
    tries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi Connection Pending (will reconnect in loop)");
  }

  Serial.println("System Ready. Waiting for Dashboard commands.");
}

void loop() {
  unsigned long now = millis();

  // Run sensor and protection state machine every 100 ms
  if (now - lastSensorTick >= 100) {
    lastSensorTick = now;
    sensorTask();
  }

  // Sync telemetry and commands with live server every 1.5 seconds
  if (now - lastSyncTick >= 1500) {
    lastSyncTick = now;
    syncWithServer();
  }

  // Auto reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED && (now % 10000 < 50)) {
    WiFi.reconnect();
  }
}
