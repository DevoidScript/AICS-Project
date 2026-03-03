// MSWD Enhanced Form - Based on assistance-form.js with additional beneficiary fields
// Uses partitioned address, age, sex, civil status, educational attainment, occupation, 4Ps status

// --- Offline storage keys ---
var STORAGE_KEY_QUEUE      = "assistanceForm_offlineQueue";
var STORAGE_KEY_ELIG_CACHE = "assistanceForm_eligibilityCache";
var STORAGE_KEY_LAST_DATA  = "assistanceForm_lastPreviewData";
var ELIG_CACHE_TTL_MS      = 5 * 60 * 1000; // 5 minutes

// --- Online/offline detection ---
function isOnline() { return navigator.onLine; }

// --- Offline queue helpers ---
function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_QUEUE) || "[]"); }
  catch (e) { return []; }
}
function saveOfflineQueue(q) { localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(q)); }
function enqueueOffline(data) {
  var q = getOfflineQueue();
  q.push({ data: data, queuedAt: new Date().toISOString() });
  saveOfflineQueue(q);
  updateOfflineBanner();
}

function updateOfflineBanner() {
  var banner = document.getElementById("offline-banner");
  var queueBadge = document.getElementById("offline-queue-badge");
  if (banner) {
    banner.style.display = isOnline() ? "none" : "flex";
    banner.classList.toggle("offline-banner-visible", !isOnline());
    document.body.classList.toggle("offline-banner-open", !isOnline());
  }
  if (queueBadge) {
    var q = getOfflineQueue();
    queueBadge.textContent = q.length > 0 ? q.length : "0";
    queueBadge.style.display = q.length > 0 ? "inline-block" : "none";
  }
}

window.addEventListener("online", function () {
  updateOfflineBanner();
  showToast("You're back online! Syncing queued records…", "info");
  setTimeout(flushOfflineQueue, 800);
});
window.addEventListener("offline", function () {
  updateOfflineBanner();
  showToast("You are offline. Submissions will be queued.", "warn");
});

// --- Eligibility cache helpers ---
function buildEligCacheKey(patient, type) { return (patient + "|" + type).toLowerCase(); }
function getCachedEligibility(patient, type) {
  try {
    var cache = JSON.parse(localStorage.getItem(STORAGE_KEY_ELIG_CACHE) || "{}");
    var entry = cache[buildEligCacheKey(patient, type)];
    if (!entry || Date.now() - entry.ts > ELIG_CACHE_TTL_MS) return null;
    return entry.result;
  } catch (e) { return null; }
}
function setCachedEligibility(patient, type, result) {
  try {
    var cache = JSON.parse(localStorage.getItem(STORAGE_KEY_ELIG_CACHE) || "{}");
    cache[buildEligCacheKey(patient, type)] = { result: result, ts: Date.now() };
    localStorage.setItem(STORAGE_KEY_ELIG_CACHE, JSON.stringify(cache));
  } catch (e) {}
}

// --- Local cooldown check (mirrors server logic) ---
function getCooldownMonthsLocal(type) {
  var t = (type || "").trim().toLowerCase();
  if (t === "maintenance" || t === "dialysis" || t === "chemotherapy") return 6;
  if (t === "medicine" || t === "laboratory" || t === "hospital bill" || t === "confinement") return 12;
  return null;
}

