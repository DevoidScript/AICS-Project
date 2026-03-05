var ALLOWED_TOKEN = "9472418d6b1d85c7492fc89f6cc199cbef3f2f2fe8d3fe35a677c31efa0778d1";
/**
 * Returns the active sheet or an error message. Use this to guard against null spreadsheet/sheet.
 * @returns {{ sheet: Sheet | null, error: string | null }}
 */
function getSheetOrError() {
  try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) return { sheet: null, error: "No spreadsheet available." };
    var sheet = ss.getActiveSheet();
    if (!sheet) return { sheet: null, error: "No sheet available." };
    return { sheet: sheet, error: null };
  } catch (e) {
    return { sheet: null, error: (e && e.message) ? e.message : "Could not access spreadsheet." };
  }
}

function getCooldownMonths(typeOfAssistance) {
  var t = (typeOfAssistance || "").trim().toLowerCase();

  if (
    t.includes("maintenance") ||
    t.includes("dialysis") ||
    t.includes("chemotherapy")
  ) return 6;

  if (
    t.includes("medicine") ||
    t.includes("laboratory") ||
    t.includes("hospital bill") ||
    t.includes("confinement") ||
    t.includes("others")
  ) return 12;

  // Legacy "Others" entries stored as long descriptions (old records)
  // that don't match any known type above are treated as Others (12 months)
  if (
    t.includes("referral") ||
    t.includes("survivor") ||
    t.includes("detained") ||
    t.includes("peso") ||
    t.includes("letter") ||
    t.includes("refer") ||
    t.includes("partially") 
    // Add more legacy keywords here as needed
  ) return 12;

  return null;
}

/**
 * Normalizes a stored type of assistance label for display in messages.
 * Known proper types are returned as-is (trimmed).
 * Legacy long descriptions (old records) are simplified to "Others".
 */
function normalizeTypeLabel(typeOfAssistance) {
  var t = (typeOfAssistance || "").trim().toLowerCase();

  if (
    t.includes("medicine") ||
    t.includes("laboratory") ||
    t.includes("hospital bill") ||
    t.includes("confinement") ||
    t.includes("maintenance") ||
    t.includes("dialysis") ||
    t.includes("chemotherapy") ||
    t.includes("burial") ||
    t.includes("others")
  ) {
    return (typeOfAssistance || "").trim();
  }

  // Anything unrecognized (legacy long descriptions) = "Others"
  return "Others";
}

/**
 * Extracts 4-digit year from sheet name (e.g. "AICS 2025" -> 2025). Returns null if not found.
 */
