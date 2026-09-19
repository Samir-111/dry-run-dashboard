# Pump Protector — Farmer Dashboard

A production-ready, installable web app for controlling and monitoring your
Dry Run Motor Protector — designed to work like a native phone app in the
field: large buttons, plain language, and an "Add to Home Screen" install
so it opens instantly without typing a URL each time.

A custom web dashboard for your ESP32 Dry Run Motor Protector, backed by an
Express proxy to the Blynk Cloud API. This lets you build your own UI while
still using Blynk as the cloud link to the device — no changes needed on the
firmware side, since it just reads/writes the same virtual pins (V0–V6) your
Blynk app dashboard already uses.

## 1. Install dependencies

```bash
npm install
```

## 2. Add your Blynk auth token

Copy the example env file and fill in your device's token (find it in the
Blynk console under your device's Info tab):

```bash
cp .env.example .env
```

```
BLYNK_TOKEN=your_device_auth_token_here
BLYNK_REGION=blr1
RELAY_PIN=V0
PORT=3000
```

- **BLYNK_REGION**: Blynk Cloud is region-sharded. Check your Blynk console —
  the dashboard footer shows something like "Region: BLR1". Use the
  lowercase code (`blr1`, `sgp1`, `ny3`, `fra1`, etc.) here. Getting this
  wrong is the #1 cause of the dashboard silently failing to fetch data.
- **RELAY_PIN**: the virtual pin your "Relay" widget is bound to. Click the
  widget's gear/settings icon in the Blynk console to confirm — defaults to
  `V0`.

## 3. Run it

```bash
npm start
```

Open **http://localhost:3000** — you'll see the panel with live motor
status, water level, mode, trip count, and a restart countdown, plus buttons
to turn the motor on/off, switch Auto/Manual, and reset a lockout.

Toggling from this dashboard and from the Blynk app both control the same
virtual pins, so they'll always stay in sync.

## 4. Go live so a farmer can actually use it

Running only on `localhost` means it's only reachable on your own laptop.
For real deployment, put it on a free Node host so it has a public URL
reachable from any phone with mobile data:

- **Render** — New → Web Service → connect this folder/repo. Build command
  `npm install`, start command `npm start`. Add `BLYNK_TOKEN`,
  `BLYNK_REGION`, and `RELAY_PIN` as Environment Variables in the Render
  dashboard (never commit `.env` — it's already in `.gitignore`).
- **Railway** / **Fly.io** — same idea, set the same three env vars in
  their secrets/variables panel.

Once deployed, give the farmer the URL (or better — a QR code pointing to
it) and have them open it once in their phone's browser.

## 5. Install it as an app on the farmer's phone

This is a PWA (Progressive Web App) — no app store needed:

- **Android (Chrome)**: open the URL, tap the ⋮ menu → "Add to Home Screen"
  (or Chrome will show an install banner automatically). It then opens
  full-screen with its own icon, exactly like a real app.
- **iPhone (Safari)**: open the URL, tap the Share icon → "Add to Home
  Screen". The app itself shows this same hint automatically on iOS.

Once installed, it keeps working (showing the app shell) even over a weak
signal, though live pump/water data always needs a real connection to
Blynk to update.

## Farmer-facing behavior notes

- **"App Offline"** in the top-right means the dashboard server itself is
  unreachable (bad internet on the phone, or the hosting service is down).
- **"Pump Unit Offline"** means the ESP32 itself has lost WiFi/power —
  check the physical unit.
- **The red lock banner** appears automatically after 3 dry-run trips and
  disables pump control until "Reset Lock" is tapped — this is
  intentional, so the pump can't keep cycling against a dry source
  unattended.
- All buttons are large (64px+) and disable themselves automatically when
  the connection is down, so there's no confusing "tap and nothing
  happens" state.

## API reference (used internally by the dashboard)

| Method | Route          | Body            | Effect                          |
|--------|----------------|-----------------|----------------------------------|
| GET    | `/api/status`  | —               | Returns `online` (real device connection state) plus motor/water/mode/trips/countdown — any pin that doesn't exist yet in your template comes back as `null` and renders as "N/A" instead of breaking the page |
| POST   | `/api/motor`   | `{ "on": bool }`| Writes to `RELAY_PIN` (defaults V0) |
| POST   | `/api/mode`    | `{ "auto": bool }` | Writes V3 (Auto/Manual mode) — only works once that datastream exists |
| POST   | `/api/reset`   | —               | Writes V6 = 1 (lockout reset) — only works once that datastream exists |

## Why it showed OFFLINE with everything blank

Two things had to both be true to fix this:
1. **Region mismatch** — Blynk's external API is regional. Calling
   `blynk.cloud` when your org is on `blr1.blynk.cloud` fails outright.
2. **Missing datastreams** — your template currently only has one
   datastream ("Relay"). The original code fetched V0/V1/V3/V4/V5 as a
   single batch, so one missing pin failed the *entire* status response.
   It now fetches each pin independently and only shows "N/A" for the ones
   that don't exist yet, instead of taking down the whole dashboard.

Separately: if your physical device shows **Offline** in the Blynk
console itself, no dashboard (this one or the official Blynk app) can show
live sensor data until the ESP32 is actually connected to WiFi and Blynk.
Check the Serial Monitor when it boots for connection errors.

## Update — matched to your real datastreams

The firmware, backend, and dashboard now match your actual 12-pin template
(`firmware_dry_run_motor_protector_v2.ino`):

| Pin | Name | Shown where |
|-----|------|-------------|
| V0  | Relay | Pump on/off button |
| V1  | Pump Status | Pump lamp + status |
| V2  | Water Status | Water lamp + status |
| V3  | Water ADC | Diagnostics (raw sensor reading) |
| V4  | Protection Status | Diagnostics |
| V5  | Runtime | Main panel |
| V6  | Fault | Red banner (only shows when not "NONE") |
| V7  | Countdown | Main panel ("Restarting in") |
| V8  | Wifi Status | Diagnostics |
| V9  | Relay Status | Diagnostics (confirms actual GPIO state) |
| V10 | Water Threshold | Not shown in the UI yet — write `/api/threshold` to calibrate remotely once you widen its Max past 1 in the console |
| V11 | System State | Big banner at the top (IDLE / RUNNING / PROTECTING / WAITING FOR WATER) |

**No lockout/reset pin exists yet.** This version auto-resumes once water
returns rather than requiring a manual reset — tell me if you'd rather have
a hard lockout after N trips, and I'll add a V12 datastream plus a Reset
button for it.

**Calibrate the water sensor before relying on it**: flash the firmware,
open Serial Monitor, dip the sensor in water and out of water, note the two
`waterRaw` readings, then set `waterThreshold` in the firmware (or via V10
once widened) to a value between them.
