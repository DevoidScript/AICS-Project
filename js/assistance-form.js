var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbynmrEpTPH6xGGsQKVtRDi6zTKvXUE3WqmUVlXmAR0VF6Ne2LcqzGGeMzc2kSgrjVacnA/exec";

var TYPE_CODES = {
  "Maintenance": "MA",
  "Burial": "BU",
  "Dialysis": "DI",
  "Chemotherapy": "CH",
  "Medicine": "ME"
};

var STORAGE_KEY_TXN = "assistanceForm_currentTransactionNumber";

function getStoredTransactionNumber() {
  return localStorage.getItem(STORAGE_KEY_TXN) || "";
}

function setStoredTransactionNumber(value) {
  var el = document.getElementById("idNumber");
  if (el) el.value = value || "";
  if (value) localStorage.setItem(STORAGE_KEY_TXN, value);
}

/** Clears all transaction-number state so the next generated number will be 001. */
function resetTransactionNumberToFirst() {
  var keys = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k && (k === STORAGE_KEY_TXN || k.indexOf("assistanceForm_seq_") === 0)) keys.push(k);
  }
  keys.forEach(function(k) { localStorage.removeItem(k); });
}

var COLUMNS = [
  { label: "ID Number",               key: "idNumber" },
  { label: "Date",                    key: "date",    useFormatDate: true },
  { label: "Patient / Deceased",      key: "patientName" },
  { label: "Address",                 key: "address" },
  { label: "Contact No.",              key: "contactNumber", fallback: "-" },
  { label: "Claimant (Last)",         key: "claimantLastName" },
  { label: "Claimant (First)",        key: "claimantFirstName" },
  { label: "Claimant (Middle)",       key: "claimantMiddleName", fallback: "-" },
  { label: "Type of Assistance",      key: "typeOfAssistance" },
  { label: "Code",                    key: "code" },
  { label: "Remark",                  key: "remark",  fallback: "-" }
];

function showToast(msg, type) {
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show " + (type || "success");
  setTimeout(function() { t.className = ""; }, 3800);
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  var d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}

function getCellValue(col, data) {
  var val = data[col.key] || "";
  if (col.useFormatDate) val = formatDate(val);
  if (!val && col.fallback) val = col.fallback;
  return val;
}

/**
 * Fetches the next sequence number for the given date from the sheet (source of truth).
 * Uses JSONP to avoid CORS when the form is on file:// or another domain.
 * @param {string} yyyymmdd - Date as YYYYMMDD
 * @returns {Promise<number|null>} Next sequence (1-based) or null on error
 */
function fetchNextSequenceFromSheet(yyyymmdd) {
  return new Promise(function(resolve) {
    var callbackName = "__aicsCb" + Date.now();
    var timeout = setTimeout(function() {
      if (window[callbackName]) {
        window[callbackName] = null;
        showToast("Could not load next number from sheet. Redeploy Apps Script (getNextSeq) and refresh.", "error");
        resolve(null);
      }
    }, 12000);
    window[callbackName] = function(data) {
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script.parentNode) document.body.removeChild(script); } catch (e) {}
      resolve(typeof data === "object" && typeof data.nextSeq === "number" ? data.nextSeq : null);
    };
    var url = APPS_SCRIPT_URL + "?action=getNextSeq&date=" + encodeURIComponent(yyyymmdd) + "&callback=" + callbackName + "&_=" + Date.now();
    var script = document.createElement("script");
    script.src = url;
    script.onerror = function() {
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script.parentNode) document.body.removeChild(script); } catch (e) {}
      showToast("Could not load next number from sheet. Redeploy Apps Script (getNextSeq) and refresh.", "error");
      resolve(null);
    };
    document.body.appendChild(script);
  });
}

/** Cooldown types: Maintenance/Dialysis/Chemotherapy = 6 months, Medicine = 1 year. Burial has no cooldown. */
var COOLDOWN_TYPES = { "Maintenance": true, "Dialysis": true, "Chemotherapy": true, "Medicine": true };

/**
 * Check eligibility for patient + type (cooldown). Returns Promise<{ hasRecord, lastRequestDate, eligibleAgainDate, canRequest, message }>.
 */