function extractYearFromSheetName(sheetName) {
  if (!sheetName || typeof sheetName !== "string") return null;
  var match = String(sheetName).match(/(19|20)\d{2}/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Compute eligibility for patient + type (cooldown). Returns payload object only.
 * Used by getCheckEligibilityResponse and by doGet before appending a new row.
 * Matches on Patient/Deceased (column C), NOT Claimant. Type of Assistance (column G).
 * Searches ALL relevant sheets (skips sheets too old based on cooldown).
 */
function getEligibilityPayload(sheet, patientName, typeOfAssistance) {
  patientName = (patientName || "").trim();
  typeOfAssistance = (typeOfAssistance || "").trim();
  var payload = { hasRecord: false, lastRequestDate: null, eligibleAgainDate: null, canRequest: true, message: "" };

  if (!patientName || !typeOfAssistance) {
    payload.message = "Patient name and type of assistance are required.";
    return payload;
  }

  var cooldownMonths = getCooldownMonths(typeOfAssistance);
  if (cooldownMonths === null) {
    payload.message = "This type has no cooldown restriction.";
    return payload;
  }

  // earliestRelevantYear = year of (today - max cooldown months among types). Min sheet year = that - 1 (buffer).
  var today = new Date();
  var maxCooldownMonths = 12; // current maximum across assistance types with cooldown
  var cutoffDate = new Date(today.getTime());
  cutoffDate.setMonth(cutoffDate.getMonth() - maxCooldownMonths);
  var earliestRelevantYear = cutoffDate.getFullYear();
  var minSheetYear = earliestRelevantYear - 1;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allSheets = ss.getSheets();

  var patientLower = patientName.toLowerCase();
  var blockingEligibleDate = null;
  var blockingRequestDate = null;
  var blockingRequestType = null;

  // Columns: A=ID, B=Date, C=Patient/Deceased, D=Address, E=Contact, F=Claimant, G=Type of Assistance
  for (var s = 0; s < allSheets.length; s++) {
    var currentSheet = allSheets[s];
    var sheetYear = extractYearFromSheetName(currentSheet.getName());
    if (sheetYear !== null && sheetYear < minSheetYear) continue; // Skip sheets too old
    var lastRow = currentSheet.getLastRow();
    if (lastRow < 2) continue;

    var data = currentSheet.getRange(2, 1, lastRow - 1, 7).getValues();
    for (var i = 0; i < data.length; i++) {
      var rowPatient = String(data[i][2] || "").trim();  // Column C = Patient/Deceased
      var rowType = String(data[i][6] || "").trim();
      if (rowPatient.toLowerCase() !== patientLower) continue;

      var rowCooldown = getCooldownMonths(rowType);
      if (rowCooldown === null) continue; // types with no cooldown (e.g., Burial) do not block

      var rowDate = data[i][1];
      if (!rowDate) continue;
      var d = rowDate instanceof Date ? rowDate : new Date(rowDate + "T00:00:00");
      if (isNaN(d.getTime())) continue;

      var rowEligible = new Date(d.getTime());
      rowEligible.setMonth(rowEligible.getMonth() + rowCooldown);
      rowEligible.setDate(rowEligible.getDate() + 1);

      // Track the latest eligibility date; new requests are allowed only after all cooldowns have expired.
      if (!blockingEligibleDate || rowEligible > blockingEligibleDate) {
        blockingEligibleDate = rowEligible;
        blockingRequestDate = d;
        blockingRequestType = rowType;
      }
    }
  }

  if (!blockingEligibleDate) return payload;

  payload.hasRecord = true;
  payload.typeOfAssistance = blockingRequestType;
  var lastStr = formatDateForSheet(blockingRequestDate);
  payload.lastRequestDate = lastStr;

  var eligible = new Date(blockingEligibleDate.getTime());
  payload.eligibleAgainDate = formatDateForSheet(eligible);

  today.setHours(0, 0, 0, 0);
  eligible.setHours(0, 0, 0, 0);
  payload.canRequest = today >= eligible;
  if (payload.canRequest) {
    payload.message = "A previous " + blockingRequestType + " request was recorded. You may submit a new " + typeOfAssistance + " request.";
  } else {
    payload.lastRequestDateReadable = formatDateReadable(blockingRequestDate);
    payload.eligibleAgainDateReadable = formatDateReadable(eligible);
    payload.message = "This patient already has a " + blockingRequestType + " request on " + payload.lastRequestDateReadable + ". They may request " + typeOfAssistance + " on " + payload.eligibleAgainDateReadable + ".";
  }
  return payload;
}

/**
 * Check if patient can request again for this type.
 * Returns JSON(P): hasRecord, lastRequestDate, eligibleAgainDate, canRequest, message.
 * Query: ?action=checkEligibility&patientName=...&typeOfAssistance=...
 * Matching is case-insensitive; patient/deceased is the main check.
 * On server error returns eligibilityCheckFailed: true so the client can show a clear message.
 */
function getCheckEligibilityResponse(params) {
  try {
    var sheetResult = getSheetOrError();
    if (sheetResult.error) {
      return jsonResponse({
        hasRecord: false,
        canRequest: true,
        message: sheetResult.error,
        eligibilityCheckFailed: true
      }, params);
    }
    var payload = getEligibilityPayload(sheetResult.sheet, params.patientName, params.typeOfAssistance);
    return jsonResponse(payload, params);
  } catch (err) {
    var errMsg = "Server error. Please try again.";
    if (err && err.message) errMsg = err.message;
    return jsonResponse({
      hasRecord: false,
      canRequest: true,
      message: errMsg,
      eligibilityCheckFailed: true
    }, params);
  }
}

function formatDateForSheet(d) {
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
}

/** Format date for user-facing messages: "Month Day, Year" e.g. "August 17, 2026". */
function formatDateReadable(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
  var tz = Session.getScriptTimeZone() || "Asia/Manila";
  return Utilities.formatDate(d, tz, "MMMM d, yyyy");
}

function jsonResponse(payload, params) {
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

/** Required fields for form submission; keys are param names, values are labels for error messages. */
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

/** Max length for contact number. */
var CONTACT_MAX_LENGTH = 11;

function isValidContactNumber(value) {
  if (!value || typeof value !== "string") return true; // empty is OK (optional field)
  return String(value).trim().length <= CONTACT_MAX_LENGTH;
}

/**
 * Validates required submission params. Returns { valid: true } or { valid: false, message: string }.
 * Contact number, when provided, must be at most 11 characters.
 */
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
    return {
      valid: false,
      message: "Contact Number must be at most 11 characters."
    };
  }
  return { valid: true };
}

/**
 * Returns ALL records from ALL AICS sheets for offline cache (3 fields only).
 * Reads each sheet in batches to avoid limits and ensure every row is included.
 * Query: ?action=getAllRecords
 * Response: { fetchedAt: "ISO date", records: [ { patientName, date, typeOfAssistance }, ... ] }
 */
function getGetAllRecordsResponse(params) {
  params = params || {};
  var BATCH_SIZE = 1000;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return jsonResponse({ fetchedAt: null, records: [], status: "error", message: "No spreadsheet." }, params);
    }
    var allSheets = ss.getSheets();
    var records = [];
    var now = new Date();
    var fetchedAt = now.toISOString ? now.toISOString() : Utilities.formatDate(now, Session.getScriptTimeZone() || "Asia/Manila", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");

    // Cutoff: only include rows from the last 12 months
    var cutoffDate = new Date(now.getTime());
    cutoffDate.setMonth(cutoffDate.getMonth() - 12);
    cutoffDate.setHours(0, 0, 0, 0);

    for (var s = 0; s < allSheets.length; s++) {
      var sheet = allSheets[s];
      var sheetName = sheet.getName().trim();
      if (sheetName.indexOf("AICS_") !== 0 && sheetName.indexOf("AICS ") !== 0) continue;
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) continue;

      var startRow = 2;
      while (startRow <= lastRow) {
        var endRow = Math.min(startRow + BATCH_SIZE - 1, lastRow);
        var numRows = endRow - startRow + 1;
        var data = sheet.getRange(startRow, 1, numRows, 7).getValues();
        for (var i = 0; i < data.length; i++) {
          var row = data[i];

          var dateVal = row[1];
          if (!dateVal) continue;

          var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
          if (isNaN(d.getTime())) continue;
          d.setHours(0, 0, 0, 0);

          // Skip records older than 12 months from today
          if (d < cutoffDate) continue;

          var patientName = String(row[2] || "").trim();
          if (!patientName) continue; // only cache rows that have a patient/deceased name

          var y = d.getFullYear();
          var m = d.getMonth() + 1;
          var day = d.getDate();
          var dateStr = y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;

          var typeOfAssistance = String(row[6] || "").trim();
          records.push({ patientName: patientName, date: dateStr, typeOfAssistance: typeOfAssistance });
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

/**
 * Ping endpoint to confirm real connectivity (for offline detection).
 * Query: ?action=ping
 */
function getPingResponse(params) {
  params = params || {};
  return jsonResponse({ status: "ok" }, params);
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
  // ── End security check ──

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

  if (params.action === "ping") {
    return getPingResponse(params);
  }

  if (params.action === "getAllRecords") {
    return getGetAllRecordsResponse(params);
  }

  // Endpoint: get next transaction sequence for a date (source of truth from sheet)
  if (params.action === "getNextSeq" && params.date) {
    return getNextSequenceResponse(params.date, params);
  }

  if (params.action === "checkEligibility") {
    return getCheckEligibilityResponse(params);
  }

  // Form submission: validate required fields first, then guard sheet, then append row
  var validation = validateSubmitParams(params);
  if (!validation.valid) {
    return jsonResponse({ status: "error", message: validation.message }, params);
  }

  try {
    var sheetResult = getSheetOrError();
    if (sheetResult.error) {
      return jsonResponse({ status: "error", message: sheetResult.error }, params);
    }
    var sheet = sheetResult.sheet;

    // Prevent insertions into AICS_2025; use AICS_2026 for new entries (continuous use)
    var sheetName = sheet.getName().trim();
    if (sheetName === "AICS_2025" || sheetName === "AICS 2025") {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var targetSheet = ss.getSheetByName("AICS_2026") || ss.getSheetByName("AICS 2026");
      if (targetSheet) sheet = targetSheet;
    }

    // Cooldown: for non-Burial types, block submission if patient is still in cooldown
    var typeOfAssistance = (params.typeOfAssistance || "").trim();
    if (typeOfAssistance !== "Burial") {
      var eligibility = getEligibilityPayload(sheet, params.patientName, typeOfAssistance);
      if (eligibility.hasRecord && !eligibility.canRequest) {
        return jsonResponse({ status: "error", message: eligibility.message }, params);
      }
    }

    // Build claimant full name from Last, First, Middle (same format as form)
    var last = (params.claimantLastName || "").trim();
    var first = (params.claimantFirstName || "").trim();
    var mid = (params.claimantMiddleName || "").trim();
    var claimantFull = last + (first ? ", " + first : "") + (mid ? " " + mid : "");

    // Auto-create headers on first submission
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "ID Number",
        "Date",
        "Patient / Deceased",
        "Address",
        "Contact Number",
        "Claimant",
        "Type of Assistance",
        "Code",
        "Remark",
        "Encoded By",
        "Timestamp"
      ]);
      var hRange = sheet.getRange(1, 1, 1, 11);
      hRange.setHorizontalAlignment("center");
      hRange.setFontSize(12);
      hRange.setFontWeight("bold");
      hRange.setFontFamily("Calibri");
    }

    // Insert the data row (claimant as full name: "Last, First Middle")
    sheet.appendRow([
      params.idNumber,
      params.date,
      params.patientName,
      params.address,
      params.contactNumber || "",
      claimantFull,
      params.typeOfAssistance,
      params.code,
      params.remark,
      params.encodedBy,
      new Date()
    ]);

    // Format the newly inserted data row
    var lastRow = sheet.getLastRow();
    var dRange = sheet.getRange(lastRow, 1, lastRow, 11);
    dRange.setHorizontalAlignment("center");
    dRange.setFontSize(11);
    dRange.setFontFamily("Calibri");
    dRange.setFontWeight("normal");

    return jsonResponse({ status: "success" }, params);
  } catch (err) {
    var errMsg = "Server error. Please try again.";
    if (err && err.message) {
      errMsg = err.message;
    }
    return jsonResponse({ status: "error", message: errMsg }, params);
  }
}

/**
 * Returns the next sequence number for transaction IDs on the given date.
 * Reads ID Number column (A); IDs are AICS-YYYYMMDD-NNN. Finds max NNN for that date.
 * Query: ?action=getNextSeq&date=20260216
 * On error (null sheet or exception) returns { nextSeq: null, status: "error", message: "..." } so client can show it.
 */
function getNextSequenceResponse(dateYyyymmdd, params) {
  params = params || {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return jsonResponse({ nextSeq: null, status: "error", message: "No spreadsheet available." }, params);
    }
    var year = String(dateYyyymmdd || "").substring(0, 4);
    var sheet = year ? ss.getSheetByName("AICS " + year) || ss.getSheetByName("AICS_" + year) : null;
    if (!sheet) {
      var sheetResult = getSheetOrError();
      if (sheetResult.error) {
        return jsonResponse({ nextSeq: null, status: "error", message: sheetResult.error }, params);
      }
      sheet = sheetResult.sheet;
    }
    var lastRow = sheet.getLastRow();
    var payload;
    if (lastRow < 2) {
      payload = { nextSeq: 1 };
    } else {
      var idColumn = sheet.getRange(2, 1, lastRow, 1).getValues();
      var prefix = "AICS-" + String(dateYyyymmdd) + "-";
      var maxSeq = 0;
      for (var i = 0; i < idColumn.length; i++) {
        var id = String(idColumn[i][0] || "").trim();
        if (id.indexOf(prefix) === 0) {
          var parts = id.split("-");
          var seqPart = parts.length === 4 ? parts[3] : parts.length === 3 ? parts[2] : null;
          if (seqPart != null) {
            var seq = parseInt(seqPart, 10);
            if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
          }
        }
      }
      payload = { nextSeq: maxSeq + 1 };
    }
    return jsonResponse(payload, params);
  } catch (err) {
    var errMsg = (err && err.message) ? err.message : "Could not get next transaction number.";
    return jsonResponse({ nextSeq: null, status: "error", message: errMsg }, params);
  }
}