function formatDateISO(d) {
  if (!d) return "";
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Check the offline queue itself for eligibility conflicts
function checkQueueForEligibility(patientName, typeOfAssistance) {
  var queue = getOfflineQueue();
  var pLower = (patientName || "").trim().toLowerCase();
  var blockingEligibleDate = null, blockingRequestDate = null, blockingType = null;
  queue.forEach(function (item) {
    var d = item.data;
    if (!d || (d.patientName || "").trim().toLowerCase() !== pLower) return;
    var rc = getCooldownMonthsLocal(d.typeOfAssistance);
    if (rc === null) return;
    var rowDate = new Date(d.date + "T00:00:00");
    if (isNaN(rowDate.getTime())) return;
    var eligible = new Date(rowDate);
    eligible.setMonth(eligible.getMonth() + rc);
    eligible.setDate(eligible.getDate() + 1);
    if (!blockingEligibleDate || eligible > blockingEligibleDate) {
      blockingEligibleDate = eligible;
      blockingRequestDate = rowDate;
      blockingType = d.typeOfAssistance;
    }
  });
  if (!blockingEligibleDate) return null;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var el = new Date(blockingEligibleDate); el.setHours(0, 0, 0, 0);
  var canRequest = today >= el;
  return {
    hasRecord: true, canRequest: canRequest, typeOfAssistance: blockingType,
    lastRequestDate: formatDateISO(blockingRequestDate),
    lastRequestDateReadable: formatDate(formatDateISO(blockingRequestDate)),
    eligibleAgainDate: formatDateISO(blockingEligibleDate),
    eligibleAgainDateReadable: formatDate(formatDateISO(blockingEligibleDate)),
    message: canRequest
      ? "A previous " + blockingType + " request is queued. You may still submit."
      : "This patient has a queued " + blockingType + " request. They may request again on " + formatDate(formatDateISO(blockingEligibleDate)) + ".",
    fromQueue: true
  };
}

// --- Auto-sync when back online ---
var _flushLock = false;
function flushOfflineQueue() {
  if (_flushLock || !isOnline()) return;
  var queue = getOfflineQueue();
  if (queue.length === 0) return;
  _flushLock = true;
  showToast("Syncing " + queue.length + " queued record(s)…", "info");
  function processNext(remaining, ok, fail) {
    if (remaining.length === 0) {
      _flushLock = false;
      updateOfflineBanner();
      if (ok > 0) { showToast(ok + " record(s) synced to Google Sheets!", "success"); updateTransactionNumber(); }
      if (fail > 0) showToast(fail + " record(s) could not sync. They remain queued.", "error");
      return;
    }
    var item = remaining[0];
    sendToSheet(item.data).then(function (result) {
      if (result.status === "success") {
        var cur = getOfflineQueue().filter(function (q) { return q.data.idNumber !== item.data.idNumber; });
        saveOfflineQueue(cur);
        processNext(remaining.slice(1), ok + 1, fail);
      } else {
        processNext(remaining.slice(1), ok, fail + 1);
      }
    });
  }
  processNext(queue, 0, 0);
}

var STORAGE_KEY_TXN = "assistanceForm_currentTransactionNumber";
var PENDING_TXNS_KEY = "aicsPendingTxns";

function getPendingTxns() {
  try {
    var raw = localStorage.getItem(PENDING_TXNS_KEY);
    if (!raw) return [];
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function addPendingTxn(idNumber) {
  var arr = getPendingTxns();
  if (arr.indexOf(idNumber) === -1) arr.push(idNumber);
  localStorage.setItem(PENDING_TXNS_KEY, JSON.stringify(arr));
}

function removePendingTxn(idNumber) {
  var arr = getPendingTxns().filter(function(id) { return id !== idNumber; });
  localStorage.setItem(PENDING_TXNS_KEY, JSON.stringify(arr));
}

function setStoredTransactionNumber(value, isPending) {
  var el = document.getElementById("idNumber");
  if (el) {
    el.value = value || "";
    if (isPending) {
      el.classList.add("txn-pending");
      if (value) addPendingTxn(value);
    } else {
      el.classList.remove("txn-pending");
      if (value) removePendingTxn(value);
    }
  }
  if (value) localStorage.setItem(STORAGE_KEY_TXN, value);
}

function getStoredTransactionNumber() {
  return localStorage.getItem(STORAGE_KEY_TXN) || "";
}

/** MSWD: Build full address from partitioned fields */
function buildAddressFromParts() {
  var num = (document.getElementById("addrNumber") && document.getElementById("addrNumber").value) ? document.getElementById("addrNumber").value.trim() : "";
  var street = (document.getElementById("addrStreet") && document.getElementById("addrStreet").value) ? document.getElementById("addrStreet").value.trim() : "";
  var brgy = (document.getElementById("addrBarangay") && document.getElementById("addrBarangay").value) ? document.getElementById("addrBarangay").value.trim() : "";
  var muni = (document.getElementById("addrMunicipality") && document.getElementById("addrMunicipality").value) ? document.getElementById("addrMunicipality").value.trim() : "";
  var prov = (document.getElementById("addrProvince") && document.getElementById("addrProvince").value) ? document.getElementById("addrProvince").value.trim() : "";
  var parts = [num, street, brgy, muni, prov].filter(Boolean);
  return parts.join(", ");
}

/** MSWD: Get selected radio value by name */
function getRadioValue(name) {
  var radios = document.querySelectorAll('input[name="' + name + '"]');
  for (var i = 0; i < radios.length; i++) {
    if (radios[i].checked) return radios[i].value || "";
  }
  return "";
}

var COLUMNS = [
  { label: "ID Number",               key: "idNumber" },
  { label: "Date",                    key: "date",    useFormatDate: true },
  { label: "Patient / Deceased",      key: "patientName" },
  { label: "Age",                     key: "age" },
  { label: "Date of Birth",           key: "dob" },
  { label: "Sex",                     key: "sex" },
  { label: "Civil Status",            key: "civilStatus" },
  { label: "Educational Attainment",  key: "educationalAttainment" },
  { label: "Occupation",              key: "occupation" },
  { label: "4Ps Status",              key: "fourPsStatus" },
  { label: "Address",                 key: "address" },
  { label: "Contact No.",             key: "contactNumber", fallback: "-" },
  { label: "Claimant (Last)",         key: "claimantLastName" },
  { label: "Claimant (First)",        key: "claimantFirstName" },
  { label: "Claimant (Middle)",       key: "claimantMiddleName", fallback: "-" },
  { label: "Type of Assistance",      key: "typeOfAssistance" },
  { label: "Code",                    key: "code" },
  { label: "Remark",                  key: "remark",  fallback: "-" }
];

function showToast(msg, type) {
  var t = document.getElementById("toast");
  if (t) {
    t.textContent = msg;
    t.className = "show " + (type || "success");
    setTimeout(function() { t.className = ""; }, 3800);
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  var d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}

function getCellValue(col, data) {
  var val = data[col.key];
  if (col.useFormatDate && val) val = formatDate(val);
  if ((val === undefined || val === null || val === "") && col.fallback) val = col.fallback;
  return val != null && val !== "" ? String(val) : "";
}

var GET_NEXT_SEQ_ERROR_MSG = "Could not load next number from sheet. Check connection and try again.";

function fetchNextSequenceFromSheet(yyyymmdd) {
  if (!isOnline()) return Promise.resolve(null);
  return new Promise(function(resolve) {
    var callbackName = "__aicsCb" + Date.now();
    var script;
    var timeout = setTimeout(function() {
      if (window[callbackName]) {
        window[callbackName] = null;
        try { if (script && script.parentNode) document.body.removeChild(script); } catch (e) {}
        showToast(GET_NEXT_SEQ_ERROR_MSG, "error");
        resolve(null);
      }
    }, 12000);
    window[callbackName] = function(data) {
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script && script.parentNode) document.body.removeChild(script); } catch (e) {}
      try {
        if (typeof data === "object" && data !== null && data.status === "error" && data.message) {
          showToast(data.message, "error");
          resolve(null);
          return;
        }
        var next = typeof data === "object" && data !== null && typeof data.nextSeq === "number" ? data.nextSeq : null;
        if (next === null) showToast(GET_NEXT_SEQ_ERROR_MSG, "error");
        resolve(next);
      } catch (e) {
        showToast(GET_NEXT_SEQ_ERROR_MSG, "error");
        resolve(null);
      }
    };
    var url = APPS_SCRIPT_URL + "?action=getNextSeq&date=" + encodeURIComponent(yyyymmdd) +
      "&callback=" + callbackName +
      "&token=" + encodeURIComponent(APPS_SCRIPT_TOKEN) +
      "&_=" + Date.now();
    script = document.createElement("script");
    script.onerror = function() {
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script.parentNode) document.body.removeChild(script); } catch (e) {}
      showToast(GET_NEXT_SEQ_ERROR_MSG, "error");
      resolve(null);
    };
    script.src = url;
    document.body.appendChild(script);
  });
}

var COOLDOWN_TYPES = { "Maintenance": true, "Dialysis": true, "Chemotherapy": true, "Medicine": true, "Laboratory": true, "Hospital Bill": true, "Confinement": true, "Others": true };
var ELIGIBILITY_CHECK_FAILED_MSG = "Could not verify eligibility. Please check your connection and try again.";