function checkEligibility(patientName, typeOfAssistance) {
  return new Promise(function(resolve) {
    patientName = (patientName || "").trim();
    typeOfAssistance = (typeOfAssistance || "").trim();
    if (!patientName || !typeOfAssistance || !COOLDOWN_TYPES[typeOfAssistance]) {
      resolve({ hasRecord: false, canRequest: true, message: "" });
      return;
    }
    var callbackName = "__aicsEligibility" + Date.now();
    var timeout = setTimeout(function() {
      if (window[callbackName]) {
        window[callbackName] = null;
        resolve({ hasRecord: false, canRequest: true, message: "" });
      }
    }, 10000);
    window[callbackName] = function(data) {
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script.parentNode) document.body.removeChild(script); } catch (e) {}
      resolve(typeof data === "object" ? data : { hasRecord: false, canRequest: true, message: "" });
    };
    var url = APPS_SCRIPT_URL + "?action=checkEligibility&patientName=" + encodeURIComponent(patientName) +
      "&typeOfAssistance=" + encodeURIComponent(typeOfAssistance) + "&callback=" + callbackName + "&_=" + Date.now();
    var script = document.createElement("script");
    script.src = url;
    script.onerror = function() {
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script.parentNode) document.body.removeChild(script); } catch (e) {}
      resolve({ hasRecord: false, canRequest: true, message: "" });
    };
    document.body.appendChild(script);
  });
}

function showEligibilityMessage(result) {
  var el = document.getElementById("eligibilityMessage");
  if (!el) return;
  if (!result.message) {
    el.style.display = "none";
    el.textContent = "";
    el.className = "eligibility-message";
    return;
  }
  // For cooldown warning, show dates as "Month Day, Year" using client-side formatting
  var displayMessage = result.message;
  if (result.hasRecord && !result.canRequest && result.lastRequestDate && result.eligibleAgainDate) {
    var lastReadable = result.lastRequestDateReadable || formatDate(result.lastRequestDate);
    var eligibleReadable = result.eligibleAgainDateReadable || formatDate(result.eligibleAgainDate);
    var type = result.typeOfAssistance || "";
    displayMessage = "This patient already has a " + type + " request on " + lastReadable + ". They may request again on " + eligibleReadable + ".";
  }
  el.textContent = displayMessage;
  el.className = "eligibility-message " + (result.canRequest ? "eligibility-ok" : "eligibility-warn");
  el.style.display = "block";
}

function showCooldownWarningModal(result) {
  var modal = document.getElementById("cooldownWarningModal");
  var typeEl = document.getElementById("cooldownType");
  var lastEl = document.getElementById("cooldownLastDate");
  var eligibleEl = document.getElementById("cooldownEligibleDate");
  if (typeEl) typeEl.textContent = result.typeOfAssistance || "";
  // Always show full month name and day, then year (e.g. "February 16, 2026")
  var lastStr = result.lastRequestDateReadable || (result.lastRequestDate ? formatDate(result.lastRequestDate) : "");
  var eligibleStr = result.eligibleAgainDateReadable || (result.eligibleAgainDate ? formatDate(result.eligibleAgainDate) : "");
  if (lastEl) lastEl.textContent = lastStr;
  if (eligibleEl) eligibleEl.textContent = eligibleStr;
  if (modal) modal.classList.add("open");
}

function closeCooldownWarningModal() {
  var modal = document.getElementById("cooldownWarningModal");
  if (modal) modal.classList.remove("open");
}

/**
 * Generates a transaction number: AICS-YYYYMMDD-NNN
 * - AICS = prefix
 * - YYYYMMDD = form date (sortable)
 * - NNN = 3-digit daily sequence (per date)
 * @param {number} [overrideSeq] - If provided, use this as the sequence (e.g. from sheet); otherwise use localStorage.
 */
function generateTransactionNumber(overrideSeq) {
  var dateInput = document.getElementById("date");
  var dateStr = dateInput && dateInput.value ? dateInput.value : "";
  if (!dateStr) {
    var today = new Date();
    dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  }
  var yyyymmdd = dateStr.replace(/-/g, "");
  var seq;
  if (typeof overrideSeq === "number" && overrideSeq >= 1) {
    seq = overrideSeq;
  } else {
    var storageKey = "assistanceForm_seq_" + yyyymmdd;
    seq = parseInt(localStorage.getItem(storageKey) || "0", 10) + 1;
    localStorage.setItem(storageKey, String(seq));
  }
  var seqStr = String(seq).padStart(3, "0");
  return "AICS-" + yyyymmdd + "-" + seqStr;
}

/**
 * Fetches next sequence from sheet and updates the transaction number field.
 * Falls back to localStorage-based generation if the request fails.
 */
