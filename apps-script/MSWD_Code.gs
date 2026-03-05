// ============================================================
//  MSWD_Code.gs  –  Backend for MSWD.html
//  Deploy as a Web App (Execute as: Me, Access: Anyone)
//  and paste its /exec URL into js/config.js (APPS_SCRIPT_URL).
// ============================================================
//
//  Endpoints (used by js/MSWD.js – JSONP supported):
//    ?action=ping
//    ?action=getNextSeq&date=YYYYMMDD
//    ?action=checkEligibility&patientName=...&typeOfAssistance=...
//    ?action=getAllRecords
//    (no action)  =>  submit row
//
// ============================================================

var ALLOWED_TOKEN        = "REPLACE_WITH_YOUR_SECRET_TOKEN";
var MSWD_SPREADSHEET_ID  = "REPLACE_WITH_MSWD_SPREADSHEET_ID";
var SHEET_PREFIX         = "MSWD";

// ── Column map (1-based).  ALL layout changes live here. ─────────────────────
//
//  A  – ID Number          │ light blue   ─┐ Record Identification
//  B  – Date               │ light blue    │
//  C  – Code               │ light blue    │
//  D  – Timestamp          │ light blue   ─┘
//  E  – Patient / Deceased │ light green
//  F  – Claimant           │ light yellow  (Last, First Middle – merged)
//  G  – Contact #          │ light purple ─┐ Contact & Address
//  H  – Address            │ light purple ─┘ (full concatenated)
//  I  – Age                │ light orange ─┐ Demographics
//  J  – Date of Birth      │ light orange  │
//  K  – Sex                │ light orange  │
//  L  – Civil Status       │ light orange  │
//  M  – Educational Att.   │ light orange  │
//  N  – Occupation         │ light orange  │
//  O  – 4Ps Status         │ light orange ─┘
//  P  – Type of Assistance │ light red/pink─┐ Assistance Details
//  Q  – Remark             │ light red/pink─┘
//  R  – Encoded By         │ light teal
//
var COL = {
  // A–D  Record Identification
  ID_NUMBER:              1,
  DATE:                   2,
  CODE:                   3,
  TIMESTAMP:              4,   // locked at submission time, never overwritten

  // E  Patient Name
  PATIENT_NAME:           5,

  // F  Claimant (merged: "Last, First Middle")
  CLAIMANT:               6,

  // G–H  Contact & Address
  CONTACT_NUMBER:         7,
  ADDRESS:                8,   // full concatenated address

  // I–O  Demographics
  AGE:                    9,
  DATE_OF_BIRTH:          10,
  SEX:                    11,
  CIVIL_STATUS:           12,
  EDUCATIONAL_ATTAINMENT: 13,
  OCCUPATION:             14,
  FOUR_PS_STATUS:         15,

  // P–Q  Assistance Details
  TYPE_OF_ASSISTANCE:     16,
  REMARK:                 17,

  // R  Encoded By
  ENCODED_BY:             18
};

// ── Header labels (parallel to COL values, A–Q) ──────────────────────────────
var HEADERS = [
  "ID Number",              // A
  "Date",                   // B
  "Code",                   // C
  "Timestamp",              // D
  "Patient / Deceased",     // E
  "Claimant",               // F
  "Contact #",              // G
  "Address",                // H
  "Age",                    // I
  "Date of Birth",          // J
  "Sex",                    // K
  "Civil Status",           // L
  "Educational Attainment", // M
  "Occupation",             // N
  "4Ps Status",             // O
  "Type of Assistance",     // P
  "Remark",                 // Q
  "Encoded By"              // R
];

// ── Column-group colour bands ────────────────────────────────────────────────
var HEADER_GROUPS = [
  { start:  1, end:  4, bg: "#CFE2F3", fg: "#1C4587", label: "Record Identification" },
  { start:  5, end:  5, bg: "#D9EAD3", fg: "#274E13", label: "Patient"               },
  { start:  6, end:  6, bg: "#FFF2CC", fg: "#7F6000", label: "Claimant"              },
  { start:  7, end:  8, bg: "#E1D0F0", fg: "#20124D", label: "Contact & Address"     },
  { start:  9, end: 15, bg: "#FCE5CD", fg: "#7F3B00", label: "Demographics"          },
  { start: 16, end: 17, bg: "#F4CCCC", fg: "#660000", label: "Assistance Details"    },
  { start: 18, end: 18, bg: "#D0E4E4", fg: "#0C343D", label: "Encoded By"            }
];

