
/************************************************************
 * REAL-TIME BOREWELL PUMP PROTECTION AND CONTROL SYSTEM
 *
 * MCU:
 *   DOIT ESP32 DevKit V1 - 30 Pin
 *
 * Connectivity:
 *   Wi-Fi + Blynk IoT + SIM800L GSM
 *
 * Hardware:
 *   Relay       -> GPIO 4
 *   Water ADC   -> GPIO 36 / VP
 *   Probe 1     -> ESP32 3.3V
 *   Probe 2     -> GPIO 36
 *   Pulldown    -> 10K from GPIO36 to GND
 *   SIM800L RX  -> GPIO 16 (UART2)
 *   SIM800L TX  -> GPIO 17 (UART2)
 *
 * Logic:
 *   ADC >= 1500 -> WATER PRESENT
 *   ADC <  1500 -> WATER ABSENT
 *
 * Timers:
 *   Startup bypass       = 90 seconds
 *   Dry-run verification  = 5 seconds
 *   User response window  = 30 seconds
 *
 * GSM / SIM800L:
 *   UART2: RX=GPIO16, TX=GPIO17
 *   Baud: 9600
 *   SMS + Voice call on dry-run fault (one-shot per fault)
 ************************************************************/


/******************** BLYNK CONFIGURATION ********************/


#define BLYNK_PRINT Serial
#define BLYNK_TEMPLATE_ID "TMPL3p-CzNFT1"
#define BLYNK_TEMPLATE_NAME "Ashwin"
#define BLYNK_AUTH_TOKEN "vfKMBSGGDuAYWcTRiDTDRYW4KFeB8AKg"

#include <WiFi.h>
#include <BlynkSimpleEsp32.h>
#include <HardwareSerial.h>

// SIM800L on UART2 - does NOT conflict with GPIO4 (relay) or GPIO36 (ADC)
HardwareSerial gsmSerial(2);


/******************** WIFI CONFIGURATION ********************/

char ssid[] = "POCO";
char pass[] = "567890aa";


/******************** PIN CONFIGURATION **********************/

const int RELAY_PIN = 4;
const int WATER_SENSOR_PIN = 36;

// SIM800L UART2 pins
const int GSM_RX_PIN = 16;
const int GSM_TX_PIN = 17;
const int GSM_BAUD   = 9600;


/******************** FARMER CONTACT ************************/

/*
 * UPDATE THIS before flashing.
 * Format: +91XXXXXXXXXX (include country code, no spaces)
 */
const char FARMER_PHONE[] = "+91XXXXXXXXXX";


/******************** RELAY LOGIC ****************************/

/*
 * Most 5V single-channel relay modules are ACTIVE LOW.
 *
 * ACTIVE LOW:
 *   LOW  = Relay ON
 *   HIGH = Relay OFF
 *
 * If your relay behaves opposite, change this to false.
 */

const bool RELAY_ACTIVE_LOW = true;


/******************** WATER SENSOR ***************************/

const int WATER_THRESHOLD = 1500;


/******************** TIMING CONFIGURATION *******************/

const unsigned long STARTUP_BYPASS_TIME = 90000UL;  // 90 sec

const unsigned long DRY_VERIFY_TIME = 5000UL;       // 5 sec

const unsigned long USER_RESPONSE_TIME = 30000UL;  // 30 sec

// How long to let the phone ring before auto-hanging up
const unsigned long CALL_DURATION_MS = 20000UL;    // 20 sec

// Minimum interval between AT+CSQ signal checks
const unsigned long GSM_SIGNAL_CHECK_INTERVAL = 15000UL;


/******************** BLYNK TIMER ****************************/

BlynkTimer timer;


/******************** SYSTEM STATES **************************/

