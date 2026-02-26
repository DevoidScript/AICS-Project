# AICS Project — Cursor AI Prompt

## Project Overview

This is a web-based **Assistance to Individuals in Crisis Situations (AICS)** form system for **LGU Oton's Social Welfare & Development Office**. It is a plain HTML/CSS/JS frontend that submits data to a **Google Apps Script** backend which writes to **Google Sheets**.

There is no framework (no React, no Vue). Everything is vanilla JavaScript. The backend is Google Apps Script (`.gs` files), not a traditional server.

---

## File Structure

```
AICS-Project-main/
├── assistance-form.html         # Main form page
├── css/
│   └── assistance-form.css      # All styles
├── js/
│   ├── assistance-form.js       # Main form logic (submit, validation, eligibility, TX number)
│   ├── offline-queue.js         # Offline queue — saves failed submissions to localStorage, auto-syncs when back online
│   └── record-cache.js          # Offline eligibility — caches all Google Sheets records locally for offline cooldown checks
├── apps-script/
│   └── Code.gs                  # Google Apps Script backend — handles all HTTP endpoints
└── images/
    ├── NewHeader.jpg
    └── LGU Oton Official Seal (HD).png
```

---

## How the System Works

### Frontend → Backend Communication
- The form uses **JSONP** (not fetch/axios) to call the Google Apps Script web app URL.
- JSONP works by injecting a `<script>` tag. The server wraps the JSON response in a callback function name.
- This is necessary because the form may be opened as a local `file://` URL (no server), which blocks normal CORS requests.
- All network calls have timeouts (10–30 seconds) and `onerror` handlers.

### Google Sheets Structure
Each sheet is named by year: `AICS 2025`, `AICS 2026`, etc.
Columns per sheet:
```
A = ID Number       (e.g. AICS-20260223-001)
B = Date            (YYYY-MM-DD)
C = Patient / Deceased
D = Address
E = Contact Number
F = Claimant        (Last, First Middle)
G = Type of Assistance
H = Code
I = Remark
J = Encoded By
K = Timestamp
```

### Transaction Number Format
`AICS-YYYYMMDD-NNN` where NNN is a 3-digit daily sequence number.
- The sequence is fetched from the sheet on page load (`?action=getNextSeq`).
- Falls back to `localStorage` counter when offline.
- Offline-generated numbers are styled amber/italic as "pending".

### Eligibility / Cooldown Rules
Certain assistance types have cooldown periods before the same patient can claim again:
- **6 months:** Maintenance, Dialysis, Chemotherapy
- **12 months:** Medicine, Laboratory, Hospital Bill, Confinement, Others
- **No cooldown:** Burial

Eligibility is checked:
1. When the patient name field loses focus (`blur` event)
2. When the type of assistance changes
3. Again at form submit (server-side too, as a double-check)

---

## Offline System (Key Feature)

### offline-queue.js
- Detects online/offline state via `window.addEventListener("online"/"offline")` + a real ping to confirm.
- When offline, failed submissions are saved to `localStorage` under key `"aicsOfflineQueue"`.
- When back online, queued records are auto-synced one by one to Google Sheets.
- A banner slides down when offline. A badge shows how many records are pending sync.
- `localStorage` survives browser close and computer restart but is per-browser, per-device.

### record-cache.js
- On page load (when online), fetches ALL records from all sheets via `?action=getAllRecords`.
- Stores them in `localStorage` under key `"aicsRecordCache"` as:
  ```json
  {
    "fetchedAt": "2026-02-23T08:00:00.000Z",
    "records": [
      { "patientName": "JUAN DELA CRUZ", "date": "2026-01-10", "typeOfAssistance": "Medicine" }
    ]
  }
  ```
- Only 3 fields are stored (not full rows) to keep size small and avoid storing sensitive data offline.
- Refreshes silently every **30 minutes** in the background.
- When offline, `checkEligibilityOffline()` runs the same cooldown math against this local snapshot.
- If cache is empty and staff is offline → submission is **blocked completely** (no override allowed).
- Cache status bar shows: green (fresh), amber (stale >60 min), red (no cache).

---

## Apps Script Endpoints (`Code.gs`)

All endpoints are GET requests to the deployed web app URL. They all support JSONP via `&callback=functionName`.

| `?action=` | Purpose | Key params |
|---|---|---|
| *(none / form submit)* | Append a new row to the sheet | All form fields |
| `getNextSeq` | Get next sequence number for a date | `date=YYYYMMDD` |
| `checkEligibility` | Check if patient is in cooldown | `patientName`, `typeOfAssistance` |
| `getAllRecords` | Fetch all records (3 fields only) for offline cache | *(none)* |
| `ping` | Confirm real connectivity | *(none)* |

---

## localStorage Keys Used

| Key | Contents |
|---|---|
| `aicsOfflineQueue` | Array of queued offline submissions |
| `aicsRecordCache` | `{ fetchedAt, records[] }` snapshot of all sheet records |
| `aicsPendingTxns` | Array of transaction numbers generated offline (not yet confirmed) |
| `assistanceForm_currentTransactionNumber` | Current TX number shown in the form |
| `assistanceForm_seq_YYYYMMDD` | Daily sequence counter used as offline fallback |

---

## Coding Conventions

- **Vanilla JS only** — no jQuery, no frameworks, no ES6 modules (use `var`, not `let`/`const`, for broadest browser compatibility since the form runs as a local file).
- **JSONP pattern** for all network calls — inject `<script>` tag, define `window[callbackName]`, always set a timeout and `onerror` handler, always clean up the script tag after.
- **No `async/await`** — use `.then()` Promise chains or plain callbacks.
- **Apps Script** uses ES5-compatible JS (no arrow functions, no template literals, no `const`/`let`).
- CSS uses CSS custom properties (`--accent`, `--danger`, etc.) defined in `:root`.
- The form is designed to run as a **local `file://` URL** — do not add anything that requires a web server (no `fetch()` without CORS headers, no service workers).

---

## Important Constraints

1. **Do not use `fetch()`** for cross-origin calls — use JSONP only.
2. **Do not use ES6 modules** (`import`/`export`) — scripts are loaded via plain `<script>` tags.
3. **Do not store sensitive personal data** in the offline cache — only `patientName`, `date`, and `typeOfAssistance`.
4. **Always redeploy** the Apps Script after editing `Code.gs` — changes don't take effect until a new deployment is published.
5. **Sheet name format** is `AICS YYYY` or `AICS_YYYY` — the code handles both.
6. **New records go to the current year's sheet** — the backend redirects away from old year sheets automatically.

---

## What To Do After Cloning / Editing

1. Open `apps-script/Code.gs` in [Google Apps Script](https://script.google.com)
2. Paste the contents into your Apps Script project bound to the Google Sheet
3. Deploy as a **Web App** → Execute as: Me → Who has access: Anyone
4. Copy the deployment URL and paste it into `js/assistance-form.js` as `APPS_SCRIPT_URL`
5. Open `assistance-form.html` directly in a browser (no server needed)

---

## Known Limitations

| Limitation | Details |
|---|---|
| Offline cache is device-specific | If staff uses a different device, the cache must be refreshed on that device separately |
| Offline queue is browser-specific | Queued records only sync from the device that queued them |
| Cache can go stale | If internet is down for >30 min before the next refresh, the cache may miss very recent records from other devices |
| Blackout risk | If the computer loses power mid-form (before Submit is clicked), unsaved field data is lost — no auto-draft save is currently implemented |
| No authentication | The Apps Script web app is public — anyone with the URL can submit or read records |
