// MSWD backend (separate Apps Script project recommended)
// Deploy this as a Web App and use its exec URL in MSWD.html (js/config.js).
//
// Endpoints used by js/MSWD.js (JSONP supported):
// - ?action=ping
// - ?action=getNextSeq&date=YYYYMMDD
// - ?action=checkEligibility&patientName=...&typeOfAssistance=...
// - ?action=getAllRecords
// - (no action) => submit row

var ALLOWED_TOKEN = "REPLACE_WITH_YOUR_SECRET_TOKEN";

// Point this to a *separate* Google Spreadsheet (not the AICS one).
// Example: "1AbC...xyz" (from the Sheet URL).
var MSWD_SPREADSHEET_ID = "REPLACE_WITH_MSWD_SPREADSHEET_ID";

// Tabs are expected like: "MSWD 2026" or "MSWD_2026" (year-based, like AICS).
var SHEET_PREFIX = "MSWD";

function getSpreadsheetOrError() {
  try {
    if (MSWD_SPREADSHEET_ID && MSWD_SPREADSHEET_ID.indexOf("REPLACE_") !== 0) {
      var byId = SpreadsheetApp.openById(MSWD_SPREADSHEET_ID);
      if (!byId) return { ss: null, error: "Could not open MSWD spreadsheet by ID." };
      return { ss: byId, error: null };
    }
    // Fallback: active spreadsheet (useful during initial setup/testing in editor)
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) return { ss: null, error: "No spreadsheet available." };
    return { ss: active, error: null };
  } catch (e) {
    return { ss: null, error: (e && e.message) ? e.message : "Could not access spreadsheet." };
  }
}

function extractYearFromSheetName(sheetName) {
  if (!sheetName || typeof sheetName !== "string") return null;
  var match = String(sheetName).match(/(19|20)\d{2}/);
  return match ? parseInt(match[0], 10) : null;
}

function getCooldownMonths(typeOfAssistance) {
  var t = (typeOfAssistance || "").trim().toLowerCase();
  if (t === "maintenance" || t === "dialysis" || t === "chemotherapy") return 6;
  if (t === "medicine" || t === "laboratory" || t === "hospital bill" || t === "confinement" || t === "others") return 12;
  return null;
}

function formatDateForSheet(d) {
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
}

function formatDateReadable(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
  var tz = Session.getScriptTimeZone() || "Asia/Manila";
  return Utilities.formatDate(d, tz, "MMMM d, yyyy");
}