function checkEligibility(patientName, typeOfAssistance) {
  return new Promise(function (resolve) {
    patientName = (patientName || "").trim();
    typeOfAssistance = (typeOfAssistance || "").trim();
    if (!patientName || !typeOfAssistance || !COOLDOWN_TYPES[typeOfAssistance]) {
      resolve({ hasRecord: false, canRequest: true, message: "" });
      return;
    }
    var queueResult = checkQueueForEligibility(patientName, typeOfAssistance);
    if (queueResult && !queueResult.canRequest) { resolve(queueResult); return; }

    if (!isOnline()) {
      var offlineCacheResult = null;
      try {
        if (typeof window.AICS_checkEligibilityOffline === "function") {
          offlineCacheResult = window.AICS_checkEligibilityOffline(patientName, typeOfAssistance);
        }
      } catch (e) { offlineCacheResult = null; }
      if (offlineCacheResult && offlineCacheResult.hasRecord && !offlineCacheResult.canRequest) {
        resolve(Object.assign({}, offlineCacheResult, { fromCache: true }));
        return;
      }
      var cached = getCachedEligibility(patientName, typeOfAssistance);
      if (cached && !cached.canRequest) { resolve(Object.assign({}, cached, { fromCache: true })); return; }
      if (queueResult) { resolve(queueResult); return; }
      if (offlineCacheResult && !offlineCacheResult.cacheEmpty) { resolve(Object.assign({}, offlineCacheResult, { fromCache: true })); return; }
      if (cached) { resolve(Object.assign({}, cached, { fromCache: true })); return; }
      resolve({ hasRecord: false, canRequest: true, message: "Offline: eligibility check skipped. Please verify manually.", eligibilityCheckFailed: true });
      return;
    }

    var callbackName = "__aicsEligibility" + Date.now();
    var script;
    var timeout = setTimeout(function () {
      if (window[callbackName]) {
        window[callbackName] = null;
        try { if (script && script.parentNode) document.body.removeChild(script); } catch (e) {}
        var cachedTimeout = getCachedEligibility(patientName, typeOfAssistance);
        if (cachedTimeout) resolve(Object.assign({}, cachedTimeout, { fromCache: true }));
        else resolve({ hasRecord: false, canRequest: true, message: ELIGIBILITY_CHECK_FAILED_MSG, eligibilityCheckFailed: true });
      }
    }, 10000);

    window[callbackName] = function (data) {
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script && script.parentNode) document.body.removeChild(script); } catch (e) {}
      try {
        if (typeof data === "object" && data !== null) {
          setCachedEligibility(patientName, typeOfAssistance, data);
          resolve(data);
        } else {
          var cachedInner = getCachedEligibility(patientName, typeOfAssistance);
          resolve(cachedInner ? Object.assign({}, cachedInner, { fromCache: true }) : { hasRecord: false, canRequest: true, message: ELIGIBILITY_CHECK_FAILED_MSG, eligibilityCheckFailed: true });
        }
      } catch (e) {
        var cachedCatch = getCachedEligibility(patientName, typeOfAssistance);
        resolve(cachedCatch ? Object.assign({}, cachedCatch, { fromCache: true }) : { hasRecord: false, canRequest: true, message: ELIGIBILITY_CHECK_FAILED_MSG, eligibilityCheckFailed: true });
      }
    };

    var url = APPS_SCRIPT_URL + "?action=checkEligibility&patientName=" + encodeURIComponent(patientName) +
      "&typeOfAssistance=" + encodeURIComponent(typeOfAssistance) +
      "&callback=" + callbackName +
      "&token=" + encodeURIComponent(APPS_SCRIPT_TOKEN) +
      "&_=" + Date.now();
    script = document.createElement("script");
    script.onerror = function () {
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script.parentNode) document.body.removeChild(script); } catch (e) {}
      var cached = getCachedEligibility(patientName, typeOfAssistance);
      resolve(cached ? Object.assign({}, cached, { fromCache: true }) : { hasRecord: false, canRequest: true, message: ELIGIBILITY_CHECK_FAILED_MSG, eligibilityCheckFailed: true });
    };
    script.src = url;
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
  var displayMessage = result.message;
  if (result.hasRecord && !result.canRequest && result.lastRequestDate && result.eligibleAgainDate) {
    var lastReadable = result.lastRequestDateReadable || formatDate(result.lastRequestDate);
    var eligibleReadable = result.eligibleAgainDateReadable || formatDate(result.eligibleAgainDate);
    var type = result.typeOfAssistance || "";
    displayMessage = "This patient already has a " + type + " request on " + lastReadable + ". They may request again on " + eligibleReadable + ".";
  }
  if (result.fromCache) displayMessage += " (cached)";
  if (result.fromQueue) displayMessage += " (offline queue)";
  el.textContent = displayMessage;
  el.className = "eligibility-message " + (result.eligibilityCheckFailed ? "eligibility-info" : (result.canRequest ? "eligibility-ok" : "eligibility-warn"));
  el.style.display = "block";
}

function showCooldownWarningModal(result) {
  var modal = document.getElementById("cooldownWarningModal");
  var typeEl = document.getElementById("cooldownType");
  var lastEl = document.getElementById("cooldownLastDate");
  var eligibleEl = document.getElementById("cooldownEligibleDate");
  if (typeEl) typeEl.textContent = result.typeOfAssistance || "";
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
    seq = parseInt(localStorage.getItem("assistanceForm_seq_" + yyyymmdd) || "0", 10) + 1;
    localStorage.setItem("assistanceForm_seq_" + yyyymmdd, String(seq));
  }
  var prefix = "AICS-" + yyyymmdd + "-";
  var maxQSeq = 0;
  getOfflineQueue().forEach(function (item) {
    var id = (item.data && item.data.idNumber) || "";
    if (id.indexOf(prefix) === 0) {
      var s = parseInt(id.split("-").pop(), 10);
      if (!isNaN(s)) maxQSeq = Math.max(maxQSeq, s);
    }
  });
  if (seq <= maxQSeq) seq = maxQSeq + 1;
  return "AICS-" + yyyymmdd + "-" + String(seq).padStart(3, "0");
}

function updateTransactionNumber() {
  if (!isOnline()) {
    setStoredTransactionNumber(generateTransactionNumber());
    return;
  }
  var dateInput = document.getElementById("date");
  var dateStr = dateInput && dateInput.value ? dateInput.value : "";
  if (!dateStr) {
    var today = new Date();
    dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  }
  var yyyymmdd = dateStr.replace(/-/g, "");
  setStoredTransactionNumber("", false);
  fetchNextSequenceFromSheet(yyyymmdd).then(function(nextSeq) {
    var value;
    if (nextSeq !== null) {
      value = generateTransactionNumber(nextSeq);
      localStorage.removeItem("assistanceForm_seq_" + yyyymmdd);
      setStoredTransactionNumber(value, false);
    } else {
      value = generateTransactionNumber();
      setStoredTransactionNumber(value, true);
    }
  });
}