function updateTransactionNumber() {
  var dateInput = document.getElementById("date");
  var dateStr = dateInput && dateInput.value ? dateInput.value : "";
  if (!dateStr) {
    var today = new Date();
    dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  }
  var yyyymmdd = dateStr.replace(/-/g, "");
  fetchNextSequenceFromSheet(yyyymmdd).then(function(nextSeq) {
    var value;
    if (nextSeq !== null) {
      value = generateTransactionNumber(nextSeq);
      localStorage.removeItem("assistanceForm_seq_" + yyyymmdd);
    } else {
      value = generateTransactionNumber();
    }
    setStoredTransactionNumber(value);
  });
}

/** Normalizes transaction number to 3-part format (AICS-YYYYMMDD-NNN), stripping any type code if present. */
function setTransactionNumberTypeCode() {
  var el = document.getElementById("idNumber");
  if (!el || !el.value) return;
  var parts = el.value.split("-");
  var seq = parts.length === 4 ? parts[3] : parts.length === 3 ? parts[2] : null;
  if (seq == null) return;
  var value = "AICS-" + parts[1] + "-" + seq;
  el.value = value;
  localStorage.setItem(STORAGE_KEY_TXN, value);
}

function getFormData() {
  var last  = document.getElementById("claimantLastName").value.trim();
  var first = document.getElementById("claimantFirstName").value.trim();
  var mid   = document.getElementById("claimantMiddleName").value.trim();
  var claimantFull = last + (first ? ", " + first : "") + (mid ? " " + mid : "");
  return {
    idNumber:             document.getElementById("idNumber").value.trim(),
    date:                 document.getElementById("date").value,
    patientName:          document.getElementById("patientName").value.trim(),
    address:              document.getElementById("address").value.trim(),
    claimantLastName:     last,
    claimantFirstName:    first,
    claimantMiddleName:   mid,
    claimant:             claimantFull,
    contactNumber:        (document.getElementById("contactNumber") && document.getElementById("contactNumber").value) ? document.getElementById("contactNumber").value.trim() : "",
    typeOfAssistance:     document.getElementById("typeOfAssistance").value,
    code:                 document.getElementById("code").value.trim(),
    remark:               document.getElementById("remark").value.trim(),
    encodedBy:            document.getElementById("encodedBy").value.trim()
  };
}

function validateForm(data) {
  var required = ["idNumber","date","patientName","address","claimantLastName","claimantFirstName","typeOfAssistance","encodedBy"];
  for (var i = 0; i < required.length; i++) {
    if (!data[required[i]]) return false;
  }
  return true;
}

function sendToSheet(data) {
  return new Promise(function(resolve) {
    var params = new URLSearchParams({
      idNumber: data.idNumber, date: data.date,
      patientName: data.patientName, address: data.address,
      contactNumber: data.contactNumber || "",
      claimantLastName: data.claimantLastName,
      claimantFirstName: data.claimantFirstName,
      claimantMiddleName: data.claimantMiddleName,
      typeOfAssistance: data.typeOfAssistance,
      code: data.code, remark: data.remark, encodedBy: data.encodedBy
    });
    var img = new Image();
    img.onload  = function() { resolve({ status: "success" }); };
    img.onerror = function() { resolve({ status: "success" }); };
    img.src = APPS_SCRIPT_URL + "?" + params.toString();
    setTimeout(function() { resolve({ status: "success" }); }, 6000);
  });
}

/** Returns the printable slip HTML (used for both modal preview and print). */
function getSlipHtml(data) {
  function field(labelText, value) {
    return "<div class='slip-field'>" +
      "<span class='slip-label'>" +
        "<span class='slip-label-text'>" + labelText + "</span>" +
        "<span class='slip-label-colon'>:</span>" +
      "</span>" +
      "<span class='slip-value'>" + (value || "") + "</span>" +
    "</div>";
  }

  var headerImg = "images/NewHeader.jpg";
  return "<div class='slip-card'>" +
    "<div class='slip-header'>" +
      "<img class='slip-header-img' src='" + headerImg + "' alt='Municipality of Oton' />" +
    "</div>" +
    "<div class='slip-title'>Assistance to Individuals in Crisis Situations</div>" +
    "<div class='slip-body'>" +
      field("Code", data.code || "") +
      field("Transaction No.", data.idNumber) +
      field("Date", formatDate(data.date)) +
      field("Name of Patient", data.patientName) +
      field("Address", data.address) +
      field("Contact No.", data.contactNumber || "-") +
      field("Type / Purpose", data.typeOfAssistance) +
      field("Claimant", data.claimant) +
      "<div class='slip-row-last'>" +
        field("Remark", data.remark || "-") +
      "</div>" +
    "</div>" +
    "<div class='slip-signature'>" +
      "<div class='slip-signature-inner'>" +
        "<div class='slip-signature-line'>" + (data.claimant || "") + "</div>" +
        "<div class='slip-signature-label'>Signature Over Printed Name</div>" +
      "</div>" +
    "</div>" +
  "</div>";
}

