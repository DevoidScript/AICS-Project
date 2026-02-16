# Deploying the "Next transaction number" (getNextSeq) feature

For the form to read the next transaction number **from the sheet** (instead of resetting or using only local storage), the Apps Script project must be **deployed as a Web App** and you must use that deployment URL in the form.

## 1. Deploy as Web App

1. Open the Google Apps Script project (the one bound to your sheet or that uses `getActiveSpreadsheet()`).
2. In the editor: **Deploy** → **New deployment** (or **Manage deployments** → **Edit** → **New version**).
3. Type: **Web app**.
4. Settings:
   - **Execute as:** Me (your account).
   - **Who has access:** **Anyone** (so the form can call it from a browser).
5. Click **Deploy**, copy the **Web app URL** (looks like `https://script.google.com/macros/s/.../exec`).

## 2. Use that URL in the form

In `js/assistance-form.js`, set:

```js
var APPS_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
```

Use the **exact** URL from step 1.

## 3. Test that the sheet is read

Open this URL in a browser (replace with your URL and today’s date as YYYYMMDD):

```
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?action=getNextSeq&date=20260216
```

You should see JSON like: `{"nextSeq":3}` (the number should match “next row” for that date in your sheet).  
If you see something else (e.g. `{"status":"success"}`) or an error, the deployment doesn’t include the `getNextSeq` code — create a **new version** and redeploy.

## 4. After redeploying

- Reload the form page (and hard refresh: Ctrl+F5).
- If the sheet is still not used, you should see a red toast: *"Could not load next number from sheet. Redeploy Apps Script (getNextSeq) and refresh."*  
  That means the JSONP request failed; fix the deployment and URL as above, then try again.