function setTransactionNumberTypeCode() {
  var el = document.getElementById("idNumber");
  if (!el || !el.value) return;
  var parts = el.value.split("-");
  var seq = parts.length === 4 ? parts[3] : parts.length === 3 ? parts[2] : null;
  if (seq == null) return;
  el.value = "AICS-" + parts[1] + "-" + seq;
  localStorage.setItem(STORAGE_KEY_TXN, el.value);
}

/** MSWD: getFormData with partitioned address and new fields */
function getFormData() {
  var last  = document.getElementById("claimantLastName").value.trim();
  var first = document.getElementById("claimantFirstName").value.trim();
  var mid   = document.getElementById("claimantMiddleName").value.trim();
  var claimantFull = last + (first ? ", " + first : "") + (mid ? " " + mid : "");
  var typeOfAssistance = document.getElementById("typeOfAssistance").value;
  var remark = document.getElementById("remark").value.trim();
  var address = buildAddressFromParts();
  var addrNum = document.getElementById("addrNumber") ? document.getElementById("addrNumber").value.trim() : "";
  var addrStreet = document.getElementById("addrStreet") ? document.getElementById("addrStreet").value.trim() : "";
  var addrBarangay = document.getElementById("addrBarangay") ? document.getElementById("addrBarangay").value.trim() : "";
  var addrMuni = document.getElementById("addrMunicipality") ? document.getElementById("addrMunicipality").value.trim() : "";
  var addrProv = document.getElementById("addrProvince") ? document.getElementById("addrProvince").value.trim() : "";

  return {
    idNumber:               document.getElementById("idNumber").value.trim(),
    date:                   document.getElementById("date").value,
    patientName:            document.getElementById("patientName").value.trim(),
    address:                address,
    addrNumber:             addrNum,
    addrStreet:             addrStreet,
    addrBarangay:           addrBarangay,
    addrMunicipality:       addrMuni,
    addrProvince:           addrProv,
    age:                    document.getElementById("age").value.trim(),
    dob:                    document.getElementById("dateOfBirth") ? document.getElementById("dateOfBirth").value.trim() : "",
    sex:                    document.getElementById("sex").value,
    civilStatus:            getRadioValue("civilStatus"),
    educationalAttainment:  document.getElementById("educationalAttainment").value,
    occupation:             document.getElementById("occupation").value,
    fourPsStatus:           getRadioValue("fourPsStatus"),
    claimantLastName:       last,
    claimantFirstName:      first,
    claimantMiddleName:     mid,
    claimant:               claimantFull,
    contactNumber:          (document.getElementById("contactNumber") && document.getElementById("contactNumber").value) ? document.getElementById("contactNumber").value.trim() : "",
    typeOfAssistance:       typeOfAssistance,
    code:                   document.getElementById("code").value.trim(),
    remark:                 remark,
    encodedBy:              document.getElementById("encodedBy").value.trim()
  };
}

function capitalizeFormData(data) {
  var out = {};
  for (var key in data) {
    if (data.hasOwnProperty(key)) {
      var v = data[key];
      out[key] = (key === "age" || key === "dob" || typeof v !== "string") ? v : v.toUpperCase();
    }
  }
  var last = out.claimantLastName || "";
  var first = out.claimantFirstName || "";
  var mid = out.claimantMiddleName || "";
  out.claimant = last + (first ? ", " + first : "") + (mid ? " " + mid : "");
  return out;
}

var REQUIRED_FIELDS = [
  { key: "idNumber", label: "Transaction Number" },
  { key: "date", label: "Date" },
  { key: "patientName", label: "Name of Patient / Deceased" },
  { key: "age", label: "Age" },
  { key: "dob", label: "Date of Birth" },
  { key: "sex", label: "Sex" },
  { key: "civilStatus", label: "Civil Status" },
  { key: "educationalAttainment", label: "Educational Attainment" },
  { key: "occupation", label: "Occupation" },
  { key: "fourPsStatus", label: "4P's Status" },
  { key: "addrNumber", label: "Address – Number" },
  { key: "addrStreet", label: "Address – Street" },
  { key: "addrBarangay", label: "Address – Barangay" },
  { key: "addrMunicipality", label: "Address – Municipality" },
  { key: "addrProvince", label: "Address – Province" },
  { key: "claimantLastName", label: "Claimant (Last name)" },
  { key: "claimantFirstName", label: "Claimant (First name)" },
  { key: "typeOfAssistance", label: "Type of Assistance" },
  { key: "encodedBy", label: "Encoded By" }
];

var CONTACT_MAX_LENGTH = 11;
function isValidContactNumber(value) {
  if (!value || typeof value !== "string") return true;
  return String(value).trim().length <= CONTACT_MAX_LENGTH;
}

function validateForm(data) {
  var missing = [];
  for (var i = 0; i < REQUIRED_FIELDS.length; i++) {
    var field = REQUIRED_FIELDS[i];
    var val = data[field.key];
    if (val === undefined || val === null || String(val).trim() === "") missing.push(field.label);
  }
  var contactVal = (data.contactNumber || "").trim();
  if (contactVal && !isValidContactNumber(contactVal)) {
    return { valid: false, message: "Contact Number must be at most 11 characters.", missing: missing };
  }
  if (missing.length === 0) return { valid: true };
  return { valid: false, message: "Please fill in: " + missing.join(", ") + ".", missing: missing };
}

