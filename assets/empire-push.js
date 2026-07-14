/* Empire EGS — worker job-assignment push notifications (FCM + open-app fallback) */
(function () {
  var _knownJobIds = null;
  var _pollTimer = null;
  var WORKER_ISSUE_POLL_MS = 90000;
  var SW_URL = './firebase-messaging-sw.js';

  function pushConfigured() {
    return typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey &&
      typeof FIREBASE_VAPID_KEY !== 'undefined' && FIREBASE_VAPID_KEY;
  }

  function authSessionToken() {
    if (typeof issueToken === 'function') return issueToken() || '';
    if (typeof empireGetToken === 'function') return empireGetToken() || '';
    return '';
  }

  function isWorkerView() {
    return typeof isCivilWorker === 'function' && isCivilWorker();
  }

  function isStandaloneApp() {
    if (window.navigator.standalone === true) return true;
    if (!window.matchMedia) return false;
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches;
  }

  function setWorkerPushStatus(text) {
    var el = document.getElementById('workerPushStatus');
    if (el && text) el.textContent = text;
  }

  function setWorkerPushBanner(text, showBtn) {
    var el = document.getElementById('workerPushBanner');
    if (!el) return;
    if (!text) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = 'block';
    var h = '<span class="worker-loc-banner-text">' + text + '</span>';
    if (showBtn) {
      h += ' <button type="button" class="worker-loc-enable-btn" onclick="empirePushEnableAlerts()">Enable alerts</button>';
    }
    el.innerHTML = h;
  }

  function notifyViaServiceWorker(title, body, url) {
    if (!('serviceWorker' in navigator)) return;
    var send = function (reg) {
      var target = reg.active || reg.waiting || reg.installing;
      if (!target) return;
      target.postMessage({
        type: 'EMPUSH_SHOW',
        title: title,
        body: body,
        url: url || './civil-issue.html'
      });
    };
    if (navigator.serviceWorker.controller) {
      send({ active: navigator.serviceWorker.controller });
      return;
    }
    navigator.serviceWorker.ready.then(send).catch(function () {});
  }

  function showAssignNotification(count, body) {
    var title = count === 1 ? 'New job assigned' : count + ' new jobs assigned';
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        var n = new Notification(title, {
          body: body || 'Open the app to view details.',
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          tag: 'empire-assign',
          renotify: true
        });
        n.onclick = function () { window.focus(); n.close(); };
      } catch (e) {}
      notifyViaServiceWorker(title, body);
    }
  }

  function saveFcmToken(fcmToken) {
    if (!fcmToken || !window.GOOGLE_SCRIPT_URL || !window.ISSUE_CFG || !ISSUE_CFG.actions) return Promise.resolve(false);
    var act = ISSUE_CFG.actions.savePushToken;
    if (!act) return Promise.resolve(false);
    return fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: act,
        fcmToken: fcmToken,
        platform: 'web-fcm',
        token: authSessionToken()
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && (d.ok || d.success)) {
          setWorkerPushStatus('Alerts enabled. Tap Send test, then lock your phone.');
          setWorkerPushBanner('', false);
          return true;
        }
        var err = 'Could not register: ' + ((d && (d.message || d.error)) || 'server error');
        setWorkerPushStatus(err);
        setWorkerPushBanner(err, false);
        return false;
      })
      .catch(function () {
        var err = 'Could not reach server to register alerts.';
        setWorkerPushStatus(err);
        setWorkerPushBanner(err, false);
        return false;
      });
  }

  function getServiceWorkerRegistration() {
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('no-sw'));
    return navigator.serviceWorker.register(SW_URL, { scope: './', updateViaCache: 'none' })
      .then(function (reg) {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        if (reg.update) return reg.update().then(function () { return reg; });
        return reg;
      })
      .then(function (reg) {
        return navigator.serviceWorker.ready.then(function () { return reg; });
      });
  }

  function registerFirebaseMessaging() {
    if (!pushConfigured()) {
      setWorkerPushStatus('Firebase not configured on server.');
      return Promise.resolve(false);
    }
    if (typeof firebase === 'undefined' || !firebase.messaging) {
      setWorkerPushStatus('Firebase did not load — pull down to refresh.');
      return Promise.resolve(false);
    }
    if (!isStandaloneApp()) {
      setWorkerPushStatus('Warning: open from Home Screen icon for lock-screen alerts.');
    }
    return getServiceWorkerRegistration()
      .then(function (reg) {
        if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
        var messaging = firebase.messaging();
        return messaging.deleteToken().catch(function () { return null; }).then(function () {
          return messaging.getToken({
            vapidKey: FIREBASE_VAPID_KEY,
            serviceWorkerRegistration: reg
          });
        });
      })
      .then(function (token) {
        if (!token) {
          setWorkerPushStatus('No push token — reinstall app from Home Screen.');
          return false;
        }
        return saveFcmToken(token);
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : 'unknown error';
        if (/permission|denied/i.test(msg)) {
          setWorkerPushStatus('Notification permission denied.');
        } else if (/not authorized|permission-blocked/i.test(msg)) {
          setWorkerPushStatus('Add dizayeswar.github.io to Firebase Authorized domains.');
        } else {
          setWorkerPushStatus('Push failed: ' + msg);
        }
        return false;
      });
  }

  function startIssuePollFallback() {
    if (_pollTimer || !isWorkerView()) return;
    _pollTimer = setInterval(function () {
      if (typeof loadIssues === 'function') loadIssues(false);
    }, WORKER_ISSUE_POLL_MS);
  }

  function stopIssuePollFallback() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
    _knownJobIds = null;
  }

  window.empirePushOnIssuesLoaded = function (issues) {
    if (!isWorkerView()) return;
    var open = (issues || []).filter(function (r) { return r && r.status !== 'fixed'; });
    var idSet = {};
    open.forEach(function (r) { idSet[r.id] = true; });
    if (_knownJobIds === null) {
      _knownJobIds = idSet;
      return;
    }
    var fresh = open.filter(function (r) { return !_knownJobIds[r.id]; });
    _knownJobIds = idSet;
    if (!fresh.length) return;
    if (Notification.permission !== 'granted') return;
    var body;
    if (fresh.length === 1) {
      var r0 = fresh[0];
      var ref = typeof issueRef === 'function' ? '#' + issueRef(r0.num) + ' ' : '';
      body = ref + (r0.issueType || 'Job') + (r0.building ? ' — ' + r0.building : '');
    } else {
      body = fresh.length + ' new jobs — open the app';
    }
    showAssignNotification(fresh.length, body);
  };

  window.empirePushEnableAlerts = function () {
    if (!('Notification' in window)) {
      setWorkerPushStatus('This browser does not support notifications.');
      return;
    }
    if (!isStandaloneApp()) {
      setWorkerPushStatus('Install to Home Screen first, then open from the icon.');
    }
    Notification.requestPermission().then(function (perm) {
      if (perm === 'granted') {
        setWorkerPushStatus('Setting up alerts…');
        registerFirebaseMessaging().then(function () { startIssuePollFallback(); });
        if (typeof loadIssues === 'function') loadIssues(true);
        return;
      }
      if (perm === 'denied') {
        setWorkerPushStatus('Blocked — allow notifications in phone Settings → Lock Screen.');
        return;
      }
      setWorkerPushStatus('Tap Enable alerts and choose Allow.');
    });
  };

  window.empirePushInitWorker = function () {
    if (!isWorkerView()) return;
    stopIssuePollFallback();
    var ver = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : 'unknown';
    var mode = isStandaloneApp() ? 'Installed app' : 'Browser tab — install to Home Screen';
    if (!('Notification' in window)) {
      setWorkerPushStatus('Notifications not supported here. v' + ver);
      return;
    }
    setWorkerPushStatus(mode + ' · v' + ver + ' · Tap Enable alerts');
    var perm = Notification.permission;
    if (perm === 'granted') {
      registerFirebaseMessaging().then(function () { startIssuePollFallback(); });
    } else if (perm === 'denied') {
      setWorkerPushStatus('Notifications off — enable in phone Settings. v' + ver);
    }
  };

  window.empirePushStopWorker = function () {
    stopIssuePollFallback();
    setWorkerPushBanner('');
  };

  window.empirePushTestAlert = function () {
    if (!window.ISSUE_CFG || !ISSUE_CFG.actions || !ISSUE_CFG.actions.testPush) {
      setWorkerPushStatus('Test not available — update app (hard refresh).');
      return;
    }
    setWorkerPushStatus('Sending test… lock your phone now.');
    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: ISSUE_CFG.actions.testPush, token: authSessionToken() })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && (d.ok || d.success)) {
          setWorkerPushStatus('Server sent test — check lock screen in 10 sec.');
          return;
        }
        setWorkerPushStatus('Test failed: ' + ((d && (d.message || d.error)) || 'unknown'));
      })
      .catch(function () {
        setWorkerPushStatus('Test failed: no server — redeploy Apps Script?');
      });
  };

  window.empirePushDebug = function () {
    if (!window.ISSUE_CFG || !ISSUE_CFG.actions || !ISSUE_CFG.actions.debugPush) {
      setWorkerPushStatus('Diagnose not available — update app + redeploy backend.');
      return;
    }
    setWorkerPushStatus('Running diagnose…');
    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: ISSUE_CFG.actions.debugPush, token: authSessionToken() })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.ok === false) {
          setWorkerPushStatus('Diagnose failed: ' + ((d && (d.message || d.error)) || 'unknown'));
          return;
        }
        var msg = 'App:' + (isStandaloneApp() ? 'installed' : 'BROWSER') +
          ' · Perm:' + (Notification.permission || '?') +
          ' · Token:' + (d.hasToken ? 'yes' : 'NO') +
          ' · FCM:' + (d.fcmAuth ? 'OK' : 'FAIL') +
          ' · Send:' + (d.fcmSend || '?');
        setWorkerPushStatus(msg);
      })
      .catch(function () {
        setWorkerPushStatus('Diagnose failed: server unreachable.');
      });
  };

  if (typeof firebase !== 'undefined' && firebase.messaging && pushConfigured()) {
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      firebase.messaging().onMessage(function (payload) {
        var n = payload && payload.notification;
        if (!n) return;
        showAssignNotification(1, n.body || '');
      });
    } catch (e) {}
  }
})();
