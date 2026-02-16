/** Cooldown months per type. Burial has no cooldown (null). Medicine is 12 months. */
function getCooldownMonths(typeOfAssistance) {
  var t = (typeOfAssistance || "").trim();
  if (t === "Maintenance" || t === "Dialysis" || t === "Chemotherapy") return 6;
  if (t === "Medicine") return 12;
  return null; // Burial or unknown: no cooldown
}

/**
 * Compute eligibility for patient + type (cooldown). Returns payload object only.
 * Used by getCheckEligibilityResponse and by doGet before appending a new row.
 */
function getEligibilityPayload(sheet, patientName, typeOfAssistance) {
  var lastRow = sheet.getLastRow();
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

  if (lastRow < 2) return payload;

  // Columns: A=ID, B=Date, C=Patient, ..., G=Type of Assistance
  var data = sheet.getRange(2, 1, lastRow, 7).getValues();
  var lastRequestDate = null;
  for (var i = 0; i < data.length; i++) {
    var rowPatient = String(data[i][2] || "").trim();
    var rowType = String(data[i][6] || "").trim();
    if (rowPatient.toLowerCase() !== patientName.toLowerCase() || rowType !== typeOfAssistance) continue;
    var rowDate = data[i][1];
    if (!rowDate) continue;
    var d = rowDate instanceof Date ? rowDate : new Date(rowDate + "T00:00:00");
    if (isNaN(d.getTime())) continue;
    if (!lastRequestDate || d > lastRequestDate) lastRequestDate = d;
  }

  if (!lastRequestDate) return payload;

  payload.hasRecord = true;
  var lastStr = formatDateForSheet(lastRequestDate);
  payload.lastRequestDate = lastStr;

  var eligible = new Date(lastRequestDate.getTime());
  eligible.setMonth(eligible.getMonth() + cooldownMonths);
  eligible.setDate(eligible.getDate() + 1);
  payload.eligibleAgainDate = formatDateForSheet(eligible);

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  eligible.setHours(0, 0, 0, 0);
  payload.canRequest = today >= eligible;
  if (payload.canRequest) {
    payload.message = "A previous " + typeOfAssistance + " request was recorded. You may submit a new request (a new record will be created).";
  } else {
    payload.typeOfAssistance = typeOfAssistance;
    payload.lastRequestDateReadable = formatDateReadable(lastRequestDate);
    payload.eligibleAgainDateReadable = formatDateReadable(eligible);
    payload.message = "This patient already has a " + typeOfAssistance + " request on " + payload.lastRequestDateReadable + ". They may request again on " + payload.eligibleAgainDateReadable + ".";
  }
  return payload;
}

/**
 * Check if patient can request again for this type.
 * Returns JSON(P): hasRecord, lastRequestDate, eligibleAgainDate, canRequest, message.
 * Query: ?action=checkEligibility&patientName=...&typeOfAssistance=...
 */
function getCheckEligibilityResponse(params) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var payload = getEligibilityPayload(sheet, params.patientName, params.typeOfAssistance);
  return jsonResponse(payload, params);
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

function doGet(e) {
  var params = e.parameter;

  // Endpoint: get next transaction sequence for a date (source of truth from sheet)
  if (params.action === "getNextSeq" && params.date) {
    return getNextSequenceResponse(params.date, params);
  }

  if (params.action === "checkEligibility") {
    return getCheckEligibilityResponse(params);
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // Cooldown: for non-Burial types, block submission if patient is still in cooldown
  var typeOfAssistance = (params.typeOfAssistance || "").trim();
  if (typeOfAssistance !== "Burial") {
    var eligibility = getEligibilityPayload(sheet, params.patientName, typeOfAssistance);
    if (eligibility.hasRecord && !eligibility.canRequest) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: eligibility.message }))
        .setMimeType(ContentService.MimeType.JSON);
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
  dRange.setFontSize(12);
  dRange.setFontFamily("Calibri");

  return ContentService
    .createTextOutput(JSON.stringify({ status: "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Returns the next sequence number for transaction IDs on the given date.
 * Reads ID Number column (A); IDs are AICS-YYYYMMDD-XX-NNN. Finds max NNN for that date.
 * Query: ?action=getNextSeq&date=20260216
 */
function getNextSequenceResponse(dateYyyymmdd, params) {
  params = params || {};
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
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