function sendToSheet(data) {
  return new Promise(function(resolve) {
    if (!isOnline()) { resolve({ status: "offline" }); return; }
    var params = new URLSearchParams({
      idNumber: data.idNumber,
      date: data.date,
      patientName: data.patientName,
      address: data.address,
      contactNumber: data.contactNumber || "",
      claimantLastName: data.claimantLastName,
      claimantFirstName: data.claimantFirstName,
      claimantMiddleName: data.claimantMiddleName,
      typeOfAssistance: data.typeOfAssistance,
      code: data.code,
      remark: data.remark,
      encodedBy: data.encodedBy
    });
    var callbackName = "__aicsSubmit" + Date.now();
    var script;
    var timeout = setTimeout(function() {
      if (window[callbackName]) {
        window[callbackName] = null;
        try { if (script && script.parentNode) document.body.removeChild(script); } catch (e) {}
        resolve({ status: "error", message: "Request timed out. Please check your connection and try again." });
      }
    }, 15000);
    window[callbackName] = function(res) {
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script && script.parentNode) document.body.removeChild(script); } catch (e) {}
      try {
        var status = (res && res.status) || "error";
        var message = (res && res.message) ? String(res.message) : "";
        resolve({ status: status, message: message });
      } catch (e) {
        resolve({ status: "error", message: "Invalid response from server. Please try again." });
      }
    };
    var query = params.toString() + "&callback=" + encodeURIComponent(callbackName) + "&token=" + encodeURIComponent(APPS_SCRIPT_TOKEN) + "&_=" + Date.now();
    script = document.createElement("script");
    script.onerror = function() {
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script.parentNode) document.body.removeChild(script); } catch (e) {}
      resolve({ status: "error", message: "Network error. Check your connection and try again." });
    };
    script.src = APPS_SCRIPT_URL + "?" + query;
    document.body.appendChild(script);
  });
}

/** Format today's date as "MONTH DAY, YEAR" (e.g. MARCH 3, 2026) */
function formatTodayDate() {
  return new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }).toUpperCase();
}

/** MSWD: AICS Intake Sheet slip HTML – v2 (improved spacing + real checkboxes) */
function getSlipHtml(data) {
  var headerImg = "images/NewHeader.jpg";
  var first = (data.claimantFirstName || "").toUpperCase();
  var mid   = (data.claimantMiddleName || "").toUpperCase();
  var last  = (data.claimantLastName  || "").toUpperCase();
  var claimantFull = (last + (first ? ", " + first : "") + (mid ? " " + mid : "")).toUpperCase();
  var todayStr = formatTodayDate();

  // ── Civil status checkboxes ──────────────────────────────────────
  var civilOptions = ["Single", "Married", "Widow/er", "Solo parent/Separated"];
  var civilHtml = "<div class='civil-status-group'>";
  civilOptions.forEach(function(opt) {
    var checked = (data.civilStatus || "").toLowerCase() === opt.toLowerCase();
    civilHtml +=
      "<span class='civil-option'>" +
        "<span class='checkbox-sq'>" + (checked ? "&#10003;" : "&nbsp;") + "</span>" +
        "<span>" + opt + "</span>" +
      "</span>";
  });
  civilHtml += "</div>";

  // ── 4Ps checkboxes ───────────────────────────────────────────────
  var is4ps  = data.fourPsStatus === "4P's";
  var isNon  = data.fourPsStatus === "NON 4P's";
  var fpsHtml =
    "<div class='fps-row-group'>" +
      "<span class='fps-option'>" +
        "<span class='checkbox-sq'>" + (is4ps  ? "&#10003;" : "&nbsp;") + "</span>" +
        "<span>4Ps</span>" +
      "</span>" +
      "<span class='fps-option'>" +
        "<span class='checkbox-sq'>" + (isNon  ? "&#10003;" : "&nbsp;") + "</span>" +
        "<span>NON 4Ps</span>" +
      "</span>" +
    "</div>";

  // ── DOB ──────────────────────────────────────────────────────────
  var dobParts = ["", "", ""];
  if (data.dob) {
    var dp = data.dob.split("-");
    if (dp.length === 3) { dobParts[0] = dp[1]; dobParts[1] = dp[2]; dobParts[2] = dp[0]; }
    else dobParts[2] = data.dob;
  }
  var dobHtml =
    "<div class='dob-group'>" +
      "<div class='dob-unit dob-mm'><div class='field-value slip-center'>" + dobParts[0] + "</div><span class='field-sublabel'>MM</span></div>" +
      "<div class='dob-unit dob-dd'><div class='field-value slip-center'>" + dobParts[1] + "</div><span class='field-sublabel'>DD</span></div>" +
      "<div class='dob-unit dob-yyyy'><div class='field-value slip-center'>" + dobParts[2] + "</div><span class='field-sublabel'>YYYY</span></div>" +
    "</div>";

  // ── Blank family rows (8mm tall each) ───────────────────────────
  var blankRows = "";
  for (var r = 0; r < 7; r++) {
    blankRows +=
      "<tr>" +
        "<td style='width:18%'></td><td style='width:12%'></td><td style='width:18%'></td>" +
        "<td style='width:7%'></td><td style='width:6%'></td><td style='width:10%'></td>" +
        "<td style='width:12%'></td><td style='width:11%'></td><td style='width:6%'></td>" +
      "</tr>";
  }

  return (
    "<div class='slip-mswd-intake'>" +

      // Header
      "<div class='slip-header'><img class='slip-header-img' src='" + headerImg + "' alt='Municipality of Oton' /></div>" +
      (data._queued ? "<div class='queued-banner'>&#9888; QUEUED &ndash; not yet synced</div>" : "") +

      "<div class='mswd-slip-body'>" +

        // Transaction strip
        "<div class='slip-intake-txn-row'>" +
          "<span>Transaction No.: " + (data.idNumber || "") + "</span>" +
          "<span>Date: " + (formatDate(data.date) || "").toUpperCase() + "</span>" +
          "<span>Type: " + (data.typeOfAssistance || "") + "</span>" +
        "</div>" +

        // Titles
        "<div class='slip-intake-title'>Assistance to Individuals in Crisis Situation (AICS)</div>" +
        "<div class='slip-intake-subtitle'>INTAKE SHEET</div>" +
        "<div class='slip-intake-instruction'>Palinog Sulatan Sang Kompleto Nga Impormasyon Sang Naga Process / Claimant</div>" +

        // ── PANGALAN ──
        "<div class='slip-intake-section'>" +
          "<div class='slip-intake-label'>Pangalan (Name)</div>" +
          "<div class='slip-intake-name-row'>" +
            "<div class='slip-intake-name-box'><div class='field-value slip-center'>" + first + "</div><span class='field-sublabel'>(First Name)</span></div>" +
            "<div class='slip-intake-name-box'><div class='field-value slip-center'>" + mid   + "</div><span class='field-sublabel'>(Middle Name)</span></div>" +
            "<div class='slip-intake-name-box'><div class='field-value slip-center'>" + last  + "</div><span class='field-sublabel'>(Last Name)</span></div>" +
          "</div>" +
        "</div>" +

        // ── COMPLETE ADDRESS ──
        "<div class='slip-intake-section'>" +
          "<div class='slip-intake-label'>Complete Address:</div>" +
          "<div class='slip-intake-addr-row'>" +
            "<div class='slip-intake-addr-box' style='flex:0.6'><div class='field-value slip-center'>" + (data.addrNumber      || "") + "</div><span class='field-sublabel'>No.</span></div>" +
            "<div class='slip-intake-addr-box' style='flex:1.2'><div class='field-value slip-center'>" + (data.addrStreet      || "") + "</div><span class='field-sublabel'>Street</span></div>" +
            "<div class='slip-intake-addr-box' style='flex:1.4'><div class='field-value slip-center'>" + (data.addrBarangay    || "") + "</div><span class='field-sublabel'>Barangay</span></div>" +
            "<div class='slip-intake-addr-box' style='flex:1.2'><div class='field-value slip-center'>" + (data.addrMunicipality|| "") + "</div><span class='field-sublabel'>Municipality</span></div>" +
            "<div class='slip-intake-addr-box' style='flex:1.1'><div class='field-value slip-center'>" + (data.addrProvince    || "") + "</div><span class='field-sublabel'>Province</span></div>" +
          "</div>" +
        "</div>" +

        // ── ROW 1: Edad / Sex / Civil Status ──
        "<div class='slip-intake-demo-row'>" +
          "<div class='item'>" +
            "<span class='item-label'>Edad:</span>" +
            "<div class='item-value slip-center' style='min-width:12mm'>" + (data.age || "") + "</div>" +
          "</div>" +
          "<div class='item'>" +
            "<span class='item-label'>Sex:</span>" +
            "<div class='item-value slip-center' style='min-width:16mm'>" + (data.sex || "") + "</div>" +
          "</div>" +
          "<div class='item stretch'>" +
            "<span class='item-label'>Civil Status:</span>" +
            civilHtml +
          "</div>" +
        "</div>" +

        // ── ROW 2: Educational Attainment / Occupation ──
        "<div class='slip-intake-demo-row'>" +
          "<div class='item stretch'>" +
            "<span class='item-label'>Educational Attainment:</span>" +
            "<div class='item-value' style='min-width:60mm'>" + (data.educationalAttainment || "") + "</div>" +
          "</div>" +
          "<div class='item stretch'>" +
            "<span class='item-label'>Occupation:</span>" +
            "<div class='item-value' style='min-width:50mm'>" + (data.occupation || "") + "</div>" +
          "</div>" +
        "</div>" +

        // ── ROW 3: Date of Birth / Contact No. / 4Ps ──
        "<div class='slip-intake-demo-row'>" +
          "<div class='item'>" +
            "<span class='item-label'>Date of Birth:</span>" +
            dobHtml +
          "</div>" +
          "<div class='item stretch'>" +
            "<span class='item-label'>Contact No.:</span>" +
            "<div class='item-value' style='min-width:40mm'>" + (data.contactNumber || "") + "</div>" +
          "</div>" +
          fpsHtml +
        "</div>" +

        // ── FAMILY COMPOSITION ──
        "<div class='family-section'>" +
          "<div class='family-instruction-1'>Tanan Nga Upod Sa Panimalay Sang Naga Process/Claimant</div>" +
          "<div class='family-instruction-2'>Ilakip Ang Benepisyaryo <span>(Pasyente / Napatay)</span></div>" +
          "<div class='family-comp-label'>Family Composition:</div>" +
          "<table class='slip-intake-table'>" +
            "<thead>" +
              "<tr>" +
                "<th colspan='3'>NAME</th>" +
                "<th rowspan='2'>AGE</th><th rowspan='2'>SEX</th><th rowspan='2'>CIVIL STATUS</th>" +
                "<th rowspan='2'>RELATIONSHIP</th><th rowspan='2'>EDUC. ATTAINMENT</th><th rowspan='2'>OCCUPATION</th>" +
              "</tr>" +
              "<tr>" +
                "<th style='width:18%'>FIRST NAME</th>" +
                "<th style='width:12%'>MIDDLE INIT.</th>" +
                "<th style='width:18%'>LAST NAME</th>" +
              "</tr>" +
            "</thead>" +
            "<tbody>" + blankRows + "</tbody>" +
          "</table>" +
        "</div>" +

        // ── FOOTER ──
        "<div class='slip-intake-footer'>" +
          "<div class='foot-item'>" +
            "<div class='foot-line'>" + claimantFull + "</div>" +
            "Pirma Sa Ibabaw Sang Gin-Imprinta Nga Ngalan Sang Cliente" +
          "</div>" +
          "<div class='foot-item'>" +
            "<div class='foot-line'></div>" +
            "Gin-Assess Kag Gin-Interbyu Sang Social Worker" +
          "</div>" +
          "<div class='foot-item'>" +
            "<div class='foot-line'>" + todayStr + "</div>" +
            "Petsa" +
          "</div>" +
        "</div>" +

      "</div>" + // /mswd-slip-body
    "</div>"    // /slip-mswd-intake
  );
}

