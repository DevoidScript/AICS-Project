/**
 * Offline eligibility — MSWD version.
 * Caches all MSWD Google Sheets records locally for offline cooldown checks.
 * Uses a separate storage key from the AICS cache so the two never mix.
 * Fetches via ?action=getAllRecords (3 fields only: patientName, date, typeOfAssistance).
 * Refreshes every 30 minutes.
 */
(function() {
    var STORAGE_KEY = "mswdRecordCache";  // separate from AICS "aicsRecordCache"
    var REFRESH_INTERVAL_MS = 30 * 60 * 1000;
    var STALE_THRESHOLD_MS = 60 * 60 * 1000;
    var GET_ALL_RECORDS_TIMEOUT_MS = 20000;
  
    function getCooldownMonths(typeOfAssistance) {
      var t = (typeOfAssistance || "").trim().toLowerCase();
  
      if (
        t.indexOf("maintenance") !== -1 ||
        t.indexOf("dialysis") !== -1 ||
        t.indexOf("chemotherapy") !== -1
      ) return 6;
  
      if (
        t.indexOf("medicine") !== -1 ||
        t.indexOf("laboratory") !== -1 ||
        t.indexOf("hospital bill") !== -1 ||
        t.indexOf("confinement") !== -1 ||
        t.indexOf("others") !== -1
      ) return 12;
  
      // Legacy "Others" entries stored as long descriptions (old records)
      // that don't match any known type above are treated as Others (12 months)
      if (
        t.indexOf("referral") !== -1 ||
        t.indexOf("survivor") !== -1 ||
        t.indexOf("detained") !== -1 ||
        t.indexOf("peso") !== -1 ||
        t.indexOf("letter") !== -1 ||
        t.indexOf("refer") !== -1 ||
        t.indexOf("partially") !== -1
      ) return 12;
  
      return null;
    }
  
    function formatDateReadable(dateStr) {
      if (!dateStr) return "";
      var d = new Date(dateStr + "T00:00:00");
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
    }
  
    function getCache() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        var obj = JSON.parse(raw);
        if (!obj || !Array.isArray(obj.records)) return null;
        return obj;
      } catch (e) {
        return null;
      }
    }
  
    function setCache(fetchedAt, records) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ fetchedAt: fetchedAt, records: records || [] }));
      } catch (e) {}
      updateCacheStatusBar();
    }
  
    function formatTimeAgo(ms) {
      if (ms < 60000) return "just now";
      if (ms < 3600000) return Math.floor(ms / 60000) + " min ago";
      if (ms < 86400000) return Math.floor(ms / 3600000) + " hr ago";
      return Math.floor(ms / 86400000) + " day(s) ago";
    }
  
    function updateCacheStatusBar() {
      var bar = document.getElementById("cache-status-bar");
      if (!bar) return;
      var cache = getCache();
      if (!cache || !cache.fetchedAt || !cache.records) {
        bar.className = "cache-status-bar cache-status-none";
        bar.textContent = "No offline cache — connect to internet to load records";
        return;
      }
      var count = cache.records.length;
      var fetchedAt = new Date(cache.fetchedAt).getTime();
      var age = Date.now() - fetchedAt;
      var timeAgo = formatTimeAgo(age);
      var countText = count + " record" + (count !== 1 ? "s" : "") + " cached";
      if (age <= STALE_THRESHOLD_MS) {
        bar.className = "cache-status-bar cache-status-fresh";
        bar.textContent = countText + " (updated " + timeAgo + ")";
      } else if (age <= REFRESH_INTERVAL_MS * 2) {
        bar.className = "cache-status-bar cache-status-stale";
        bar.textContent = countText + " (updated " + timeAgo + " — may be outdated)";
      } else {
        bar.className = "cache-status-bar cache-status-none";
        bar.textContent = countText + " (updated " + timeAgo + " — refresh when online)";
      }
    }
  
    function fetchAllRecords(callback) {
      var baseUrl = (typeof APPS_SCRIPT_URL !== "undefined" ? APPS_SCRIPT_URL : window.APPS_SCRIPT_URL || "");
      var token   = (typeof APPS_SCRIPT_TOKEN !== "undefined" ? APPS_SCRIPT_TOKEN : window.APPS_SCRIPT_TOKEN || "");
      if (!baseUrl) { if (callback) callback(null); return; }
      var callbackName = "__mswdGetAllRecords" + Date.now();
      var url = baseUrl + "?action=getAllRecords&callback=" + callbackName +
                "&token=" + encodeURIComponent(token) + "&_=" + Date.now();
      var script = document.createElement("script");
      var done = false;
      var timeout = setTimeout(function() {
        if (done) return;
        done = true;
        try { if (script.parentNode) script.parentNode.removeChild(script); } catch (e) {}
        window[callbackName] = null;
        if (callback) callback(null);
      }, GET_ALL_RECORDS_TIMEOUT_MS);
      window[callbackName] = function(data) {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        window[callbackName] = null;
        try { if (script.parentNode) script.parentNode.removeChild(script); } catch (e) {}
        if (typeof data === "object" && data && Array.isArray(data.records)) {
          setCache(data.fetchedAt || null, data.records);
          if (callback) callback(data);
        } else {
          if (callback) callback(null);
        }
      };
      script.onerror = function() {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        window[callbackName] = null;
        try { if (script.parentNode) script.parentNode.removeChild(script); } catch (e) {}
        if (callback) callback(null);
      };
      script.src = url;
      document.body.appendChild(script);
    }
  
    function refreshCacheIfOnline() {
      if (!navigator.onLine) return;
      fetchAllRecords(function() {
        updateCacheStatusBar();
      });
    }
  
    function checkEligibilityOffline(patientName, typeOfAssistance) {
      var cache = getCache();
      var payload = { hasRecord: false, lastRequestDate: null, eligibleAgainDate: null, canRequest: true, message: "" };
      patientName = (patientName || "").trim();
      typeOfAssistance = (typeOfAssistance || "").trim();
  
      if (!patientName || !typeOfAssistance) {
        payload.message = "Patient name and type of assistance are required.";
        return payload;
      }
  
      var cooldownMonths = getCooldownMonths(typeOfAssistance);
      if (cooldownMonths === null) {
        payload.message = "This type has no cooldown restriction.";
        return payload;
      }
  
      if (!cache || !cache.records || cache.records.length === 0) {
        payload.message = "Offline cache is empty. Connect to the internet to refresh, or submission is blocked.";
        payload.cacheEmpty = true;
        return payload;
      }
  
      var patientLower = patientName.toLowerCase();
      var blockingEligibleDate = null;
      var blockingRequestDate = null;
      var blockingRequestType = null;
  
      for (var i = 0; i < cache.records.length; i++) {
        var r = cache.records[i];
        var rowPatient = (r.patientName || "").trim();
        if (rowPatient.toLowerCase() !== patientLower) continue;
        var rowType = (r.typeOfAssistance || "").trim();
        var rowCooldown = getCooldownMonths(rowType);
        if (rowCooldown === null) continue;
        var dateStr = r.date;
        if (!dateStr) continue;
        var d = new Date(dateStr + "T00:00:00");
        if (isNaN(d.getTime())) continue;
        var rowEligible = new Date(d.getTime());
        rowEligible.setMonth(rowEligible.getMonth() + rowCooldown);
        rowEligible.setDate(rowEligible.getDate() + 1);
        if (!blockingEligibleDate || rowEligible > blockingEligibleDate) {
          blockingEligibleDate = rowEligible;
          blockingRequestDate = d;
          blockingRequestType = rowType;
        }
      }
  
      if (!blockingEligibleDate) return payload;
  
      payload.hasRecord = true;
      payload.typeOfAssistance = blockingRequestType;
      payload.lastRequestDate = blockingRequestDate.getFullYear() + "-" + String(blockingRequestDate.getMonth() + 1).padStart(2, "0") + "-" + String(blockingRequestDate.getDate()).padStart(2, "0");
      var eligible = new Date(blockingEligibleDate.getTime());
      payload.eligibleAgainDate = eligible.getFullYear() + "-" + String(eligible.getMonth() + 1).padStart(2, "0") + "-" + String(eligible.getDate()).padStart(2, "0");
      payload.lastRequestDateReadable = formatDateReadable(payload.lastRequestDate);
      payload.eligibleAgainDateReadable = formatDateReadable(payload.eligibleAgainDate);
  
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      eligible.setHours(0, 0, 0, 0);
      payload.canRequest = today >= eligible;
      if (payload.canRequest) {
        payload.message = "A previous " + blockingRequestType + " request was recorded. You may submit a new " + typeOfAssistance + " request.";
      } else {
        payload.message = "This patient already has a " + blockingRequestType + " request on " + payload.lastRequestDateReadable + ". They may request again on " + payload.eligibleAgainDateReadable + ".";
      }
      return payload;
    }
  
    window.AICS_checkEligibilityOffline = checkEligibilityOffline;  // kept for MSWD.js compatibility
    window.MSWD_checkEligibilityOffline = checkEligibilityOffline;
    window.MSWD_getRecordCache = getCache;
    window.MSWD_hasRecordCache = function() {
      var c = getCache();
      return !!(c && c.records && c.records.length > 0);
    };
    window.MSWD_refreshRecordCache = fetchAllRecords;
  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function() {
        refreshCacheIfOnline();
        updateCacheStatusBar();
        setInterval(refreshCacheIfOnline, REFRESH_INTERVAL_MS);
      });
    } else {
      refreshCacheIfOnline();
      updateCacheStatusBar();
      setInterval(refreshCacheIfOnline, REFRESH_INTERVAL_MS);
    }
  })();