// ── Column widths (pixels) ───────────────────────────────────────────────────
var COL_WIDTHS = {
  1:  150,  // A – ID Number
  2:  100,  // B – Date
  3:   80,  // C – Code
  4:  160,  // D – Timestamp
  5:  200,  // E – Patient / Deceased
  6:  220,  // F – Claimant
  7:  120,  // G – Contact #
  8:  280,  // H – Address
  9:   55,  // I – Age
  10: 110,  // J – Date of Birth
  11:  75,  // K – Sex
  12: 150,  // L – Civil Status
  13: 190,  // M – Educational Attainment
  14: 170,  // N – Occupation
  15: 100,  // O – 4Ps Status
  16: 150,  // P – Type of Assistance
  17: 180,  // Q – Remark
  18: 140   // R – Encoded By
};

// ── Row heights ──────────────────────────────────────────────────────────────
var HEADER_ROW_HEIGHT = 40;  // px – taller for wrapped header text
var DATA_ROW_HEIGHT   = 22;  // px – standard row

// ────────────────────────────────────────────────────────────────────────────
//  Spreadsheet access
// ────────────────────────────────────────────────────────────────────────────
function getSpreadsheetOrError() {
  try {
    if (MSWD_SPREADSHEET_ID && MSWD_SPREADSHEET_ID.indexOf("REPLACE_") !== 0) {
      var byId = SpreadsheetApp.openById(MSWD_SPREADSHEET_ID);
      if (!byId) return { ss: null, error: "Could not open MSWD spreadsheet by ID." };
      return { ss: byId, error: null };
    }
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) return { ss: null, error: "No spreadsheet available." };
    return { ss: active, error: null };
  } catch (e) {
    return { ss: null, error: (e && e.message) ? e.message : "Could not access spreadsheet." };
  }
}

function getTargetSheetForDate(ss, yyyymmdd) {
  var year = String(yyyymmdd || "").substring(0, 4);
  if (!year) return null;
  return ss.getSheetByName(SHEET_PREFIX + " " + year)
      || ss.getSheetByName(SHEET_PREFIX + "_" + year);
}