function buildPreview(data) {
  var el = document.getElementById("pdf-preview");
  if (el) el.innerHTML = getSlipHtml(data);
}

function buildPrintArea(data) {
  var el = document.getElementById("printable-area");
  if (el) el.innerHTML = getSlipHtml(data);
}

function downloadAsPDF() {
  var data = capitalizeFormData(getFormData());
  var jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) {
    showToast("PDF export unavailable (jsPDF not loaded).", "error");
    return;
  }

  var doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  var pageW = doc.internal.pageSize.getWidth();
  var margin = 12;
  var y = margin;
  var f = 7;
  var claimantFull = (data.claimantLastName || "") + (data.claimantFirstName ? ", " + data.claimantFirstName : "") + (data.claimantMiddleName ? " " + data.claimantMiddleName : "");
  var todayStr = formatTodayDate();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text("TRANSACTION NO.: " + (data.idNumber || ""), margin, y);
  doc.text("DATE: " + (formatDate(data.date) || "").toUpperCase(), pageW / 2, y, { align: "center" });
  doc.text("TYPE: " + (data.typeOfAssistance || ""), pageW - margin, y, { align: "right" });
  y += 5;

  doc.setFontSize(10);
  doc.text("ASSISTANCE TO INDIVIDUALS IN CRISIS SITUATION (AICS)", pageW / 2, y, { align: "center" });
  y += 4;
  doc.setFontSize(9);
  doc.text("INTAKE SHEET", pageW / 2, y, { align: "center" });
  y += 4;
  doc.setFontSize(6);
  doc.text("PAHILOG SULATAN SANG KOMPLETO NGA IMPORMASYON SANG NAGA PROCESS / CLAIMANT", pageW / 2, y, { align: "center" });
  y += 5;

  doc.setFontSize(f);
  doc.setFont("helvetica", "bold");
  doc.text("PANGALAN (Name):", margin, y);
  y += 3;
  var colW = (pageW - margin * 2 - 4) / 3;
  var c1 = margin + colW / 2, c2 = margin + colW + 2 + colW / 2, c3 = margin + (colW + 2) * 2 + colW / 2;
  doc.setFont("helvetica", "normal");
  doc.text((data.claimantFirstName || "").substring(0, 25), c1, y, { align: "center" });
  doc.text((data.claimantMiddleName || "").substring(0, 25), c2, y, { align: "center" });
  doc.text((data.claimantLastName || "").substring(0, 25), c3, y, { align: "center" });
  y += 1;
  doc.setDrawColor(0, 0, 0);
  doc.line(margin, y, margin + colW, y); doc.line(margin + colW + 2, y, margin + (colW + 2) * 2, y); doc.line(margin + (colW + 2) * 2, y, pageW - margin, y);
  y += 1;
  doc.setFontSize(5); doc.text("(FIRST NAME)", c1, y, { align: "center" }); doc.text("(MIDDLE NAME)", c2, y, { align: "center" }); doc.text("(LAST NAME)", c3, y, { align: "center" });
  y += 5;

  doc.setFontSize(f); doc.setFont("helvetica", "bold");
  doc.text("COMPLETE ADDRESS:", margin, y);
  y += 3;
  var aW = (pageW - margin * 2 - 4) / 5;
  var ac = [margin + aW / 2, margin + aW + 1 + aW / 2, margin + (aW + 1) * 2 + aW / 2, margin + (aW + 1) * 3 + aW / 2, margin + (aW + 1) * 4 + aW / 2];
  doc.setFont("helvetica", "normal");
  doc.text(String(data.addrNumber || "").substring(0, 8), ac[0], y, { align: "center" });
  doc.text(String(data.addrStreet || "").substring(0, 18), ac[1], y, { align: "center" });
  doc.text(String(data.addrBarangay || "").substring(0, 15), ac[2], y, { align: "center" });
  doc.text(String(data.addrMunicipality || "").substring(0, 12), ac[3], y, { align: "center" });
  doc.text(String(data.addrProvince || "").substring(0, 10), ac[4], y, { align: "center" });
  y += 1;
  for (var i = 0; i < 5; i++) doc.line(margin + (aW + 1) * i, y, margin + (aW + 1) * i + aW, y);
  y += 1;
  doc.setFontSize(5); doc.text("NO.", ac[0], y, { align: "center" }); doc.text("STREET", ac[1], y, { align: "center" }); doc.text("BARANGAY", ac[2], y, { align: "center" }); doc.text("MUNICIPALITY", ac[3], y, { align: "center" }); doc.text("PROVINCE", ac[4], y, { align: "center" });
  y += 5;

  doc.setFontSize(f);
  doc.text("EDAD:", margin, y); doc.text(data.age || "", margin + 12, y, { align: "center" });
  doc.text("SEX:", margin + 25, y); doc.text(data.sex || "", margin + 38, y, { align: "center" });
  doc.text("CIVIL STATUS:", margin + 50, y); doc.text(data.civilStatus || "", margin + 75, y, { align: "center" });
  y += 5;
  doc.text("EDUCATIONAL ATTAINMENT: " + (data.educationalAttainment || ""), margin, y);
  y += 4;
  doc.text("OCCUPATION: " + (data.occupation || ""), margin, y);
  y += 5;
  doc.text("DATE OF BIRTH: " + (data.dob || "___ MM  ___ DD  ____ YYYY"), margin, y);
  doc.text("CONTACT NO.: " + (data.contactNumber || ""), margin + 85, y);
  doc.text((data.fourPsStatus === "4P's" ? "[X]" : "[ ]") + " 4Ps   " + (data.fourPsStatus === "NON 4P's" ? "[X]" : "[ ]") + " NON 4Ps", margin + 140, y);
  y += 6;

  doc.setFontSize(6); doc.setFont("helvetica", "bold");
  doc.text("TANAN NGA UPOD SA PANIMALAY SANG NAGA PROCESS/CLAIMANT", margin, y);
  y += 3;
  doc.setTextColor(180, 0, 0);
  doc.text("ILAKIP ANG BENEPISYARYO (PASYENTE / NAPATAY)", margin, y);
  doc.setTextColor(0, 0, 0);
  y += 3;
  doc.text("FAMILY COMPOSITION:", margin, y);
  y += 4;

  var tw = pageW - margin * 2;
  var cw = [tw * 0.16, tw * 0.12, tw * 0.16, tw * 0.07, tw * 0.07, tw * 0.12, tw * 0.12, tw * 0.12, tw * 0.06];
  doc.setFillColor(201, 162, 39);
  doc.rect(margin, y, tw, 6, "F");
  doc.setFontSize(5); doc.setFont("helvetica", "bold");
  var x0 = margin;
  var cx = [x0];
  for (var ci = 0; ci < 9; ci++) cx[ci + 1] = cx[ci] + cw[ci];
  doc.text("NAME", (cx[1] + cx[3]) / 2, y + 2, { align: "center" });
  doc.text("AGE", (cx[3] + cx[4]) / 2, y + 2, { align: "center" });
  doc.text("SEX", (cx[4] + cx[5]) / 2, y + 2, { align: "center" });
  doc.text("CIVIL STATUS", (cx[5] + cx[6]) / 2, y + 2, { align: "center" });
  doc.text("RELATIONSHIP", (cx[6] + cx[7]) / 2, y + 2, { align: "center" });
  doc.text("EDUC. ATTAINMENT", (cx[7] + cx[8]) / 2, y + 2, { align: "center" });
  doc.text("OCCUPATION", (cx[8] + cx[9]) / 2, y + 2, { align: "center" });
  y += 4;
  doc.rect(margin, y, tw, 4, "F");
  doc.text("FIRST NAME", (cx[0] + cx[1]) / 2, y + 2.5, { align: "center" });
  doc.text("MID. INIT.", (cx[1] + cx[2]) / 2, y + 2.5, { align: "center" });
  doc.text("LAST NAME", (cx[2] + cx[3]) / 2, y + 2.5, { align: "center" });
  y += 4;

  for (var row = 0; row < 7; row++) {
    for (var col = 0, xx = margin; col < 9; col++) {
      doc.rect(xx, y, cw[col], 5, "S");
      xx += cw[col];
    }
    y += 5;
  }
  y += 5;

  var fw = (pageW - margin * 2 - 8) / 3;
  doc.setFont("helvetica", "normal"); doc.setFontSize(5);
  doc.text(claimantFull, margin + fw / 2, y, { align: "center" });
  doc.text("", margin + fw + 4 + fw / 2, y, { align: "center" });
  doc.text(todayStr, margin + (fw + 4) * 2 + fw / 2, y, { align: "center" });
  y += 1;
  doc.line(margin, y, margin + fw, y); doc.line(margin + fw + 4, y, margin + (fw + 4) * 2, y); doc.line(margin + (fw + 4) * 2, y, pageW - margin, y);
  y += 4;
  doc.text("PIRMA SA IBABAW SANG GIN-IMPRINTA NGA NGALAN SANG CLIENTE", margin + fw / 2, y, { align: "center" });
  doc.text("GIN-ASSESS KAG GIN-INTERBYU SANG SOCIAL WORKER", margin + fw + 4 + fw / 2, y, { align: "center" });
  doc.text("PETSA", margin + (fw + 4) * 2 + fw / 2, y, { align: "center" });

  doc.save("AICS_Intake_" + (data.idNumber || "").replace(/[^a-zA-Z0-9]/g, "_") + "_" + (data.date || "") + ".pdf");
}

