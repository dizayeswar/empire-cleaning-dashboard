/* Civil issue assignment — voice note for workers */

var _assignVoiceDraft = {};
var _assignVoiceActiveId = '';
var ASSIGN_VOICE_MAX_SEC = 120;
var ASSIGN_VOICE_WAV_RATE = 16000;

function assignVoiceMicIconHtml() {
  return '<span class="nav-icon" style="width:15px;height:15px;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/></svg></span>';
}

function assignVoiceStopIconHtml() {
  return '<span class="nav-icon" style="width:15px;height:15px;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></span>';
}

function assignVoiceFormatSec(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function assignVoiceNowStamp() {
  var now = new Date();
  var z = function (n) { return String(n).padStart(2, '0'); };
  return now.getFullYear() + '-' + z(now.getMonth() + 1) + '-' + z(now.getDate()) + ' ' + z(now.getHours()) + ':' + z(now.getMinutes());
}

function assignVoiceIsApple_() {
  var ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function assignVoicePickRecordMime_() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  var candidates = assignVoiceIsApple_()
    ? ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm']
    : ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  for (var i = 0; i < candidates.length; i++) {
    if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
  }
  return '';
}

function assignVoiceShouldUseWav_(mime) {
  if (!mime) return true;
  var m = mime.toLowerCase();
  return m.indexOf('mp4') === -1 && m.indexOf('aac') === -1 && m.indexOf('m4a') === -1;
}

function assignVoiceDraft_(issueId) {
  issueId = String(issueId || '');
  if (!_assignVoiceDraft[issueId]) {
    _assignVoiceDraft[issueId] = {
      blob: null,
      previewUrl: '',
      durationSec: 0,
      recording: false,
      recorder: null,
      stream: null,
      timer: null,
      startedAt: 0,
      mode: '',
      audioContext: null,
      audioProcessor: null,
      audioSource: null,
      wavSamples: null
    };
  }
  return _assignVoiceDraft[issueId];
}

function assignVoiceReleaseDraft_(draft) {
  if (!draft) return;
  if (draft.previewUrl) {
    try { URL.revokeObjectURL(draft.previewUrl); } catch (e) {}
    draft.previewUrl = '';
  }
  draft.blob = null;
  draft.durationSec = 0;
}

function assignVoiceStopTracks_(draft) {
  if (!draft || !draft.stream) return;
  try {
    draft.stream.getTracks().forEach(function (t) { t.stop(); });
  } catch (e) {}
  draft.stream = null;
}

function assignVoiceStopWavCapture_(draft) {
  if (!draft) return;
  try {
    if (draft.audioProcessor) draft.audioProcessor.disconnect();
    if (draft.audioSource) draft.audioSource.disconnect();
    if (draft.audioContext) draft.audioContext.close();
  } catch (e) {}
  draft.audioProcessor = null;
  draft.audioSource = null;
  draft.audioContext = null;
}

function assignVoiceEncodeWavBlob_(sampleChunks, sampleRate) {
  sampleRate = sampleRate || ASSIGN_VOICE_WAV_RATE;
  var total = 0;
  for (var i = 0; i < sampleChunks.length; i++) total += sampleChunks[i].length;
  var buffer = new ArrayBuffer(44 + total * 2);
  var view = new DataView(buffer);
  function writeStr(off, str) {
    for (var k = 0; k < str.length; k++) view.setUint8(off + k, str.charCodeAt(k));
  }
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + total * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, total * 2, true);
  var offset = 44;
  for (var s = 0; s < sampleChunks.length; s++) {
    var chunk = sampleChunks[s];
    for (var j = 0; j < chunk.length; j++) {
      var v = Math.max(-1, Math.min(1, chunk[j]));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function assignVoiceStopRecording_(issueId, silent) {
  var draft = assignVoiceDraft_(issueId);
  if (draft.timer) {
    clearInterval(draft.timer);
    draft.timer = null;
  }
  if (draft.mode === 'wav' && draft.recording) {
    draft.recording = false;
    assignVoiceStopWavCapture_(draft);
    assignVoiceStopTracks_(draft);
    if (draft.wavSamples && draft.wavSamples.length) {
      draft.blob = assignVoiceEncodeWavBlob_(draft.wavSamples, ASSIGN_VOICE_WAV_RATE);
      draft.durationSec = Math.max(1, Math.round((Date.now() - draft.startedAt) / 1000));
      if (draft.previewUrl) {
        try { URL.revokeObjectURL(draft.previewUrl); } catch (e) {}
      }
      draft.previewUrl = URL.createObjectURL(draft.blob);
    }
    draft.wavSamples = null;
  } else if (draft.recorder && draft.recording) {
    try { draft.recorder.stop(); } catch (e) {}
  }
  draft.recording = false;
  if (_assignVoiceActiveId === issueId) _assignVoiceActiveId = '';
  if (!silent) assignVoiceRefreshUi(issueId);
}

function assignVoiceClearDraft(issueId) {
  assignVoiceStopRecording_(issueId, true);
  var draft = assignVoiceDraft_(issueId);
  assignVoiceReleaseDraft_(draft);
  assignVoiceStopTracks_(draft);
  assignVoiceStopWavCapture_(draft);
  draft.wavSamples = null;
  assignVoiceRefreshUi(issueId);
}

function assignVoiceCloseActive_() {
  if (_assignVoiceActiveId) assignVoiceStopRecording_(_assignVoiceActiveId, true);
}

function assignVoiceEscapeAttr_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function assignVoiceAudioHtml_(url, mimeType, playerId) {
  var typeAttr = mimeType ? (' type="' + assignVoiceEscapeAttr_(mimeType) + '"') : '';
  var h = '<div class="assign-voice-player"' + (playerId ? (' id="' + playerId + '"') : '') + '>';
  h += '<audio class="assign-voice-audio" controls playsinline webkit-playsinline preload="auto">';
  h += '<source src="' + assignVoiceEscapeAttr_(url) + '"' + typeAttr + '>';
  h += '</audio>';
  h += '<p class="assign-voice-open-link"><a href="' + assignVoiceEscapeAttr_(url) + '" target="_blank" rel="noopener">Open voice note</a> if playback does not start.</p>';
  h += '<p class="assign-voice-play-err" style="display:none;">Could not play this voice note on your device. Tap Open voice note above, or ask the editor to re-record.</p>';
  h += '</div>';
  return h;
}

function assignVoiceBindPlayers(root) {
  root = root || document;
  root.querySelectorAll('.assign-voice-player').forEach(function (wrap) {
    if (wrap.getAttribute('data-voice-bound') === '1') return;
    wrap.setAttribute('data-voice-bound', '1');
    var audio = wrap.querySelector('audio');
    var err = wrap.querySelector('.assign-voice-play-err');
    if (!audio) return;
    audio.addEventListener('error', function () {
      if (err) err.style.display = 'block';
    });
    audio.addEventListener('loadedmetadata', function () {
      if (err) err.style.display = 'none';
    });
  });
}

function assignVoiceRefreshUi(issueId) {
  var wrap = document.getElementById('assign-voice-' + issueId);
  if (!wrap) return;
  var draft = assignVoiceDraft_(issueId);
  var status = wrap.querySelector('.assign-voice-status');
  var timer = wrap.querySelector('.assign-voice-timer');
  var preview = wrap.querySelector('.assign-voice-preview');
  var recordBtn = wrap.querySelector('.assign-voice-record-btn');
  var stopBtn = wrap.querySelector('.assign-voice-stop-btn');
  var clearBtn = wrap.querySelector('.assign-voice-clear-btn');
  if (timer) timer.textContent = assignVoiceFormatSec(draft.durationSec);
  if (status) {
    if (draft.recording) status.textContent = 'Recording… tap Stop when finished.';
    else if (draft.blob) status.textContent = 'New voice note ready — saved when you click Save assignment.';
    else status.textContent = 'Tap Record and speak instructions for the worker.';
  }
  if (preview) {
    if (draft.blob && draft.previewUrl) {
      preview.innerHTML = assignVoiceAudioHtml_(draft.previewUrl, draft.blob.type || 'audio/wav');
      preview.style.display = 'block';
      assignVoiceBindPlayers(preview);
    } else {
      preview.innerHTML = '';
      preview.style.display = 'none';
    }
  }
  if (recordBtn) recordBtn.disabled = !!draft.recording;
  if (stopBtn) stopBtn.disabled = !draft.recording;
  if (clearBtn) clearBtn.style.display = (draft.blob && !draft.recording) ? 'inline-flex' : 'none';
}

function assignVoiceStartMediaRecorder_(issueId, stream, draft, mime) {
  var chunks = [];
  var recorder;
  try {
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (e) {
    assignVoiceStopTracks_(draft);
    assignVoiceStartWavRecord_(issueId, stream, draft);
    return;
  }
  draft.recorder = recorder;
  draft.mode = 'mediarecorder';
  draft.recording = true;
  draft.startedAt = Date.now();
  draft.durationSec = 0;
  _assignVoiceActiveId = issueId;
  recorder.ondataavailable = function (ev) {
    if (ev.data && ev.data.size) chunks.push(ev.data);
  };
  recorder.onstop = function () {
    assignVoiceStopTracks_(draft);
    draft.recording = false;
    if (_assignVoiceActiveId === issueId) _assignVoiceActiveId = '';
    if (!chunks.length) {
      assignVoiceRefreshUi(issueId);
      return;
    }
    var type = (chunks[0] && chunks[0].type) || mime || 'audio/wav';
    draft.blob = new Blob(chunks, { type: type });
    draft.durationSec = Math.max(1, Math.round((Date.now() - draft.startedAt) / 1000));
    if (draft.previewUrl) {
      try { URL.revokeObjectURL(draft.previewUrl); } catch (e) {}
    }
    draft.previewUrl = URL.createObjectURL(draft.blob);
    assignVoiceRefreshUi(issueId);
  };
  recorder.start(250);
  assignVoiceStartTimer_(issueId, draft);
  assignVoiceRefreshUi(issueId);
}

function assignVoiceStartWavRecord_(issueId, stream, draft) {
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    assignVoiceStopTracks_(draft);
    alert('Could not start recording on this device.');
    return;
  }
  draft.mode = 'wav';
  draft.recording = true;
  draft.startedAt = Date.now();
  draft.durationSec = 0;
  draft.wavSamples = [];
  _assignVoiceActiveId = issueId;
  try {
    draft.audioContext = new AudioCtx({ sampleRate: ASSIGN_VOICE_WAV_RATE });
  } catch (e) {
    draft.audioContext = new AudioCtx();
  }
  draft.audioSource = draft.audioContext.createMediaStreamSource(stream);
  draft.audioProcessor = draft.audioContext.createScriptProcessor(4096, 1, 1);
  draft.audioProcessor.onaudioprocess = function (ev) {
    if (!draft.recording) return;
    draft.wavSamples.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
  };
  draft.audioSource.connect(draft.audioProcessor);
  draft.audioProcessor.connect(draft.audioContext.destination);
  assignVoiceStartTimer_(issueId, draft);
  assignVoiceRefreshUi(issueId);
}

function assignVoiceStartTimer_(issueId, draft) {
  if (draft.timer) clearInterval(draft.timer);
  draft.timer = setInterval(function () {
    draft.durationSec = Math.floor((Date.now() - draft.startedAt) / 1000);
    assignVoiceRefreshUi(issueId);
    if (draft.durationSec >= ASSIGN_VOICE_MAX_SEC) assignVoiceStopRecord(issueId);
  }, 500);
}

function assignVoiceStartRecord(issueId) {
  issueId = String(issueId || '');
  if (!issueId) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Voice notes need microphone access. Use Chrome or Edge on a phone or computer with a mic.');
    return;
  }
  assignVoiceCloseActive_();
  var draft = assignVoiceDraft_(issueId);
  assignVoiceReleaseDraft_(draft);
  assignVoiceStopWavCapture_(draft);
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    draft.stream = stream;
    var mime = assignVoicePickRecordMime_();
    if (mime && !assignVoiceShouldUseWav_(mime)) {
      assignVoiceStartMediaRecorder_(issueId, stream, draft, mime);
    } else {
      assignVoiceStartWavRecord_(issueId, stream, draft);
    }
  }).catch(function () {
    alert('Microphone permission denied. Allow the mic in your browser settings and try again.');
  });
}

