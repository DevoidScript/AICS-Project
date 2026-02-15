var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbynmrEpTPH6xGGsQKVtRDi6zTKvXUE3WqmUVlXmAR0VF6Ne2LcqzGGeMzc2kSgrjVacnA/exec";

var COLUMNS = [
  { label: "ID Number",          key: "idNumber" },
  { label: "Date",               key: "date",    useFormatDate: true },
  { label: "Patient / Deceased", key: "patientName" },
  { label: "Address",            key: "address" },
  { label: "Claimant",           key: "claimant" },
  { label: "Type of Assistance", key: "typeOfAssistance" },
  { label: "Code",               key: "code" },
  { label: "Remark",             key: "remark",  fallback: "-" }
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

function getFormData() {
  return {
    idNumber:         document.getElementById("idNumber").value.trim(),
    date:             document.getElementById("date").value,
    patientName:      document.getElementById("patientName").value.trim(),
    address:          document.getElementById("address").value.trim(),
    claimant:         document.getElementById("claimant").value.trim(),
    typeOfAssistance: document.getElementById("typeOfAssistance").value,
    code:             document.getElementById("code").value.trim(),
    remark:           document.getElementById("remark").value.trim(),
    encodedBy:        document.getElementById("encodedBy").value.trim()
  };
}

function validateForm(data) {
  var required = ["idNumber","date","patientName","address","claimant","typeOfAssistance","code","encodedBy"];
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
      claimant: data.claimant, typeOfAssistance: data.typeOfAssistance,
      code: data.code, remark: data.remark, encodedBy: data.encodedBy
    });
    var img = new Image();
    img.onload  = function() { resolve({ status: "success" }); };
    img.onerror = function() { resolve({ status: "success" }); };
    img.src = APPS_SCRIPT_URL + "?" + params.toString();
    setTimeout(function() { resolve({ status: "success" }); }, 6000);
  });
}

/* ── Modal preview: table layout (for on-screen reference) ── */
function buildPreview(data) {
  var headers = COLUMNS.map(function(c) { return "<th>" + c.label + "</th>"; }).join("");
  var cells   = COLUMNS.map(function(c) { return "<td>" + getCellValue(c, data) + "</td>"; }).join("");
  var today   = new Date().toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" });
  document.getElementById("pdf-preview").innerHTML =
    "<div class='preview-doc-header'>" +
      "<h2>Social Welfare &amp; Development Office</h2>" +
      "<p>Assistance Record</p>" +
    "</div>" +
    "<table class='preview-table'>" +
      "<thead><tr>" + headers + "</tr></thead>" +
      "<tbody><tr>" + cells   + "</tr></tbody>" +
    "</table>" +
    "<div class='preview-footer'>" +
      "<span>Date Generated: " + today + "</span>" +
      "<span>This document is system-generated.</span>" +
    "</div>";
}

/* ── Slip layout: built for @media print ── */
function buildPrintArea(data) {
  var today = new Date().toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" });

  function field(labelText, value) {
    return "<div class='slip-field'>" +
      "<span class='slip-label'>" + labelText + "</span>" +
      "<span class='slip-value'>" + (value || "") + "</span>" +
    "</div>";
  }

  var sealImg = "images/LGU%20Oton%20Official%20Seal%20(HD).png";
  document.getElementById("printable-area").innerHTML =
    "<div class='slip-card'>" +
      "<div class='slip-header'>" +
        "<img class='slip-seal' src='" + sealImg + "' alt='Seal of Oton' />" +
        "<div class='slip-header-center'>" +
          "<div class='slip-org-line'>Republic of the Philippines</div>" +
          "<div class='slip-org-line'>Province of Iloilo</div>" +
          "<div class='slip-org-line slip-org-name'>MUNICIPALITY OF OTON</div>" +
        "</div>" +
      "</div>" +
      "<div class='slip-title'>Assistance Record</div>" +

      /* ID Number on its own row */
      field("ID No.", data.idNumber) +

      /* Patient name */
      field("Name", data.patientName) +

      /* Address */
      field("Address", data.address) +

      /* Claimant */
      field("Claimant", data.claimant) +

      /* Type of Assistance */
      field("Type", data.typeOfAssistance) +

      /* Date + Code side by side */
      "<div class='slip-row'>" +
        "<div class='slip-field'>" +
          "<span class='slip-label'>Date</span>" +
          "<span class='slip-value'>" + formatDate(data.date) + "</span>" +
        "</div>" +
        "<div class='slip-field'>" +
          "<span class='slip-label'>Code</span>" +
          "<span class='slip-value'>" + data.code + "</span>" +
        "</div>" +
      "</div>" +

      /* Remark */
      field("Remark", data.remark || "-") +

      "<div class='slip-footer'>Social Welfare &amp; Development Office &mdash; " + today + "</div>" +
    "</div>";
}

/* ── Download PDF (landscape table format) ── */
function downloadAsPDF(data) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  var pageW = doc.internal.pageSize.getWidth();
  var margin = 12;
  var usableW = pageW - margin * 2;
  var colW = usableW / COLUMNS.length;
  var y = 18;

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
  doc.setTextColor(255,255,255); doc.setFontSize(7); doc.setFont("helvetica","bold");
  COLUMNS.forEach(function(col, i) {
    doc.text(col.label.toUpperCase(), margin + i * colW + colW / 2, y + 6, { align: "center" });
  });
  y += headerH;

  var dataH = 10;
  doc.setFillColor(250,248,244); doc.rect(margin, y, usableW, dataH, "F");
  doc.setTextColor(28,26,23); doc.setFontSize(8); doc.setFont("helvetica","normal");
  COLUMNS.forEach(function(col, i) {
    var val = getCellValue(col, data);
    var x = margin + i * colW;
    doc.setDrawColor(200,193,183); doc.setLineWidth(0.2); doc.rect(x, y, colW, dataH);
    var maxC = Math.floor(colW / 2.0);
    var display = val.length > maxC ? val.substring(0, maxC - 1) + "..." : val;
    doc.text(display, x + colW / 2, y + 6.5, { align: "center" });
  });
  y += dataH + 8;

  doc.setDrawColor(26,58,42); doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y); y += 5;
  doc.setFontSize(7.5); doc.setTextColor(100,92,80);
  var today = new Date().toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" });
  doc.text("Date Generated: " + today, margin, y);
  doc.text("This document is system-generated.", pageW - margin, y, { align: "right" });

  doc.save("SWDO_" + data.idNumber.replace(/[^a-zA-Z0-9]/g,"_") + "_" + data.date + ".pdf");
}

/* FORM SUBMIT */
document.getElementById("assistanceForm").addEventListener("submit", function(e) {
  e.preventDefault();
  var data = getFormData();
  if (!validateForm(data)) { showToast("Please fill in all required fields.", "error"); return; }
  var btn = document.getElementById("submitBtn");
  btn.disabled = true; btn.textContent = "Submitting...";
  sendToSheet(data).then(function() {
    showToast("Record saved to Google Sheets!");
    buildPreview(data);
    buildPrintArea(data);
    document.getElementById("pdfModal").classList.add("open");
    btn.disabled = false; btn.textContent = "Submit & Preview";
  });
});

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

document.getElementById("clearBtn").addEventListener("click", function() {
  document.getElementById("assistanceForm").reset();
});

document.getElementById("date").valueAsDate = new Date();
