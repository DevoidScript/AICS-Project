/**
 * Offline queue — saves failed submissions to localStorage, auto-syncs when back online.
 * Uses window "online"/"offline" plus a real ping to confirm connectivity.
 * Banner slides down when offline; badge shows pending sync count.
 * Requires: assistance-form.js loaded first (APPS_SCRIPT_URL, sendToSheet).
 */
(function() {
  var STORAGE_KEY = "aicsOfflineQueue";
  var PING_TIMEOUT_MS = 8000;

  function getQueue() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function setQueue(arr) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {}
    updateBadge();
  }

  function updateBadge() {
    var badge = document.getElementById("offline-queue-badge");
    if (!badge) return;
    var queue = getQueue();
    var n = queue.length;
    if (n === 0) {
      badge.style.display = "none";
      badge.textContent = "";
    } else {
      badge.style.display = "inline-flex";
      badge.textContent = n;
    }
  }

  function setBannerVisible(visible) {
    var bar = document.getElementById("offline-banner");
    if (!bar) return;
    if (visible) {
      bar.classList.add("offline-banner-visible");
      document.body.classList.add("offline-banner-open");
    } else {
      bar.classList.remove("offline-banner-visible");
      document.body.classList.remove("offline-banner-open");
    }
  }

  function ping(callback) {
    var url = (typeof APPS_SCRIPT_URL !== "undefined" ? APPS_SCRIPT_URL : window.APPS_SCRIPT_URL || "") + "?action=ping&callback=__aicsPing" + Date.now() + "&_=" + Date.now();
    if (!url || url.indexOf("?action=ping") === -1) {
      callback(false);
      return;
    }
    var callbackName = "__aicsPing" + Date.now();
    var script = document.createElement("script");
    var done = false;
    var timeout = setTimeout(function() {
      if (done) return;
      done = true;
      try { if (script.parentNode) script.parentNode.removeChild(script); } catch (e) {}
      window[callbackName] = null;
      callback(false);
    }, PING_TIMEOUT_MS);
    window[callbackName] = function(data) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script.parentNode) script.parentNode.removeChild(script); } catch (e) {}
      callback(typeof data === "object" && data && data.status === "ok");
    };
    script.onerror = function() {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      window[callbackName] = null;
      try { if (script.parentNode) script.parentNode.removeChild(script); } catch (e) {}
      callback(false);
    };
    script.src = url;
    document.body.appendChild(script);
  }

  function syncNext() {
    var queue = getQueue();
    if (queue.length === 0) {
      updateBadge();
      return;
    }
    var sendToSheet = window.AICS_sendToSheet;
    if (!sendToSheet) {
      return;
    }
    var item = queue[0];
    sendToSheet(item).then(function(result) {
      if (result.status === "success") {
        if (typeof window.AICS_removePendingTxn === "function") {
          window.AICS_removePendingTxn(item.idNumber);
        }
        queue = getQueue();
        if (queue.length > 0 && queue[0].idNumber === item.idNumber) {
          queue.shift();
          setQueue(queue);
        }
        syncNext();
      } else {
        updateBadge();
      }
    });
  }

  function onOnline() {
    ping(function(ok) {
      if (ok) {
        window.AICS_offlineQueueOnline = true;
        setBannerVisible(false);
        syncNext();
      }
    });
  }

  function onOffline() {
    window.AICS_offlineQueueOnline = false;
    setBannerVisible(true);
    updateBadge();
  }

  function checkOnlineState() {
    if (!navigator.onLine) {
      onOffline();
      return;
    }
    ping(function(ok) {
      if (ok) {
        window.AICS_offlineQueueOnline = true;
        setBannerVisible(false);
        updateBadge();
        syncNext();
      } else {
        onOffline();
      }
    });
  }

  function addToQueue(data) {
    var queue = getQueue();
    queue.push(data);
    setQueue(queue);
    setBannerVisible(true);
  }

  window.AICS_addToOfflineQueue = addToQueue;
  window.AICS_isOnline = function() {
    return !!window.AICS_offlineQueueOnline;
  };
  window.AICS_getOfflineQueueCount = function() {
    return getQueue().length;
  };

  window.addEventListener("online", function() {
    checkOnlineState();
  });
  window.addEventListener("offline", function() {
    onOffline();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      checkOnlineState();
      updateBadge();
    });
  } else {
    checkOnlineState();
    updateBadge();
  }
})();