function assignVoiceStopRecord(issueId) {
  var draft = assignVoiceDraft_(issueId);
  if (!draft.recording) return;
  assignVoiceStopRecording_(issueId, false);
}

function assignVoiceNoteDisplayHtml(note, opts) {
  opts = opts || {};
  if (!note || !note.url) return '';
  var by = note.by ? (' from ' + note.by) : '';
  var at = note.at ? (' · ' + dateOnly(note.at)) : '';
  var dur = note.durationSec ? (' · ' + assignVoiceFormatSec(note.durationSec)) : '';
  var mime = note.mimeType || '';
  if (!mime && /\.webm/i.test(note.url)) mime = 'audio/webm';
  if (!mime && /\.wav/i.test(note.url)) mime = 'audio/wav';
  if (!mime && /\.m4a|\.mp4/i.test(note.url)) mime = 'audio/mp4';
  var h = '<div class="assign-voice-playback' + (opts.worker ? ' assign-voice-playback-worker' : '') + '">';
  h += '<div class="assign-voice-playback-label"><strong>Voice note' + by + '</strong><span class="assign-voice-playback-meta">' + at + dur + '</span></div>';
  h += assignVoiceAudioHtml_(note.url, mime);
  h += '</div>';
  return h;
}

function assignVoiceBoxHtml(issueId, existingNote) {
  issueId = String(issueId || '');
  var h = '<div class="assign-voice-note" id="assign-voice-' + issueId + '" onclick="event.stopPropagation()">';
  h += '<label>Voice note for worker <span class="assign-voice-optional">(optional)</span></label>';
  if (existingNote && existingNote.url) {
    h += assignVoiceNoteDisplayHtml(existingNote, { existing: true });
    h += '<p class="assign-voice-replace-hint">Record below to replace the current voice note when you save.</p>';
  }
  h += '<div class="assign-voice-controls">';
  h += '<button type="button" class="assign-voice-record-btn" onclick="assignVoiceStartRecord(\'' + issueId + '\')">' + assignVoiceMicIconHtml() + ' Record</button>';
  h += '<button type="button" class="assign-voice-stop-btn" onclick="assignVoiceStopRecord(\'' + issueId + '\')" disabled>' + assignVoiceStopIconHtml() + ' Stop</button>';
  h += '<span class="assign-voice-timer">0:00</span>';
  h += '<button type="button" class="assign-voice-clear-btn" onclick="assignVoiceClearDraft(\'' + issueId + '\')" style="display:none;">Clear</button>';
  h += '</div>';
  h += '<p class="assign-voice-status">Tap Record and speak instructions for the worker.</p>';
  h += '<div class="assign-voice-preview" style="display:none;"></div>';
  h += '</div>';
  return h;
}

function uploadAssignVoiceForIssue(issueId) {
  var draft = assignVoiceDraft_(issueId);
  if (!draft.blob) return Promise.resolve(null);
  if (!empireStorageConfigured()) {
    return Promise.reject(new Error('Supabase is not configured — cannot upload voice note.'));
  }
  return empireUploadAudioAsync(draft.blob, 'civil-assign-voice').then(function (url) {
    if (!url) {
      throw new Error(_lastEmpireUploadError || 'Voice note upload failed');
    }
    return {
      url: url,
      by: empireGetUser() || '',
      at: assignVoiceNowStamp(),
      durationSec: draft.durationSec || 0,
      mimeType: draft.blob.type || 'audio/wav'
    };
  });
}

function assignVoiceOnModalClose_() {
  assignVoiceCloseActive_();
}