function downloadAsCSV(data) {
  var headers = COLUMNS.map(function(col) { return '"' + (col.label || "").replace(/"/g, '""') + '"'; }).join(",");
  var row = COLUMNS.map(function(col) {
    var val = getCellValue(col, data) || "";
    return '"' + String(val).replace(/"/g, '""') + '"';
  }).join(",");
  var csv = headers + "\r\n" + row;
  var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "MSWD_" + (data.idNumber || "").replace(/[^a-zA-Z0-9]/g, "_") + "_" + (data.date || "") + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById("assistanceForm").addEventListener("submit", function(e) {
  e.preventDefault();
  var data = getFormData();
  var validation = validateForm(data);
  if (!validation.valid) {
    showToast(validation.message || "Please fill in all required fields.", "error");
    return;
  }

  var typeHasCooldown = COOLDOWN_TYPES[data.typeOfAssistance];
  var btn = document.getElementById("submitBtn");
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
      if (result.eligibilityCheckFailed) showEligibilityMessage(result);
      else showEligibilityMessage({ message: "" });
      doSubmit(data);
    });
  } else {
    doSubmit(data);
  }
});

function doSubmit(data) {
  data = capitalizeFormData(data);
  var btn = document.getElementById("submitBtn");
  btn.disabled = true;

  if (!isOnline()) {
    data._queued = true;
    enqueueOffline(data);
    btn.disabled = false;
    btn.textContent = "Submit & Preview";
    showToast("Offline: record queued. Will sync when online.", "warn");
    showEligibilityMessage({ message: "" });
    localStorage.setItem(STORAGE_KEY_LAST_DATA, JSON.stringify(data));
    buildPreview(data);
    buildPrintArea(data);
    document.getElementById("pdfModal").classList.add("open");
    updateTransactionNumber();
    return;
  }

  btn.textContent = "Submitting…";
  sendToSheet(data).then(function (result) {
    btn.disabled = false;
    btn.textContent = "Submit & Preview";
    if (result.status === "error") {
      data._queued = true;
      enqueueOffline(data);
      showToast("Server error. Record queued for auto-sync.", "warn");
    } else {
      showToast("Record saved to Google Sheets!");
      data._queued = false;
    }
    showEligibilityMessage({ message: "" });
    localStorage.setItem(STORAGE_KEY_LAST_DATA, JSON.stringify(data));
    buildPreview(data);
    buildPrintArea(data);
    document.getElementById("pdfModal").classList.add("open");
    updateTransactionNumber();
  });
}

document.getElementById("printBtn").addEventListener("click", function() {
  var pa = document.getElementById("printable-area");
  if (pa) {
    pa.style.display = "block";
    window.print();
    setTimeout(function() { pa.style.display = "none"; }, 1500);
  }
});

document.getElementById("downloadPdf").addEventListener("click", downloadAsPDF);

var csvBtn = document.getElementById("downloadCsv");
if (csvBtn) csvBtn.addEventListener("click", function() { downloadAsCSV(capitalizeFormData(getFormData())); });

function closePreviewModalAndClearForm() {
  document.getElementById("pdfModal").classList.remove("open");
  clearFormAndFetchNextTxn();
}

["closeModal", "closeModal2"].forEach(function(id) {
  var el = document.getElementById(id);
  if (el) el.addEventListener("click", function(e) { e.preventDefault(); e.stopPropagation(); closePreviewModalAndClearForm(); });
});
document.getElementById("pdfModal").addEventListener("click", function(e) {
  if (e.target === document.getElementById("pdfModal")) closePreviewModalAndClearForm();
});

["cooldownModalOk", "cooldownModalClose"].forEach(function(id) {
  var el = document.getElementById(id);
  if (el) el.addEventListener("click", closeCooldownWarningModal);
});
document.getElementById("cooldownWarningModal").addEventListener("click", function(e) {
  if (e.target === document.getElementById("cooldownWarningModal")) closeCooldownWarningModal();
});

/** MSWD: Clear form and restore address defaults */
function clearFormAndFetchNextTxn() {
  document.getElementById("assistanceForm").reset();
  var dateEl = document.getElementById("date");
  if (dateEl) dateEl.valueAsDate = new Date();
  var muni = document.getElementById("addrMunicipality");
  if (muni) muni.value = "Oton";
  var prov = document.getElementById("addrProvince");
  if (prov) prov.value = "Iloilo";
  showEligibilityMessage({ message: "" });
  updateTransactionNumber();
}

document.getElementById("clearBtn").addEventListener("click", clearFormAndFetchNextTxn);

var dateEl = document.getElementById("date");
if (dateEl) dateEl.valueAsDate = new Date();
updateTransactionNumber();
updateOfflineBanner();
if (isOnline()) setTimeout(flushOfflineQueue, 2000);

document.getElementById("date").addEventListener("change", updateTransactionNumber);
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

var contactEl = document.getElementById("contactNumber");
if (contactEl) contactEl.addEventListener("input", function() {
  if (this.value.length > 11) this.value = this.value.substring(0, 11);
});
