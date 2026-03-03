# Cursor Prompt — Secure the AICS Project

## Context

This is the **AICS (Assistance to Individuals in Crisis Situations)** web app for the Social Welfare & Development Office of the Municipality of Oton, Iloilo. It is a static HTML/CSS/JS frontend that communicates with a **Google Apps Script** backend via JSONP requests. The backend reads/writes to a Google Sheet that stores beneficiary records (patient names, addresses, contact numbers, assistance type).

The project is currently public on GitHub. The Google Apps Script URL is hardcoded in `js/assistance-form.js` and there is **zero authentication** on any endpoint — anyone who finds the URL can submit fake records, fetch all patient data, or spam the sheet.

---

## What I Need You To Do

Please apply all of the following security improvements. Make the changes surgical — do not restructure the project or change any UI/form behavior.

---

### 1. Create `js/config.js` (new file — NOT committed to Git)

Create a new file `js/config.js` with the following content:

```js
// SECURITY: This file is excluded from Git via .gitignore
// Distribute this file separately to authorized users only.

var APPS_SCRIPT_URL   = "PASTE_YOUR_APPS_SCRIPT_URL_HERE";
var APPS_SCRIPT_TOKEN = "PASTE_YOUR_SECRET_TOKEN_HERE";
```

- Replace the hardcoded `APPS_SCRIPT_URL` at the top of `js/assistance-form.js` with a reference to `APPS_SCRIPT_URL` from this config file.
- Add `APPS_SCRIPT_TOKEN` as a variable that gets appended to every request as `&token=...`.

---

### 2. Update `.gitignore`

Add the following lines to `.gitignore` (create the file if it doesn't exist):

```
# Security: keep credentials out of version control
js/config.js
```

---

### 3. Update `assistance-form.html`

Add `<script src="js/config.js"></script>` **before** the existing `<script src="js/assistance-form.js"></script>` tag so the config variables are available.

---

### 4. Update `js/assistance-form.js`

- Remove the hardcoded `var APPS_SCRIPT_URL = "..."` line at the top (it will now come from `config.js`).
- Find every place where a URL is built using `APPS_SCRIPT_URL + "?..."` and append `&token=" + encodeURIComponent(APPS_SCRIPT_TOKEN)` to each one. There are approximately 3 locations:
  - `getNextSeq` call (around the `getNextSeq` action)
  - `checkEligibility` call
  - The main form submission call (where `script.src = APPS_SCRIPT_URL + "?" + query`)

---

### 5. Update `apps-script/Code.gs`

At the **very top** of `Code.gs`, add a secret token constant:

```js
var ALLOWED_TOKEN = "PASTE_YOUR_SECRET_TOKEN_HERE";
```

Use the **same token value** you put in `js/config.js`.

Then, at the **very beginning** of the `doGet(e)` function — before any action is processed — add this token check:

```js
function doGet(e) {
  var params = (e && e.parameter) || {};

  // ── Security: reject requests without the correct token ──
  if (!params.token || params.token !== ALLOWED_TOKEN) {
    return ContentService
      .createTextOutput(
        (params.callback ? params.callback + "(" : "") +
        JSON.stringify({ status: "error", message: "Unauthorized" }) +
        (params.callback ? ")" : "")
      )
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  // ── End security check ──

  // ... rest of existing doGet code unchanged ...
}
```

> Note: The JSONP callback wrapper is included in the unauthorized response so the client-side error handler still fires correctly.

---

### 6. Add basic input validation in `Code.gs`

In the `doGet` function, after the token check and before processing the `action` param, add length and character guards for the main submit fields:

```js
// Basic input sanitation for submit action
if (!params.action) {
  var fieldsToCheck = ["patientName", "address", "claimantLastName", "claimantFirstName", "claimantMiddleName", "encodedBy", "remark"];
  for (var f = 0; f < fieldsToCheck.length; f++) {
    var val = params[fieldsToCheck[f]] || "";
    if (val.length > 300) {
      return jsonResponse({ status: "error", message: "Input too long for field: " + fieldsToCheck[f] }, params);
    }
  }
}
```

---

### 7. Create `js/config.example.js` (safe template for Git)

Create a file called `js/config.example.js` that IS committed to Git, so other developers know what they need:

```js
// TEMPLATE — copy this file to js/config.js and fill in your values
// js/config.js is excluded from Git for security reasons.

var APPS_SCRIPT_URL   = "YOUR_GOOGLE_APPS_SCRIPT_EXEC_URL_HERE";
var APPS_SCRIPT_TOKEN = "YOUR_SECRET_TOKEN_HERE";
```

---

### 8. Update `README.md`

Add a **Security Setup** section to `README.md` explaining:
- `js/config.js` is excluded from Git
- Developers must copy `js/config.example.js` → `js/config.js` and fill in real values
- The Apps Script must have the same token set as `ALLOWED_TOKEN` in `Code.gs`
- The existing public Apps Script deployment URL on GitHub should be considered compromised and must be rotated (redeploy as a new deployment in Google Apps Script)

---

## Summary of Files Changed

| File | Action |
|------|--------|
| `js/config.js` | **Create** (gitignored) |
| `js/config.example.js` | **Create** (committed, safe template) |
| `js/assistance-form.js` | **Edit** — remove hardcoded URL, append token to all requests |
| `assistance-form.html` | **Edit** — add `config.js` script tag |
| `apps-script/Code.gs` | **Edit** — add `ALLOWED_TOKEN` constant + token check in `doGet()` + input length validation |
| `.gitignore` | **Edit/Create** — add `js/config.js` |
| `README.md` | **Edit** — add Security Setup section |

---

## Important Notes for Cursor

- Do **not** change any UI, form fields, CSS, or user-facing behavior.
- Do **not** change the JSONP communication pattern — keep using `script.src` and callbacks.
- The token value in `Code.gs` (`ALLOWED_TOKEN`) and the token value in `js/config.js` (`APPS_SCRIPT_TOKEN`) must be identical. Use a placeholder string like `"REPLACE_WITH_YOUR_SECRET_TOKEN"` in both so I can fill them in manually.
- After making these changes, remind me that I need to: (1) generate a strong random token, (2) update both `Code.gs` and `js/config.js` with that token, (3) redeploy the Google Apps Script as a **new deployment** (not a new version of the old one) to get a fresh URL.