function jsonResponse(payload, params) {
  params = params || {};
  var callback = params.callback ? String(params.callback).replace(/[^a-zA-Z0-9_.]/g, "") : "";
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(payload) + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getTargetSheetForDate(ss, yyyymmdd) {
  var year = String(yyyymmdd || "").substring(0, 4);
  if (!year) return null;
  return ss.getSheetByName(SHEET_PREFIX + " " + year) || ss.getSheetByName(SHEET_PREFIX + "_" + year);
}

function ensureHeaders(sheet) {
  if (!sheet || sheet.getLastRow() !== 0) return;
  sheet.appendRow([
    "ID Number",
    "Date",
    "Patient / Deceased",
    "Address (Full)",
    "Contact Number",
    "Claimant",
    "Type of Assistance",
    "Code",
    "Remark",
    "Encoded By",
    "Timestamp",
    "Age",
    "Date of Birth",
    "Sex",
    "Civil Status",
    "Educational Attainment",
    "Occupation",
    "4Ps Status",
    "Addr – Number",
    "Addr – Street",
    "Addr – Barangay",
    "Addr – Municipality",
    "Addr – Province",
    "Claimant Last Name",
    "Claimant First Name",
    "Claimant Middle Name"
  ]);
  var h = sheet.getRange(1, 1, 1, 25);
  h.setHorizontalAlignment("center");
  h.setFontSize(12);
  h.setFontWeight("bold");
  h.setFontFamily("Calibri");
}

function getEligibilityPayload(ss, patientName, typeOfAssistance) {
  patientName = (patientName || "").trim();
  typeOfAssistance = (typeOfAssistance || "").trim();
  var payload = { hasRecord: false, lastRequestDate: null, eligibleAgainDate: null, canRequest: true, message: "" };
  if (!patientName || !typeOfAssistance) return payload;

  var cooldownMonths = getCooldownMonths(typeOfAssistance);
  if (cooldownMonths === null) return payload;

  var patientLower = patientName.toLowerCase();
  var today = new Date();
  var maxCooldownMonths = 12;
  var cutoffDate = new Date(today.getTime());
  cutoffDate.setMonth(cutoffDate.getMonth() - maxCooldownMonths);
  var earliestRelevantYear = cutoffDate.getFullYear();
  var minSheetYear = earliestRelevantYear - 1;

  var blockingEligibleDate = null;
  var blockingRequestDate = null;
  var blockingRequestType = null;

  var allSheets = ss.getSheets();
  for (var s = 0; s < allSheets.length; s++) {
    var sh = allSheets[s];
    var name = (sh.getName() || "").trim();
    if (name.indexOf(SHEET_PREFIX + " ") !== 0 && name.indexOf(SHEET_PREFIX + "_") !== 0) continue;
    var sheetYear = extractYearFromSheetName(name);
    if (sheetYear !== null && sheetYear < minSheetYear) continue;

    var lastRow = sh.getLastRow();
    if (lastRow < 2) continue;

    // Columns (same shape as existing AICS): A=ID, B=Date, C=Patient/Deceased, ... , G=Type of Assistance
    var data = sh.getRange(2, 1, lastRow - 1, 7).getValues();
    for (var i = 0; i < data.length; i++) {
      var rowPatient = String(data[i][2] || "").trim();
      if (rowPatient.toLowerCase() !== patientLower) continue;

      var rowType = String(data[i][6] || "").trim();
      var rowCooldown = getCooldownMonths(rowType);
      if (rowCooldown === null) continue;

      var rowDate = data[i][1];
      if (!rowDate) continue;
      var d = rowDate instanceof Date ? rowDate : new Date(rowDate + "T00:00:00");
      if (isNaN(d.getTime())) continue;

      var eligible = new Date(d.getTime());
      eligible.setMonth(eligible.getMonth() + rowCooldown);
      eligible.setDate(eligible.getDate() + 1);

      if (!blockingEligibleDate || eligible > blockingEligibleDate) {
        blockingEligibleDate = eligible;
        blockingRequestDate = d;
        blockingRequestType = rowType;
      }
    }
  }

  if (!blockingEligibleDate) return payload;

  payload.hasRecord = true;
  payload.typeOfAssistance = blockingRequestType;
  payload.lastRequestDate = formatDateForSheet(blockingRequestDate);

  var eligible2 = new Date(blockingEligibleDate.getTime());
  payload.eligibleAgainDate = formatDateForSheet(eligible2);

  today.setHours(0, 0, 0, 0);
  eligible2.setHours(0, 0, 0, 0);
  payload.canRequest = today >= eligible2;

  if (!payload.canRequest) {
    payload.lastRequestDateReadable = formatDateReadable(blockingRequestDate);
    payload.eligibleAgainDateReadable = formatDateReadable(eligible2);
    payload.message = "This patient already has a " + blockingRequestType + " request on " + payload.lastRequestDateReadable +
      ". They may request again on " + payload.eligibleAgainDateReadable + ".";
  }
  return payload;
}

function getCheckEligibilityResponse(ss, params) {
  try {
    var payload = getEligibilityPayload(ss, params.patientName, params.typeOfAssistance);
    return jsonResponse(payload, params);
  } catch (err) {
    var errMsg = (err && err.message) ? err.message : "Server error. Please try again.";
    return jsonResponse({ hasRecord: false, canRequest: true, message: errMsg, eligibilityCheckFailed: true }, params);
  }
}

function getPingResponse(params) {
  return jsonResponse({ status: "ok" }, params);
}

function getGetAllRecordsResponse(ss, params) {
  params = params || {};
  var BATCH_SIZE = 1000;
  try {
    var records = [];
    var now = new Date();
    var fetchedAt = now.toISOString ? now.toISOString() : Utilities.formatDate(now, Session.getScriptTimeZone() || "Asia/Manila", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");

    var cutoffDate = new Date(now.getTime());
    cutoffDate.setMonth(cutoffDate.getMonth() - 12);
    cutoffDate.setHours(0, 0, 0, 0);

    var allSheets = ss.getSheets();
    for (var s = 0; s < allSheets.length; s++) {
      var sh = allSheets[s];
      var sheetName = (sh.getName() || "").trim();
      if (sheetName.indexOf(SHEET_PREFIX + " ") !== 0 && sheetName.indexOf(SHEET_PREFIX + "_") !== 0) continue;

      var lastRow = sh.getLastRow();
      if (lastRow < 2) continue;

      var startRow = 2;
      while (startRow <= lastRow) {
        var endRow = Math.min(startRow + BATCH_SIZE - 1, lastRow);
        var numRows = endRow - startRow + 1;
        var data = sh.getRange(startRow, 1, numRows, 7).getValues();
        for (var i = 0; i < data.length; i++) {
          var row = data[i];
          var dateVal = row[1];
          if (!dateVal) continue;
          var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
          if (isNaN(d.getTime())) continue;
          d.setHours(0, 0, 0, 0);
          if (d < cutoffDate) continue;

          var patient = String(row[2] || "").trim();
          if (!patient) continue;

          records.push({
            patientName: patient,
            date: formatDateForSheet(d),
            typeOfAssistance: String(row[6] || "").trim()
          });
        }
        startRow = endRow + 1;
      }
    }
    return jsonResponse({ fetchedAt: fetchedAt, records: records }, params);
  } catch (err) {
    var errMsg = (err && err.message) ? err.message : "Could not fetch records.";
    return jsonResponse({ fetchedAt: null, records: [], status: "error", message: errMsg }, params);
  }
}

function getNextSequenceResponse(ss, dateYyyymmdd, params) {
  params = params || {};
  try {
    var sheet = getTargetSheetForDate(ss, dateYyyymmdd);
    if (!sheet) {
      // If the year tab doesn't exist yet, start at 1.
      return jsonResponse({ nextSeq: 1 }, params);
    }
    ensureHeaders(sheet);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return jsonResponse({ nextSeq: 1 }, params);

    var idColumn = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var prefix = "AICS-" + String(dateYyyymmdd) + "-";
    var maxSeq = 0;
    for (var i = 0; i < idColumn.length; i++) {
      var id = String(idColumn[i][0] || "").trim();
      if (id.indexOf(prefix) !== 0) continue;
      var parts = id.split("-");
      var seqPart = parts.length === 4 ? parts[3] : parts.length === 3 ? parts[2] : null;
      if (seqPart == null) continue;
      var seq = parseInt(seqPart, 10);
      if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
    }
    return jsonResponse({ nextSeq: maxSeq + 1 }, params);
  } catch (err) {
    var errMsg = (err && err.message) ? err.message : "Could not get next transaction number.";
    return jsonResponse({ nextSeq: null, status: "error", message: errMsg }, params);
  }
}

var SUBMIT_REQUIRED_FIELDS = [
  "idNumber", "date", "patientName", "address",
  "claimantLastName", "claimantFirstName", "typeOfAssistance", "encodedBy"
];
var SUBMIT_FIELD_LABELS = {
  idNumber: "Transaction Number",
  date: "Date",
  patientName: "Name of Patient / Deceased",
  address: "Address",
  claimantLastName: "Claimant (Last name)",
  claimantFirstName: "Claimant (First name)",
  typeOfAssistance: "Type of Assistance",
  encodedBy: "Encoded By"
};

var CONTACT_MAX_LENGTH = 11;
function isValidContactNumber(value) {
  if (!value || typeof value !== "string") return true;
  return String(value).trim().length <= CONTACT_MAX_LENGTH;
}

function validateSubmitParams(params) {
  var missing = [];
  for (var i = 0; i < SUBMIT_REQUIRED_FIELDS.length; i++) {
    var key = SUBMIT_REQUIRED_FIELDS[i];
    var val = params[key];
    if (val === undefined || val === null || String(val).trim() === "") missing.push(SUBMIT_FIELD_LABELS[key] || key);
  }
  if (missing.length > 0) return { valid: false, message: "Missing required fields: " + missing.join(", ") + "." };

  var contactVal = (params.contactNumber || "").trim();
  if (contactVal && !isValidContactNumber(contactVal)) {
    return { valid: false, message: "Contact Number must be at most 11 characters." };
  }
  return { valid: true };
}

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

  var ssResult = getSpreadsheetOrError();
  if (ssResult.error) return jsonResponse({ status: "error", message: ssResult.error }, params);
  var ss = ssResult.ss;

  if (params.action === "ping") return getPingResponse(params);
  if (params.action === "getAllRecords") return getGetAllRecordsResponse(ss, params);
  if (params.action === "getNextSeq" && params.date) return getNextSequenceResponse(ss, params.date, params);
  if (params.action === "checkEligibility") return getCheckEligibilityResponse(ss, params);

  // Submit (no action) — validate required fields and append to MSWD sheet tab for that year.
  var validation = validateSubmitParams(params);
  if (!validation.valid) return jsonResponse({ status: "error", message: validation.message }, params);

  try {
    var yyyymmdd = String(params.date || "").replace(/-/g, "");
    var sheet = getTargetSheetForDate(ss, yyyymmdd);
    if (!sheet) {
      // Auto-create year tab if missing
      var year = String(yyyymmdd).substring(0, 4) || String(new Date().getFullYear());
      sheet = ss.insertSheet(SHEET_PREFIX + " " + year);
    }
    ensureHeaders(sheet);

    // Cooldown block (same logic as AICS: blocks for cooldown types)
    var type = (params.typeOfAssistance || "").trim();
    var eligibility = getEligibilityPayload(ss, params.patientName, type);
    if (eligibility.hasRecord && !eligibility.canRequest) {
      return jsonResponse({ status: "error", message: eligibility.message }, params);
    }

    var last = (params.claimantLastName || "").trim();
    var first = (params.claimantFirstName || "").trim();
    var mid = (params.claimantMiddleName || "").trim();
    var claimantFull = last + (first ? ", " + first : "") + (mid ? " " + mid : "");

    sheet.appendRow([
      params.idNumber,
      params.date,
      params.patientName,
      params.address,
      params.contactNumber || "",
      claimantFull,
      params.typeOfAssistance,
      params.code || "",
      params.remark || "",
      params.encodedBy,
      new Date(),
      params.age || "",
      params.dob || "",
      params.sex || "",
      params.civilStatus || "",
      params.educationalAttainment || "",
      params.occupation || "",
      params.fourPsStatus || "",
      params.addrNumber || "",
      params.addrStreet || "",
      params.addrBarangay || "",
      params.addrMunicipality || "",
      params.addrProvince || "",
      last,
      first,
      mid
    ]);

    var lr = sheet.getLastRow();
    sheet.getRange(lr, 1, 1, 25).setHorizontalAlignment("center").setFontSize(11).setFontFamily("Calibri");
    return jsonResponse({ status: "success" }, params);
  } catch (err) {
    var errMsg = (err && err.message) ? err.message : "Server error. Please try again.";
    return jsonResponse({ status: "error", message: errMsg }, params);
  }
}