enum PumpState
{
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

unsigned long responseStartTime = 0;

unsigned long pumpStartTime = 0;

unsigned long totalRuntime = 0;

unsigned long lastRuntimeUpdate = 0;


/******************** GSM STATE VARIABLES ********************/

bool   gsmReady           = false;   // Module responded to AT
bool   smsSent            = false;   // Prevents duplicate SMS per fault
bool   callMade           = false;   // Prevents duplicate call per fault
bool   callActive         = false;   // True while call is in progress
int    gsmSignal          = 99;      // 0-31 (99 = unknown / no signal)
unsigned long callStartTime      = 0;
unsigned long lastGSMSignalCheck = 0;

// Rolling AT response buffer (non-blocking line reader)
String atBuffer = "";


/******************** HELPER FUNCTIONS ***********************/


void relayOn()
{
  if (RELAY_ACTIVE_LOW)
  {
    digitalWrite(RELAY_PIN, LOW);
  }
  else
  {
    digitalWrite(RELAY_PIN, HIGH);
  }

  Serial.println("RELAY -> ON");
}


void relayOff()
{
  if (RELAY_ACTIVE_LOW)
  {
    digitalWrite(RELAY_PIN, HIGH);
  }
  else
  {
    digitalWrite(RELAY_PIN, LOW);
  }

  Serial.println("RELAY -> OFF");
}


bool isRelayOn()
{
  if (RELAY_ACTIVE_LOW)
  {
    return digitalRead(RELAY_PIN) == LOW;
  }
  else
  {
    return digitalRead(RELAY_PIN) == HIGH;
  }
}


/*************************************************************
 * GSM / SIM800L FUNCTIONS (non-blocking, millis-based)
 *************************************************************/

/*
 * Send a raw AT command to the GSM module.
 * Responses are handled asynchronously in gsmTask().
 */
void sendAT(const String &cmd)
{
  gsmSerial.println(cmd);
  Serial.print("GSM TX: ");
  Serial.println(cmd);
}


/*
 * Initialize the SIM800L module.
 * Called once from setup().
 * Uses short delays only here during boot — acceptable.
 */
void initGSM()
{
  gsmSerial.begin(GSM_BAUD, SERIAL_8N1, GSM_RX_PIN, GSM_TX_PIN);

  delay(2000);  // Give module time to boot

  sendAT("AT");          delay(300);
  sendAT("AT+CMGF=1");   delay(300);  // SMS text mode
  sendAT("AT+CSCS=\"GSM\""); delay(300);  // GSM charset
  sendAT("AT+CREG?");    delay(300);  // Network registration

  Serial.println("GSM: Initialization sequence complete.");
}


/*
 * Send an SMS.
 * Guard: call this only when smsSent == false.
 */
void sendSMS(const char *phone, const String &message)
{
  Serial.print("GSM: Sending SMS to ");
  Serial.println(phone);

  gsmSerial.print("AT+CMGS=\"");
  gsmSerial.print(phone);
  gsmSerial.println("\"");

  delay(300);  // Wait for '>' prompt

  gsmSerial.print(message);
  gsmSerial.write(26);  // CTRL+Z sends the SMS
}


/*
 * Make a voice call.
 * Guard: call this only when callMade == false.
 * Auto-hangs up after CALL_DURATION_MS via gsmTask().
 */
void makeCall(const char *phone)
{
  Serial.print("GSM: Calling ");
  Serial.println(phone);

  gsmSerial.print("ATD");
  gsmSerial.print(phone);
  gsmSerial.println(";");

  callStartTime = millis();
  callActive    = true;
}


/*
 * Triggered by activateDryRunProtection().
 * Sends ONE SMS and makes ONE call per fault cycle.
 * Flags smsSent/callMade prevent duplicates.
 */
void triggerGSMAlert()
{
  if (!smsSent)
  {
    String message =
      "PUMP ALERT: Dry-run detected! "
      "Pump stopped to protect motor. "
      "ADC=" + String(waterADC) +
      ". Please check borewell water level immediately.";

    sendSMS(FARMER_PHONE, message);
    smsSent = true;

    if (Blynk.connected())
    {
      Blynk.logEvent(
        "gsm_sms_sent",
        "SMS alert sent to farmer: " + String(FARMER_PHONE)
      );
    }
  }

  if (!callMade)
  {
    makeCall(FARMER_PHONE);
    callMade = true;

    if (Blynk.connected())
    {
      Blynk.logEvent(
        "gsm_call_made",
        "Phone call made to farmer: " + String(FARMER_PHONE)
      );
    }
  }
}


/*
 * Periodic GSM task — called every 100 ms from BlynkTimer.
 *
 * Responsibilities:
 *   1. Non-blocking reading of AT responses from gsmSerial.
 *   2. Auto-hang-up after CALL_DURATION_MS.
 *   3. Periodic signal strength check.
 *   4. Update V12 (GSM status) on Blynk.
 */
void gsmTask()
{
  // --- Auto hang-up after call duration ---
  if (callActive && (millis() - callStartTime >= CALL_DURATION_MS))
  {
    sendAT("ATH");
    callActive = false;
    Serial.println("GSM: Call ended (timeout).");
  }

  // --- Periodic signal quality check ---
  if (millis() - lastGSMSignalCheck >= GSM_SIGNAL_CHECK_INTERVAL)
  {
    sendAT("AT+CSQ");
    lastGSMSignalCheck = millis();
  }

  // --- Non-blocking serial read ---
  while (gsmSerial.available())
  {
    char c = gsmSerial.read();
    atBuffer += c;

    // Process complete line
    if (c == '\n')
    {
      atBuffer.trim();

      if (atBuffer.length() > 0)
      {
        Serial.print("GSM RX: ");
        Serial.println(atBuffer);

        // Module acknowledged first AT
        if (atBuffer == "OK" && !gsmReady)
        {
          gsmReady = true;
          Serial.println("GSM: Module READY");
          if (Blynk.connected())
          {
            Blynk.virtualWrite(V12, "READY");
          }
        }

        // Signal quality +CSQ: xx,yy
        if (atBuffer.startsWith("+CSQ:"))
        {
          int comma = atBuffer.indexOf(',');
          if (comma > 5)
          {
            gsmSignal = atBuffer.substring(5, comma).toInt();
          }

          String sigStr;
          if (gsmSignal == 99)
          {
            sigStr = "NO SIGNAL";
          }
          else
          {
            sigStr = "SIG:" + String(gsmSignal) + "/31";
          }

          if (Blynk.connected())
          {
            Blynk.virtualWrite(
              V12,
              gsmReady ? ("READY " + sigStr) : "CHECKING"
            );
          }
        }

        // SMS sent confirmation
        if (atBuffer.startsWith("+CMGS:"))
        {
          Serial.println("GSM: SMS confirmation received.");
          if (Blynk.connected())
          {
            Blynk.virtualWrite(V13, 1);  // Flag: SMS sent
          }
        }

        // Network registration
        if (atBuffer.startsWith("+CREG:"))
        {
          Serial.print("GSM: Network reg: ");
          Serial.println(atBuffer);
        }

        // Call connected
        if (atBuffer == "CONNECT" || atBuffer == "NO CARRIER")
        {
          Serial.print("GSM: Call event: ");
          Serial.println(atBuffer);
        }

        // Error
        if (atBuffer == "ERROR" || atBuffer == "NO SIM")
        {
          Serial.println("GSM: ERROR — Check SIM card and wiring.");
          if (Blynk.connected())
          {
            Blynk.virtualWrite(V12, "ERROR");
            Blynk.logEvent("gsm_fault", "GSM module error. Check SIM and wiring.");
          }
        }
      }

      atBuffer = "";
    }

    // Prevent buffer overflow from garbage characters
    if (atBuffer.length() > 256)
    {
      atBuffer = "";
    }
  }
}


/*************************************************************
 * READ WATER SENSOR
 *************************************************************/

void readWaterSensor()
{
  waterADC = analogRead(WATER_SENSOR_PIN);

  if (waterADC >= WATER_THRESHOLD)
  {
    waterPresent = true;
  }
  else
  {
    waterPresent = false;
  }

  Serial.print("Water ADC: ");
  Serial.print(waterADC);

  Serial.print(" | Water: ");

  if (waterPresent)
  {
    Serial.println("PRESENT");
  }
  else
  {
    Serial.println("ABSENT");
  }
}


/*************************************************************
 * START PUMP
 *************************************************************/

void startPump()
{
  Serial.println();
  Serial.println("=================================");
  Serial.println("START PUMP COMMAND RECEIVED");
  Serial.println("=================================");

  /*
   * Start relay.
   */

  relayOn();

  /*
   * Start startup timer.
   */

  startupStartTime = millis();

  /*
   * Record pump start time.
   */

  pumpStartTime = millis();

  /*
   * Reset dry-run detection flags.
   */

  dryVerificationStarted = false;

  warningNotificationSent = false;

  shutdownNotificationSent = false;

  waterRestoredNotificationSent = false;

  /*
   * Reset GSM alert flags so the next fault
   * can send a fresh SMS and call.
   */

  smsSent   = false;
  callMade  = false;

  /*
   * Enter startup state.
   */

  currentState = STARTING;

  if (Blynk.connected())
  {
    Blynk.virtualWrite(V1, "STARTING");
    Blynk.virtualWrite(V4, "90 SEC STARTUP BYPASS");
    Blynk.virtualWrite(V9, 1);

    Blynk.logEvent(
      "pump_started",
      "Pump started. 90-second startup bypass active."
    );
  }

  Serial.println("Pump STARTING...");
}


/*************************************************************
 * STOP PUMP
 *************************************************************/

void stopPump(const char* reason)
{
  Serial.println();
  Serial.println("=================================");
  Serial.println("STOPPING PUMP");
  Serial.println(reason);
  Serial.println("=================================");

  /*
   * Turn relay OFF.
   */

  relayOff();

  /*
   * Calculate runtime.
   */

  if (pumpStartTime > 0)
  {
    totalRuntime += millis() - pumpStartTime;
  }

  pumpStartTime = 0;

  /*
   * Reset monitoring.
   */

  dryVerificationStarted = false;

  /*
   * Normal OFF state.
   */

  currentState = SYSTEM_OFF;

  if (Blynk.connected())
  {
    Blynk.virtualWrite(V0, 0);
    Blynk.virtualWrite(V1, "OFF");
    Blynk.virtualWrite(V4, "NORMAL");
    Blynk.virtualWrite(V9, 0);
    Blynk.virtualWrite(V7, 0);

    Blynk.logEvent(
      "pump_stopped",
      reason
    );
  }
}


/*************************************************************
 * DRY-RUN WARNING
 *************************************************************/

void startDryRunWarning()
{
  Serial.println();
  Serial.println("=================================");
  Serial.println("DRY-RUN WARNING");
  Serial.println("=================================");

  currentState = WATER_WARNING;

  responseStartTime = millis();

  warningNotificationSent = true;

  if (Blynk.connected())
  {
    Blynk.virtualWrite(V1, "WATER LOSS");
    Blynk.virtualWrite(V2, "ABSENT");
    Blynk.virtualWrite(V4, "DRY-RUN WARNING");
    Blynk.virtualWrite(V6, "Water not detected");
    Blynk.virtualWrite(V7, USER_RESPONSE_TIME / 1000);

    String message =
      "Water loss detected. "
      "ADC=" + String(waterADC) +
      ". Pump protection response timer started.";

    Blynk.logEvent(
      "dry_run_warning",
      message
    );
  }
}


/*************************************************************
 * DRY-RUN PROTECTION SHUTDOWN
 *************************************************************/

void activateDryRunProtection()
{
  Serial.println();
  Serial.println("#################################");
  Serial.println("DRY-RUN PROTECTION ACTIVATED");
  Serial.println("#################################");

  /*
   * Immediately stop relay.
   * This is the primary safety action.
   * Happens regardless of GSM/WiFi/Blynk state.
   */

  relayOff();

  /*
   * Calculate runtime.
   */

  if (pumpStartTime > 0)
  {
    totalRuntime += millis() - pumpStartTime;
  }

  pumpStartTime = 0;

  /*
   * Enter FAULT LOCK.
   *
   * Pump will NOT automatically restart.
   *
   * User must press ON.
   */

  currentState = FAULT_LOCK;

  dryVerificationStarted = false;

  shutdownNotificationSent = true;

  /*
   * GSM Alert: Send ONE SMS + make ONE call.
   * Guards inside triggerGSMAlert() prevent duplicates.
   * Works even if Wi-Fi / Blynk is unavailable.
   */

  triggerGSMAlert();

  if (Blynk.connected())
  {
    Blynk.virtualWrite(V0, 0);
    Blynk.virtualWrite(V1, "FAULT - PUMP OFF");
    Blynk.virtualWrite(V2, "WATER ABSENT");
    Blynk.virtualWrite(V4, "DRY-RUN PROTECTION");
    Blynk.virtualWrite(V6, "DRY-RUN FAULT");
    Blynk.virtualWrite(V7, 0);
    Blynk.virtualWrite(V9, 0);

    String message =
      "PUMP STOPPED: Dry-run protection. "
      "ADC=" + String(waterADC) +
      ". Manual ON command required for another start attempt.";

    Blynk.logEvent(
      "dry_run_shutdown",
      message
    );
  }
}


/*************************************************************
 * STARTUP BYPASS HANDLER
 *************************************************************/

void handleStartup()
{
  unsigned long elapsed =
    millis() - startupStartTime;

  unsigned long remaining =
    STARTUP_BYPASS_TIME - elapsed;

  /*
   * Display remaining startup time.
   */

  if (Blynk.connected())
  {
    Blynk.virtualWrite(
      V7,
      remaining / 1000
    );

    Blynk.virtualWrite(
      V4,
      "STARTUP BYPASS"
    );
  }

  /*
   * Startup finished.
   */

  if (elapsed >= STARTUP_BYPASS_TIME)
  {
    Serial.println();
    Serial.println("90 SECOND STARTUP BYPASS COMPLETED");

    readWaterSensor();

    if (waterPresent)
    {
      currentState = RUNNING;

      if (Blynk.connected())
      {
        Blynk.virtualWrite(V1, "RUNNING");
        Blynk.virtualWrite(V2, "PRESENT");
        Blynk.virtualWrite(V4, "NORMAL");
        Blynk.virtualWrite(V7, 0);
      }

      Serial.println("Water detected. Pump RUNNING.");
    }
    else
    {
      /*
       * Water is absent after startup.
       *
       * Start the 5-second verification.
       */

      dryVerificationStarted = true;

      dryVerificationStartTime = millis();

      Serial.println(
        "Water absent after startup. "
        "Starting 5-second verification."
      );
    }
  }
}


/*************************************************************
 * RUNNING STATE HANDLER
 *************************************************************/

void handleRunning()
{
  /*
   * If water is present, everything is normal.
   */

  if (waterPresent)
  {
    dryVerificationStarted = false;

    if (Blynk.connected())
    {
      Blynk.virtualWrite(V1, "RUNNING");
      Blynk.virtualWrite(V2, "PRESENT");
      Blynk.virtualWrite(V4, "NORMAL");
      Blynk.virtualWrite(V7, 0);
    }

    return;
  }


  /*
   * Water is absent.
   *
   * Start verification timer.
   */

  if (!dryVerificationStarted)
  {
    dryVerificationStarted = true;

    dryVerificationStartTime = millis();

    Serial.println();
    Serial.println("LOW WATER DETECTED");
    Serial.println("Starting 5-second verification...");
  }


  /*
   * Check 5-second verification.
   */

  unsigned long verificationElapsed =
    millis() - dryVerificationStartTime;


  if (verificationElapsed >= DRY_VERIFY_TIME)
  {
    readWaterSensor();

    /*
     * Water returned.
     */

    if (waterPresent)
    {
      dryVerificationStarted = false;

      Serial.println(
        "Water returned during verification."
      );

      return;
    }

    /*
     * Water still absent.
     *
     * Generate warning.
     */

    if (!warningNotificationSent)
    {
      startDryRunWarning();
    }
  }
}


/*************************************************************
 * WATER WARNING STATE
 *************************************************************/

void handleWaterWarning()
{
  /*
   * Check whether water returned.
   */

  if (waterPresent)
  {
    Serial.println();
    Serial.println("WATER RESTORED");
    Serial.println("Cancelling dry-run warning.");

    currentState = RUNNING;

    dryVerificationStarted = false;

    warningNotificationSent = false;

    if (Blynk.connected())
    {
      Blynk.virtualWrite(V1, "RUNNING");
      Blynk.virtualWrite(V2, "PRESENT");
      Blynk.virtualWrite(V4, "WATER RESTORED");
      Blynk.virtualWrite(V6, "No fault");
      Blynk.virtualWrite(V7, 0);

      if (!waterRestoredNotificationSent)
      {
        Blynk.logEvent(
          "water_restored",
          "Water restored. Pump continues running."
        );

        waterRestoredNotificationSent = true;
      }
    }

    return;
  }


  /*
   * Water is still absent.
   *
   * Calculate response countdown.
   */

  unsigned long elapsed =
    millis() - responseStartTime;


  if (elapsed < USER_RESPONSE_TIME)
  {
    unsigned long remaining =
      USER_RESPONSE_TIME - elapsed;

    int secondsRemaining =
      remaining / 1000;

    if (Blynk.connected())
    {
      Blynk.virtualWrite(
        V7,
        secondsRemaining
      );

      Blynk.virtualWrite(
        V4,
        "WAITING FOR RESPONSE"
      );
    }

    return;
  }


  /*
   * User did not respond.
   *
   * Activate automatic protection.
   */

  if (!shutdownNotificationSent)
  {
    activateDryRunProtection();
  }
}


/*************************************************************
 * FAULT LOCK STATE
 *************************************************************/

void handleFaultLock()
{
  /*
   * Relay must remain OFF.
   */

  relayOff();

  if (Blynk.connected())
  {
    Blynk.virtualWrite(V1, "FAULT - PUMP OFF");
    Blynk.virtualWrite(V4, "FAULT LOCK");
    Blynk.virtualWrite(V6, "DRY-RUN FAULT");
    Blynk.virtualWrite(V9, 0);
  }

  /*
   * IMPORTANT:
   *
   * No automatic restart.
   *
   * User must press ON.
   */
}


/*************************************************************
 * RUNTIME UPDATE
 *************************************************************/

void updateRuntime()
{
  if (pumpStartTime == 0)
  {
    return;
  }

  unsigned long currentRuntime =
    millis() - pumpStartTime;

  unsigned long total =
    totalRuntime + currentRuntime;

  unsigned long totalSeconds =
    total / 1000;

  unsigned long hours =
    totalSeconds / 3600;

  unsigned long minutes =
    (totalSeconds % 3600) / 60;

  unsigned long seconds =
    totalSeconds % 60;

  char runtimeText[30];

  sprintf(
    runtimeText,
    "%02lu:%02lu:%02lu",
    hours,
    minutes,
    seconds
  );

  if (Blynk.connected())
  {
    Blynk.virtualWrite(
      V5,
      runtimeText
    );
  }
}


/*************************************************************
 * SEND SENSOR DATA TO BLYNK
 *************************************************************/

void updateDashboard()
{
  readWaterSensor();

  if (!Blynk.connected())
  {
    return;
  }

  /*
   * ADC
   */

  Blynk.virtualWrite(
    V3,
    waterADC
  );


  /*
   * Water status
   */

  if (waterPresent)
  {
    Blynk.virtualWrite(
      V2,
      "PRESENT"
    );
  }
  else
  {
    Blynk.virtualWrite(
      V2,
      "ABSENT"
    );
  }


  /*
   * Threshold
   */

  Blynk.virtualWrite(
    V10,
    WATER_THRESHOLD
  );


  /*
   * Relay
   */

  Blynk.virtualWrite(
    V9,
    isRelayOn() ? 1 : 0
  );


  /*
   * Wi-Fi
   */

  Blynk.virtualWrite(
    V8,
    WiFi.status() == WL_CONNECTED
      ? "CONNECTED"
      : "DISCONNECTED"
  );


  /*
   * Runtime
   */

  updateRuntime();
}


/*************************************************************
 * SYSTEM STATE DISPLAY
 *************************************************************/

void updateSystemState()
{
  if (!Blynk.connected())
  {
    return;
  }

  switch (currentState)
  {
    case SYSTEM_OFF:
      Blynk.virtualWrite(
        V11,
        "OFF"
      );
      break;

    case STARTING:
      Blynk.virtualWrite(
        V11,
        "STARTING"
      );
      break;

    case RUNNING:
      Blynk.virtualWrite(
        V11,
        "RUNNING"
      );
      break;

    case WATER_WARNING:
      Blynk.virtualWrite(
        V11,
        "WATER WARNING"
      );
      break;

    case FAULT_LOCK:
      Blynk.virtualWrite(
        V11,
        "FAULT LOCK"
      );
      break;
  }
}


/*************************************************************
 * BLYNK PUMP BUTTON
 *
 * V0:
 * 1 = ON
 * 0 = OFF
 *************************************************************/

BLYNK_WRITE(V0)
{
  int command = param.asInt();

  Serial.println();
  Serial.print("Blynk Pump Command: ");
  Serial.println(command);


  /******************** USER OFF ****************************/

  if (command == 0)
  {
    stopPump("Pump stopped manually from Blynk.");

    return;
  }


  /******************** USER ON ******************************/

  if (command == 1)
  {
    /*
     * Don't start another pump if already running.
     */

    if (
      currentState == STARTING ||
      currentState == RUNNING ||
      currentState == WATER_WARNING
    )
    {
      Serial.println(
        "Pump is already active."
      );

      return;
    }


    /*
     * If system was in FAULT_LOCK,
     * pressing ON creates a NEW start attempt.
     * GSM alert flags are reset in startPump().
     */

    if (currentState == FAULT_LOCK)
    {
      Serial.println(
        "Manual restart command received "
        "after dry-run fault."
      );

      /*
       * Reset fault indicators.
       */

      shutdownNotificationSent = false;
      warningNotificationSent = false;
      waterRestoredNotificationSent = false;
    }


    /*
     * Start pump.
     */

    startPump();
  }
}


/*************************************************************
 * BLYNK CONNECTED
 *************************************************************/

BLYNK_CONNECTED()
{
  Serial.println();
  Serial.println("==============================");
  Serial.println("BLYNK CONNECTED");
  Serial.println("==============================");

  /*
   * Synchronize pump command.
   */

  Blynk.syncVirtual(V0);

  /*
   * Send current configuration.
   */

  Blynk.virtualWrite(
    V10,
    WATER_THRESHOLD
  );

  Blynk.virtualWrite(
    V8,
    "CONNECTED"
  );

  /*
   * GSM status to Blynk.
   */

  Blynk.virtualWrite(
    V12,
    gsmReady ? "READY" : "INITIALIZING"
  );
}


/*************************************************************
 * PERIODIC SENSOR TASK
 *************************************************************/

void sensorTask()
{
  /*
   * Read sensor.
   */

  readWaterSensor();


  /*
   * State machine.
   */

  switch (currentState)
  {
    case SYSTEM_OFF:

      relayOff();

      break;


    case STARTING:

      handleStartup();

      break;


    case RUNNING:

      handleRunning();

      break;


    case WATER_WARNING:

      handleWaterWarning();

      break;


    case FAULT_LOCK:

      handleFaultLock();

      break;
  }


  /*
   * Dashboard.
   */

  updateDashboard();

  updateSystemState();
}


/*************************************************************
 * SETUP
 *************************************************************/

void setup()
{
  Serial.begin(115200);

  delay(500);

  Serial.println();
  Serial.println();
  Serial.println("=========================================");
  Serial.println("BOREWELL PUMP PROTECTION SYSTEM");
  Serial.println("ESP32 + BLYNK + SIM800L GSM");
  Serial.println("=========================================");


  /******************** GPIO *******************************/

  pinMode(
    RELAY_PIN,
    OUTPUT
  );

  pinMode(
    WATER_SENSOR_PIN,
    INPUT
  );


  /******************** SAFE RELAY STATE *******************/

  /*
   * ALWAYS start with relay OFF.
   */

  relayOff();


  /******************** ADC *******************************/

  /*
   * 12-bit ADC:
   *
   * 0 - 4095
   */

  analogReadResolution(12);

  /*
   * ESP32 ADC attenuation.
   *
   * This allows a wider input range.
   */

  analogSetPinAttenuation(
    WATER_SENSOR_PIN,
    ADC_11db
  );


  /******************** INITIAL SENSOR READ ***************/

  readWaterSensor();


  /******************** GSM / SIM800L *********************/

  /*
   * Initialize UART2 for SIM800L.
   * GPIO16 = RX, GPIO17 = TX.
   * Does NOT interfere with relay (GPIO4) or ADC (GPIO36).
   */

  initGSM();


  /******************** BLYNK *****************************/

  Blynk.begin(
    BLYNK_AUTH_TOKEN,
    ssid,
    pass
  );


  /******************** PERIODIC TASKS ********************/

  /*
   * Sensor + state machine:
   * every 100 ms
   */

  timer.setInterval(
    100L,
    sensorTask
  );


  /*
   * Runtime:
   * every 1 second
   */

  timer.setInterval(
    1000L,
    updateRuntime
  );


  /*
   * GSM response reader + AT command handler:
   * every 100 ms (non-blocking)
   */

  timer.setInterval(
    100L,
    gsmTask
  );


  Serial.println();
  Serial.println("SYSTEM READY");
  Serial.println("Pump is OFF.");
  Serial.println("Waiting for Blynk ON command.");
  Serial.println("GSM initializing...");
}


/*************************************************************
 * MAIN LOOP
 *************************************************************/

void loop()
{
  /*
   * Blynk communication.
   */

  Blynk.run();


  /*
   * Timers (sensor task, runtime, GSM task).
   */

  timer.run();
}