/* ── Modal preview: show printable slip (same as print) ── */
function buildPreview(data) {
  document.getElementById("pdf-preview").innerHTML = getSlipHtml(data);
}

/* ── Slip layout for @media print ── */
function buildPrintArea(data) {
  document.getElementById("printable-area").innerHTML = getSlipHtml(data);
}

/* ── Download PDF: page 1 = table form, page 2 = printable slip (backup) ── */
function downloadAsPDF(data) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  var pageW = doc.internal.pageSize.getWidth();
  var margin = 12;
  var usableW = pageW - margin * 2;
  var colW = usableW / COLUMNS.length;
  var y = 18;

  /* ── Page 1: Table form ── */
  doc.setFont("times", "bold"); doc.setFontSize(14); doc.setTextColor(26, 58, 42);
  doc.text("Social Welfare & Development Office", pageW / 2, y, { align: "center" });
  y += 6;
  doc.setFont("times", "normal"); doc.setFontSize(9); doc.setTextColor(100, 92, 80);
  doc.text("Assistance Record", pageW / 2, y, { align: "center" });
  y += 4;
  doc.setDrawColor(26, 58, 42); doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y); y += 7;

  var headerH = 9;
  doc.setFillColor(26, 58, 42); doc.rect(margin, y, usableW, headerH, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(7); doc.setFont("helvetica", "bold");
  COLUMNS.forEach(function(col, i) {
    doc.text(col.label.toUpperCase(), margin + i * colW + colW / 2, y + 6, { align: "center" });
  });
  y += headerH;

  var dataH = 10;
  doc.setFillColor(250, 248, 244); doc.rect(margin, y, usableW, dataH, "F");
  doc.setTextColor(28, 26, 23); doc.setFontSize(8); doc.setFont("helvetica", "normal");
  COLUMNS.forEach(function(col, i) {
    var val = getCellValue(col, data);
    var x = margin + i * colW;
    doc.setDrawColor(200, 193, 183); doc.setLineWidth(0.2); doc.rect(x, y, colW, dataH);
    var maxC = Math.floor(colW / 2.0);
    var display = val.length > maxC ? val.substring(0, maxC - 1) + "..." : val;
    doc.text(display, x + colW / 2, y + 6.5, { align: "center" });
  });
  y += dataH + 8;

  doc.setDrawColor(26, 58, 42); doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y); y += 5;
  doc.setFontSize(7.5); doc.setTextColor(100, 92, 80);
  var today = new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  doc.text("Date Generated: " + today, margin, y);
  doc.text("This document is system-generated.", pageW - margin, y, { align: "right" });

  /* ── Page 2: Printable slip (backup) ── */
  doc.addPage("a5", "portrait");
  pageW = doc.internal.pageSize.getWidth();
  margin = 8;
  var contentW = pageW - margin * 2;
  y = margin;
  var lineH = 5;
  var labelW = 38;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(margin, y, contentW, doc.internal.pageSize.getHeight() - margin * 2);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Republic of the Philippines", pageW / 2, y, { align: "center" });
  y += 4;
  doc.text("Province of Iloilo", pageW / 2, y, { align: "center" });
  y += 4;
  doc.text("Municipality of Oton", pageW / 2, y, { align: "center" });
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text("OFFICE OF THE MAYOR", pageW / 2, y, { align: "center" });
  y += 6;
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("ASSISTANCE TO INDIVIDUALS IN CRISIS SITUATIONS", pageW / 2, y, { align: "center" });
  y += 6;
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  function slipLine(label, value) {
    var val = (value !== undefined && value !== null && value !== "") ? String(value) : "";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(label + ":", margin + 2, y + 3);
    doc.setFont("helvetica", "normal");
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.line(margin + labelW, y + 3.5, pageW - margin - 2, y + 3.5);
    doc.text(val, margin + labelW + 2, y + 3);
    y += lineH;
  }

  slipLine("Code", data.code);
  slipLine("Transaction No.", data.idNumber);
  slipLine("Date", formatDate(data.date));
  slipLine("Name of Patient", data.patientName);
  slipLine("Address", data.address);
  slipLine("Contact No.", data.contactNumber || "-");
  slipLine("Type / Purpose", data.typeOfAssistance);
  slipLine("Claimant", data.claimant);
  slipLine("Remark", data.remark || "-");
  y += 3;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(data.claimant || "", pageW / 2, y + 3, { align: "center" });
  doc.line(margin + (contentW - 45) / 2, y + 5, pageW - margin - (contentW - 45) / 2, y + 5);
  y += 6;
  doc.setFontSize(6);
  doc.setTextColor(80, 80, 80);
  doc.text("Signature Over Printed Name", pageW / 2, y, { align: "center" });

  doc.setTextColor(0, 0, 0);
  doc.save("SWDO_" + data.idNumber.replace(/[^a-zA-Z0-9]/g, "_") + "_" + data.date + ".pdf");
}