function extractYearFromSheetName(name) {
  if (!name || typeof name !== "string") return null;
  var m = String(name).match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

// ────────────────────────────────────────────────────────────────────────────
//  Sheet initialisation – title row + header row + formatting
// ────────────────────────────────────────────────────────────────────────────
function ensureHeaders(sheet) {
  if (!sheet || sheet.getLastRow() !== 0) return;

  // ── Row 1: Title bar ──────────────────────────────────────────────────────
  sheet.appendRow(["MSWD"]);  // content in A1; rest will be merged over

  var titleRange = sheet.getRange(1, 1, 1, HEADERS.length);
  titleRange
    .merge()
    .setValue("MSWD")
    .setBackground("#FFD966")       // same gold tone visible in your screenshot
    .setFontColor("#000000")
    .setFontFamily("Calibri")
    .setFontSize(16)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 36);

  // ── Row 2: Column headers ─────────────────────────────────────────────────
  sheet.appendRow(HEADERS);

  var headerRange = sheet.getRange(2, 1, 1, HEADERS.length);
  headerRange
    .setFontFamily("Calibri")
    .setFontSize(11)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);

  // Colour-band each group
  HEADER_GROUPS.forEach(function (g) {
    sheet.getRange(2, g.start, 1, g.end - g.start + 1)
      .setBackground(g.bg)
      .setFontColor(g.fg);
  });

  // Thick bottom border to separate headers from data
  headerRange.setBorder(
    false, false, true, false, false, false,
    "#555555",
    SpreadsheetApp.BorderStyle.SOLID_MEDIUM
  );
  sheet.setRowHeight(2, HEADER_ROW_HEIGHT);

  // ── Freeze rows 1 & 2 so both title and headers stay visible ─────────────
  sheet.setFrozenRows(2);

  // ── Column widths ─────────────────────────────────────────────────────────
  for (var col = 1; col <= HEADERS.length; col++) {
    if (COL_WIDTHS[col]) sheet.setColumnWidth(col, COL_WIDTHS[col]);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Data-row formatter  (called after every appendRow)
// ────────────────────────────────────────────────────────────────────────────
function formatDataRow(sheet, rowIndex) {
  var range = sheet.getRange(rowIndex, 1, 1, HEADERS.length);

  // Base style — applied to every cell in the row
  range
    .setFontFamily("Calibri")
    .setFontSize(14)
    .setFontWeight("normal")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("bottom")
    .setWrap(true);

  // Zebra striping — data starts at row 3
  if ((rowIndex % 2) === 1) {
    range.setBackground("#F8F8F8");
  } else {
    range.setBackground("#FFFFFF");
  }

  // Date column: format as "YYYY-MM-DD"
  sheet.getRange(rowIndex, COL.DATE)
       .setNumberFormat("YYYY-MM-DD");

  // Timestamp column: exact submission datetime
  sheet.getRange(rowIndex, COL.TIMESTAMP)
       .setNumberFormat("YYYY-MM-DD HH:mm:ss");

  // DOB column
  sheet.getRange(rowIndex, COL.DATE_OF_BIRTH)
       .setNumberFormat("YYYY-MM-DD");

  // Row height
  sheet.setRowHeight(rowIndex, DATA_ROW_HEIGHT);
}

// ────────────────────────────────────────────────────────────────────────────
//  Date helpers
// ────────────────────────────────────────────────────────────────────────────
function formatDateForSheet(d) {
  var y   = d.getFullYear();
  var m   = d.getMonth() + 1;
  var day = d.getDate();
  return y + "-" + (m   < 10 ? "0" : "") + m   +
             "-" + (day < 10 ? "0" : "") + day;
}

function formatDateReadable(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
  var tz = Session.getScriptTimeZone() || "Asia/Manila";
  return Utilities.formatDate(d, tz, "MMMM d, yyyy");
}

// ────────────────────────────────────────────────────────────────────────────
//  Cooldown logic
// ────────────────────────────────────────────────────────────────────────────
function getCooldownMonths(typeOfAssistance) {
  var t = (typeOfAssistance || "").trim().toLowerCase();
  if (t === "maintenance" || t === "dialysis" || t === "chemotherapy") return 6;
  if (t === "medicine"    || t === "laboratory" ||
      t === "hospital bill"|| t === "confinement" || t === "others")   return 12;
  return null;
}

function getEligibilityPayload(ss, patientName, typeOfAssistance) {
  patientName       = (patientName       || "").trim();
  typeOfAssistance  = (typeOfAssistance  || "").trim();

  var payload = {
    hasRecord: false, lastRequestDate: null,
    eligibleAgainDate: null, canRequest: true, message: ""
  };
  if (!patientName || !typeOfAssistance) return payload;

  var cooldownMonths = getCooldownMonths(typeOfAssistance);
  if (cooldownMonths === null) return payload;

  var patientLower = patientName.toLowerCase();
  var today        = new Date();
  var cutoffDate   = new Date(today.getTime());
  cutoffDate.setMonth(cutoffDate.getMonth() - 12);
  var minSheetYear = cutoffDate.getFullYear() - 1;

  var blockingEligibleDate = null;
  var blockingRequestDate  = null;
  var blockingRequestType  = null;

  var allSheets = ss.getSheets();
  for (var s = 0; s < allSheets.length; s++) {
    var sh   = allSheets[s];
    var name = (sh.getName() || "").trim();
    if (name.indexOf(SHEET_PREFIX + " ") !== 0 &&
        name.indexOf(SHEET_PREFIX + "_") !== 0) continue;

    var sheetYear = extractYearFromSheetName(name);
    if (sheetYear !== null && sheetYear < minSheetYear) continue;

    var lastRow = sh.getLastRow();
    if (lastRow < 3) continue;

    // Read only the columns we need for eligibility.
    // Row 1 = title, Row 2 = headers, data starts at row 3.
    var data = sh.getRange(3, 1, lastRow - 2, COL.TYPE_OF_ASSISTANCE).getValues();
    for (var i = 0; i < data.length; i++) {
      var rowPatient = String(data[i][COL.PATIENT_NAME - 1]  || "").trim();
      if (rowPatient.toLowerCase() !== patientLower) continue;

      var rowType     = String(data[i][COL.TYPE_OF_ASSISTANCE - 1] || "").trim();
      var rowCooldown = getCooldownMonths(rowType);
      if (rowCooldown === null) continue;

      var rowDate = data[i][COL.DATE - 1];
      if (!rowDate) continue;
      var d = rowDate instanceof Date ? rowDate : new Date(rowDate + "T00:00:00");
      if (isNaN(d.getTime())) continue;

      var eligible = new Date(d.getTime());
      eligible.setMonth(eligible.getMonth() + rowCooldown);
      eligible.setDate(eligible.getDate() + 1);

      if (!blockingEligibleDate || eligible > blockingEligibleDate) {
        blockingEligibleDate = eligible;
        blockingRequestDate  = d;
        blockingRequestType  = rowType;
      }
    }
  }

  if (!blockingEligibleDate) return payload;

  payload.hasRecord         = true;
  payload.typeOfAssistance  = blockingRequestType;
  payload.lastRequestDate   = formatDateForSheet(blockingRequestDate);

  var eligible2 = new Date(blockingEligibleDate.getTime());
  payload.eligibleAgainDate = formatDateForSheet(eligible2);

  today.setHours(0, 0, 0, 0);
  eligible2.setHours(0, 0, 0, 0);
  payload.canRequest = today >= eligible2;

  if (!payload.canRequest) {
    payload.lastRequestDateReadable   = formatDateReadable(blockingRequestDate);
    payload.eligibleAgainDateReadable = formatDateReadable(eligible2);
    payload.message =
      "This patient already has a " + blockingRequestType + " request on " +
      payload.lastRequestDateReadable +
      ". They may request again on " + payload.eligibleAgainDateReadable + ".";
  }
  return payload;
}

// ────────────────────────────────────────────────────────────────────────────
//  JSON / JSONP response helper
// ────────────────────────────────────────────────────────────────────────────
function jsonResponse(payload, params) {
  params   = params || {};
  var cb   = params.callback ? String(params.callback).replace(/[^a-zA-Z0-9_.]/g, "") : "";
  var body = JSON.stringify(payload);
  if (cb) {
    return ContentService
      .createTextOutput(cb + "(" + body + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

// ────────────────────────────────────────────────────────────────────────────
//  Action handlers
// ────────────────────────────────────────────────────────────────────────────
function getPingResponse(params) {
  return jsonResponse({ status: "ok" }, params);
}

function getCheckEligibilityResponse(ss, params) {
  try {
    return jsonResponse(
      getEligibilityPayload(ss, params.patientName, params.typeOfAssistance),
      params
    );
  } catch (err) {
    return jsonResponse(
      { hasRecord: false, canRequest: true,
        message: (err && err.message) ? err.message : "Server error.",
        eligibilityCheckFailed: true },
      params
    );
  }
}

function getGetAllRecordsResponse(ss, params) {
  params = params || {};
  var BATCH_SIZE = 1000;
  try {
    var records  = [];
    var now      = new Date();
    var fetchedAt = now.toISOString
        ? now.toISOString()
        : Utilities.formatDate(now, Session.getScriptTimeZone() || "Asia/Manila",
                               "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");

    var cutoffDate = new Date(now.getTime());
    cutoffDate.setMonth(cutoffDate.getMonth() - 12);
    cutoffDate.setHours(0, 0, 0, 0);

    var allSheets = ss.getSheets();
    for (var s = 0; s < allSheets.length; s++) {
      var sh        = allSheets[s];
      var sheetName = (sh.getName() || "").trim();
      if (sheetName.indexOf(SHEET_PREFIX + " ") !== 0 &&
          sheetName.indexOf(SHEET_PREFIX + "_") !== 0) continue;

      var lastRow = sh.getLastRow();
      if (lastRow < 3) continue;

      var startRow = 3;  // row 1 = title, row 2 = headers, data from row 3
      while (startRow <= lastRow) {
        var endRow   = Math.min(startRow + BATCH_SIZE - 1, lastRow);
        var numRows  = endRow - startRow + 1;
        // Read up through TYPE_OF_ASSISTANCE column
        var data = sh.getRange(startRow, 1, numRows, COL.TYPE_OF_ASSISTANCE).getValues();
        for (var i = 0; i < data.length; i++) {
          var dateVal = data[i][COL.DATE - 1];
          if (!dateVal) continue;
          var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
          if (isNaN(d.getTime())) continue;
          d.setHours(0, 0, 0, 0);
          if (d < cutoffDate) continue;

          var patient = String(data[i][COL.PATIENT_NAME - 1] || "").trim();
          if (!patient) continue;

          records.push({
            patientName:     patient,
            date:            formatDateForSheet(d),
            typeOfAssistance: String(data[i][COL.TYPE_OF_ASSISTANCE - 1] || "").trim()
          });
        }
        startRow = endRow + 1;
      }
    }
    return jsonResponse({ fetchedAt: fetchedAt, records: records }, params);
  } catch (err) {
    return jsonResponse(
      { fetchedAt: null, records: [], status: "error",
        message: (err && err.message) ? err.message : "Could not fetch records." },
      params
    );
  }
}

function getNextSequenceResponse(ss, dateYyyymmdd, params) {
  params = params || {};
  try {
    var sheet = getTargetSheetForDate(ss, dateYyyymmdd);
    if (!sheet) return jsonResponse({ nextSeq: 1 }, params);

    ensureHeaders(sheet);
    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return jsonResponse({ nextSeq: 1 }, params);

    // Row 1 = title, row 2 = headers, data starts at row 3
    var idColumn = sheet.getRange(3, COL.ID_NUMBER, lastRow - 2, 1).getValues();
    var prefix   = "MSWD-" + String(dateYyyymmdd) + "-";
    var maxSeq   = 0;
    for (var i = 0; i < idColumn.length; i++) {
      var id = String(idColumn[i][0] || "").trim();
      if (id.indexOf(prefix) !== 0) continue;
      var parts   = id.split("-");
      var seqPart = parts.length >= 3 ? parts[parts.length - 1] : null;
      if (seqPart === null) continue;
      var seq = parseInt(seqPart, 10);
      if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
    }
    return jsonResponse({ nextSeq: maxSeq + 1 }, params);
  } catch (err) {
    return jsonResponse(
      { nextSeq: null, status: "error",
        message: (err && err.message) ? err.message : "Could not get next transaction number." },
      params
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Submit validation
// ────────────────────────────────────────────────────────────────────────────
var SUBMIT_REQUIRED_FIELDS = [
  "idNumber", "date", "patientName", "address",
  "claimantLastName", "claimantFirstName",
  "typeOfAssistance", "encodedBy"
];
var SUBMIT_FIELD_LABELS = {
  idNumber:         "Transaction Number",
  date:             "Date",
  patientName:      "Name of Patient / Deceased",
  address:          "Address",
  claimantLastName: "Claimant (Last name)",
  claimantFirstName:"Claimant (First name)",
  typeOfAssistance: "Type of Assistance",
  encodedBy:        "Encoded By"
};

function validateSubmitParams(params) {
  var missing = [];
  for (var i = 0; i < SUBMIT_REQUIRED_FIELDS.length; i++) {
    var key = SUBMIT_REQUIRED_FIELDS[i];
    var val = params[key];
    if (val === undefined || val === null || String(val).trim() === "")
      missing.push(SUBMIT_FIELD_LABELS[key] || key);
  }
  if (missing.length > 0)
    return { valid: false, message: "Missing required fields: " + missing.join(", ") + "." };

  var contactVal = (params.contactNumber || "").trim();
  if (contactVal && contactVal.length > 11)
    return { valid: false, message: "Contact Number must be at most 11 characters." };

  return { valid: true };
}

// ────────────────────────────────────────────────────────────────────────────
//  Main entry point
// ────────────────────────────────────────────────────────────────────────────
function doGet(e) {
  var params = (e && e.parameter) || {};

  // ── Security ──────────────────────────────────────────────────────────────
  if (!params.token || params.token !== ALLOWED_TOKEN) {
    var cb = params.callback ? String(params.callback).replace(/[^a-zA-Z0-9_.]/g, "") : "";
    return ContentService
      .createTextOutput(
        (cb ? cb + "(" : "") +
        JSON.stringify({ status: "error", message: "Unauthorized" }) +
        (cb ? ")" : "")
      )
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  var ssResult = getSpreadsheetOrError();
  if (ssResult.error)
    return jsonResponse({ status: "error", message: ssResult.error }, params);
  var ss = ssResult.ss;

  if (params.action === "ping")           return getPingResponse(params);
  if (params.action === "getAllRecords")   return getGetAllRecordsResponse(ss, params);
  if (params.action === "checkEligibility") return getCheckEligibilityResponse(ss, params);
  if (params.action === "getNextSeq" && params.date)
    return getNextSequenceResponse(ss, params.date, params);

  // ── Submit ────────────────────────────────────────────────────────────────
  var validation = validateSubmitParams(params);
  if (!validation.valid)
    return jsonResponse({ status: "error", message: validation.message }, params);

  try {
    var yyyymmdd = String(params.date || "").replace(/-/g, "");
    var sheet    = getTargetSheetForDate(ss, yyyymmdd);
    if (!sheet) {
      var year = String(yyyymmdd).substring(0, 4) || String(new Date().getFullYear());
      sheet    = ss.insertSheet(SHEET_PREFIX + " " + year);
    }
    ensureHeaders(sheet);

    // Cooldown block
    var type        = (params.typeOfAssistance || "").trim();
    var eligibility = getEligibilityPayload(ss, params.patientName, type);
    if (eligibility.hasRecord && !eligibility.canRequest)
      return jsonResponse({ status: "error", message: eligibility.message }, params);

    var last  = (params.claimantLastName   || "").trim();
    var first = (params.claimantFirstName  || "").trim();
    var mid   = (params.claimantMiddleName || "").trim();
    var claimantFull = last + (first ? ", " + first : "") + (mid ? " " + mid : "");

    var addrParts = [
      params.addrNumber, params.addrStreet, params.addrBarangay,
      params.addrMunicipality, params.addrProvince
    ].map(function(p) { return (p || "").trim(); }).filter(Boolean);
    var fullAddress = addrParts.length ? addrParts.join(", ") : (params.address || "");

    var now = new Date();

    // Build the row in exact column order defined by COL (A–Q) ────────────────
    var row = new Array(HEADERS.length);

    // A–D  Record Identification
    row[COL.ID_NUMBER  - 1] = params.idNumber || "";
    row[COL.DATE       - 1] = params.date     || "";
    row[COL.CODE       - 1] = params.code     || "";
    row[COL.TIMESTAMP  - 1] = now;

    // E  Patient Name
    row[COL.PATIENT_NAME - 1] = params.patientName || "";

    // F  Claimant (merged)
    row[COL.CLAIMANT - 1] = claimantFull;

    // G–H  Contact & Address
    row[COL.CONTACT_NUMBER - 1] = params.contactNumber || "";
    row[COL.ADDRESS        - 1] = fullAddress;

    // I–O  Demographics
    row[COL.AGE                   - 1] = params.age                   || "";
    row[COL.DATE_OF_BIRTH         - 1] = params.dob                   || "";
    row[COL.SEX                   - 1] = params.sex                   || "";
    row[COL.CIVIL_STATUS          - 1] = params.civilStatus           || "";
    row[COL.EDUCATIONAL_ATTAINMENT- 1] = params.educationalAttainment || "";
    row[COL.OCCUPATION            - 1] = params.occupation            || "";
    row[COL.FOUR_PS_STATUS        - 1] = params.fourPsStatus          || "";

    // P–Q  Assistance Details
    row[COL.TYPE_OF_ASSISTANCE - 1] = type;
    row[COL.REMARK             - 1] = params.remark || "";

    // R  Encoded By
    row[COL.ENCODED_BY - 1] = params.encodedBy || "";

    sheet.appendRow(row);
    formatDataRow(sheet, sheet.getLastRow());

    return jsonResponse({ status: "success" }, params);
  } catch (err) {
    return jsonResponse(
      { status: "error",
        message: (err && err.message) ? err.message : "Server error. Please try again." },
      params
    );
  }
}