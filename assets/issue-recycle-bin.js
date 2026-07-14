/* Empire World EGS — issue tracker recycle bin UI (civil / electric / fire) */

function _rbNumToLetters(n) {
  var s = '';
  n = n + 1;
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function _rbIssueRef(num) {
  num = Number(num || 0);
  if (!num) return '';
  var idx = num - 1;
  return _rbNumToLetters(Math.floor(idx / 999)) + ((idx % 999) + 1);
}
function _rbEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
function _rbLoc(meta) {
  var spot = String(meta.spot || '').trim();
  if (spot) spot = spot.charAt(0).toLowerCase() + spot.slice(1);
  var b = String(meta.building || '').trim();
  var f = String(meta.floor || '').trim();
  return b + '-' + f + (spot ? '. ' + spot : '');
}
function _rbProjectName(code) {
  if (typeof projectNames !== 'undefined' && projectNames[code]) return projectNames[code];
  return code || '';
}
function empireIssueRbItemHtml(it) {
  var when = String(it.deletedAt || '').replace('T', ' ').slice(0, 16);
  var how = it.reason === 'reset'
    ? '<span class="rb-how reset">Reset</span>'
    : '<span class="rb-how">Delete</span>';
  var photo = String(it.photo || it.fixedPhoto || '').trim();
  var ref = it.num ? ('#' + _rbIssueRef(it.num)) : '';
  var title = _rbEsc(it.issueType || it.preview || 'Record');
  var loc = _rbEsc(_rbLoc(it));
  var proj = _rbEsc(_rbProjectName(it.project));
  var status = it.status === 'fixed' ? '<span class="rb-status fixed">Fixed</span>' : '<span class="rb-status open">Open</span>';
  var thumb = photo
    ? '<img class="rb-thumb" src="' + _rbEsc(photo) + '" alt="" loading="lazy" onclick="typeof bigImg===\'function\'&&bigImg(this.src)">'
    : '<div class="rb-thumb rb-thumb-empty">No photo</div>';
  var refLine = ref ? ('<span class="rb-ref">' + ref + '</span> ') : '';
  return '<div class="rb-item">' + thumb +
    '<div class="rb-body">' +
      '<div class="rb-title">' + refLine + title + ' ' + status + '</div>' +
      (loc ? '<div class="rb-loc">' + loc + (proj ? ' · ' + proj : '') + '</div>' : '') +
      '<div class="rb-meta">' + when + ' · ' + how + '</div>' +
    '</div>' +
    '<div class="rb-actions">' +
      '<button type="button" onclick="rbRestore(\'' + it.trashId + '\')" class="rb-restore">↩️ Restore</button>' +
      '<button type="button" onclick="rbPurge(\'' + it.trashId + '\')" class="rb-purge" title="Delete forever">✕</button>' +
    '</div></div>';
}
function empireIssueRbRenderList(items) {
  if (!items || !items.length) return '<p style="color:var(--text-faint);">The bin is empty. 🎉</p>';
  return '<div class="rb-items">' + items.map(empireIssueRbItemHtml).join('') + '</div>';
}

function empireIssueRbInit(opts) {
  opts = opts || {};
  var RB_DEPT = opts.dept || '';
  var RB_SHEETS = opts.sheets || [];
  var RB_RELOAD = opts.reload || 'loadIssues';
  function RBTOK() { return empireGetToken(); }
  function rbReload() {
    try { if (typeof window[RB_RELOAD] === 'function') window[RB_RELOAD](true); } catch (e) {}
  }
  window.rbOpen = function () {
    document.getElementById('rbModal').style.display = 'flex';
    window.rbLoad();
  };
  window.rbClose = function () {
    document.getElementById('rbModal').style.display = 'none';
  };
  window.rbLoad = function () {
    var box = document.getElementById('rbList');
    box.innerHTML = LOADING_HTML;
    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'getTrash', dept: RB_DEPT, sheets: RB_SHEETS, token: RBTOK() })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!Array.isArray(d)) {
        box.innerHTML = '<p style="color:#C5504F;">' + _rbEsc((d && d.message) || 'Could not load — update & redeploy the Apps Script.') + '</p>';
        return;
      }
      box.innerHTML = empireIssueRbRenderList(d);
    }).catch(function (e) {
      box.innerHTML = '<p style="color:#C5504F;">❌ ' + _rbEsc(e.message) + '</p>';
    });
  };
  window.rbRestore = function (id) {
    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'restoreTrash', dept: RB_DEPT, trashIds: [id], token: RBTOK() })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok === false) throw new Error(d.message || d.error || 'Restore failed');
      window.rbLoad();
      rbReload();
    }).catch(function (e) { alert('❌ ' + e.message); });
  };
  window.rbPurge = function (id) {
    uiConfirm('Delete this record forever? This cannot be undone.').then(function (ok) {
      if (!ok) return;
      fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'purgeTrash', dept: RB_DEPT, trashIds: [id], token: RBTOK() })
      }).then(function (r) { return r.json(); }).then(function () { window.rbLoad(); })
        .catch(function (e) { alert('❌ ' + e.message); });
    });
  };
  window.rbRestoreAll = function () {
    uiConfirm('Restore everything in the bin? Each issue keeps its original reference number and location.').then(function (ok) {
      if (!ok) return;
      fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'restoreTrash', dept: RB_DEPT, sheets: RB_SHEETS, token: RBTOK() })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.ok === false) throw new Error(d.message || d.error || 'Restore failed');
        window.rbLoad();
        rbReload();
      }).catch(function (e) { alert('❌ ' + e.message); });
    });
  };
  window.rbEmpty = function () {
    uiConfirm('Empty the bin? Everything here will be deleted forever.').then(function (ok) {
      if (!ok) return;
      fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'purgeTrash', dept: RB_DEPT, sheets: RB_SHEETS, token: RBTOK() })
      }).then(function (r) { return r.json(); }).then(function () { window.rbLoad(); })
        .catch(function (e) { alert('❌ ' + e.message); });
    });
  };
}