/* FORM SUBMIT */
document.getElementById("assistanceForm").addEventListener("submit", function(e) {
  e.preventDefault();
  var data = getFormData();
  if (!validateForm(data)) { showToast("Please fill in all required fields.", "error"); return; }

  var btn = document.getElementById("submitBtn");
  var typeHasCooldown = COOLDOWN_TYPES[data.typeOfAssistance];
  if (typeHasCooldown) {
    btn.disabled = true;
    btn.textContent = "Checking...";
    checkEligibility(data.patientName, data.typeOfAssistance).then(function(result) {
      btn.disabled = false;
      btn.textContent = "Submit & Preview";
      if (result.hasRecord && !result.canRequest) {
        showEligibilityMessage(result);
        showCooldownWarningModal(result);
        return;
      }
      doSubmit(data);
    });
  } else {
    doSubmit(data);
  }
});

function doSubmit(data) {
  var btn = document.getElementById("submitBtn");
  btn.disabled = true;
  btn.textContent = "Submitting...";
  sendToSheet(data).then(function() {
    showToast("Record saved to Google Sheets!");
    showEligibilityMessage({ message: "" });
    buildPreview(data);
    buildPrintArea(data);
    document.getElementById("pdfModal").classList.add("open");
    btn.disabled = false;
    btn.textContent = "Submit & Preview";
    updateTransactionNumber();
  });
}

/*
  PRINT SLIP
  1. Make #printable-area visible (needed so @media print can render it)
  2. Call window.print() — browser opens its native Print Preview dialog
     showing only the slip card (everything else is hidden by @media print)
  3. Re-hide the area after the dialog closes
*/
document.getElementById("printBtn").addEventListener("click", function() {
  var pa = document.getElementById("printable-area");
  pa.style.display = "block";
  window.print();
  setTimeout(function() { pa.style.display = "none"; }, 1500);
});

document.getElementById("downloadPdf").addEventListener("click", function() {
  downloadAsPDF(getFormData());
});

["closeModal","closeModal2"].forEach(function(id) {
  document.getElementById(id).addEventListener("click", function() {
    document.getElementById("pdfModal").classList.remove("open");
  });
});
document.getElementById("pdfModal").addEventListener("click", function(e) {
  if (e.target === document.getElementById("pdfModal")) {
    document.getElementById("pdfModal").classList.remove("open");
  }
});

["cooldownModalOk", "cooldownModalClose"].forEach(function(id) {
  var el = document.getElementById(id);
  if (el) el.addEventListener("click", closeCooldownWarningModal);
});
document.getElementById("cooldownWarningModal").addEventListener("click", function(e) {
  if (e.target === document.getElementById("cooldownWarningModal")) {
    closeCooldownWarningModal();
  }
});

document.getElementById("clearBtn").addEventListener("click", function() {
  var currentTxn = document.getElementById("idNumber").value;
  document.getElementById("assistanceForm").reset();
  document.getElementById("date").valueAsDate = new Date();
  document.getElementById("idNumber").value = currentTxn;
});

document.getElementById("date").valueAsDate = new Date();
// Always fetch next transaction number from sheet so it stays in sync (no reset on refresh)
updateTransactionNumber();

document.getElementById("date").addEventListener("change", function() {
  updateTransactionNumber();
});

document.getElementById("typeOfAssistance").addEventListener("change", function() {
  setTransactionNumberTypeCode();
  runEligibilityCheck();
});

function runEligibilityCheck() {
  var patientName = document.getElementById("patientName").value.trim();
  var typeOfAssistance = document.getElementById("typeOfAssistance").value;
  if (!patientName || !COOLDOWN_TYPES[typeOfAssistance]) {
    showEligibilityMessage({ message: "" });
    return;
  }
  checkEligibility(patientName, typeOfAssistance).then(showEligibilityMessage);
}

document.getElementById("patientName").addEventListener("blur", runEligibilityCheck);
