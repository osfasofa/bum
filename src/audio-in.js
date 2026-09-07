// audio-in.js — every audio input the OS will admit to, and what it really hands over.
import { el, kv, pill, fill, log, emit, on, clamp, short, nice, fmtBool,
         makeMeter, dropMeters, saveBlob, stamp, safeName, topline, count } from './core.js';
import { devices, scan, onDevices } from './devices.js';
import { getCtx, startEngine, onEngine } from './engine.js';

/** key -> { key, label, kind, stream, track, source, splitter, analysers, bars, settings, caps } */
export const armed = new Map();
export function onArmed(fn) { return on('armed', fn); }

let ui = null;

/* ---------- arming ---------- */
export async function armInput(dev) {
  const ctx = getCtx() || await startEngine();
  if (!ctx) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: dev.deviceId ? { exact: dev.deviceId } : undefined,
        channelCount: { ideal: 32 },
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      },
    });
  } catch (err) {
    log('could not open ' + (dev.label || 'that input') + ': ' + err.name,
      err.name === 'NotReadableError' ? 'another application has it open exclusively. close that, or make an aggregate device.'
      : err.name === 'OverconstrainedError' ? 'the device refused one of the constraints outright.'
      : err.name === 'NotAllowedError' ? 'permission was refused for this origin.' : '', 'err');
    return;
  }

  const track = stream.getAudioTracks()[0];
  let settings = track.getSettings ? track.getSettings() : {};
  let caps = null;
  try { caps = track.getCapabilities ? track.getCapabilities() : null; } catch (e) {}

  const maxCh = caps && caps.channelCount && caps.channelCount.max;
  if (maxCh && settings.channelCount && maxCh > settings.channelCount) {
    try {
      await track.applyConstraints({ channelCount: { exact: maxCh } });
      settings = track.getSettings();
      log('re-negotiated to ' + settings.channelCount + ' channels',
          'the first grab reported ' + maxCh + ' as a capability but handed over fewer. applyConstraints asked again on the live track, with exact instead of ideal.');
    } catch (e) {
      log('device advertises ' + maxCh + ' channels but would not hand them over',
          'ideal was ignored and exact was refused. common with class-compliant interfaces on some drivers.');
    }
  }

  attach(dev.deviceId, dev.label || 'input', 'device', stream, track, settings, caps);
  const ch = armed.get(dev.deviceId).analysers.length;
  log('armed ' + (dev.label || 'input') + ': ' + ch + ' channel' + (ch > 1 ? 's' : '') + ' at ' + nice(settings.sampleRate || ctx.sampleRate) + ' Hz',
    ch > 1
      ? 'a multi-channel device arrives as one stream. ChannelSplitter fans it into ' + ch + ' separate jacks and each meter is one of them.'
      : 'one channel. we asked for 32 as ideal and the device said it has one. that is the AirPods situation — several microphones in there, one mono stream out of the OS.');
}

function attach(key, label, kind, stream, track, settings, caps) {
  const ctx = getCtx();
  const ch = clamp(settings.channelCount || (kind === 'display' ? 2 : 1), 1, 32);
  const source = ctx.createMediaStreamSource(stream);
  const splitter = ctx.createChannelSplitter(ch);
  source.connect(splitter);
  const analysers = [];
  for (let c = 0; c < ch; c++) {
    const a = ctx.createAnalyser();
    a.fftSize = 1024; a.smoothingTimeConstant = 0;
    splitter.connect(a, c);
    analysers.push(a);
  }
  const entry = { key, label, kind, stream, track, source, splitter, analysers, bars: [], settings, caps };
  armed.set(key, entry);
  track.onended = () => { log('input ended: ' + label, 'the device went away underneath us.'); disarm(key); };
  track.onmute = () => { log('input muted by the OS', 'something outside the tab took it, or the system muted it.'); render(); };
  track.onunmute = () => render();
  emit('armed', armed);
  render();
}

export function disarm(key) {
  const e = armed.get(key);
  if (!e) return;
  dropMeters(e.bars);
  try { e.stream.getTracks().forEach(t => t.stop()); } catch (err) {}
  try { e.source.disconnect(); } catch (err) {}
  armed.delete(key);
  emit('armed', armed);
  render();
  log('disarmed ' + e.label, 'stopping the track releases the device back to the OS and turns the recording indicator off.');
}

export function disarmAll() { for (const k of [...armed.keys()]) disarm(k); }

/* ---------- capture another tab ---------- */
async function captureDisplay() {
  if (!navigator.mediaDevices.getDisplayMedia) { log('getDisplayMedia not available here', '', 'err'); return; }
  const ctx = getCtx() || await startEngine();
  if (!ctx) return;
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); }
  catch (e) { log('screen capture cancelled or refused: ' + e.name, '', 'err'); return; }
  stream.getVideoTracks().forEach(t => t.stop());
  const track = stream.getAudioTracks()[0];
  if (!track) {
    log('screen capture gave video but no audio',
        'you have to tick the share-audio box in the picker, and only tab or window sharing offers it. Chrome on macOS cannot share whole-system audio at all — Chrome on Windows can.', 'err');
    return;
  }
  attach('display:' + Date.now(), 'captured tab / window audio', 'display', stream, track,
         track.getSettings ? track.getSettings() : {}, null);
  log('capturing another tab as an audio input',
      'this is the browser handing you another page’s output as a live stream. it behaves exactly like a hardware input from here on.');
}

/* ---------- record ---------- */
async function record(key, btn) {
  const e = armed.get(key);
  if (!e) return;
  if (typeof MediaRecorder === 'undefined') { log('no MediaRecorder in this browser', '', 'err'); return; }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find(t => MediaRecorder.isTypeSupported(t)) || '';
  let rec;
  try { rec = new MediaRecorder(e.stream, type ? { mimeType: type } : undefined); }
  catch (err) { log('recorder refused this stream: ' + err.name, '', 'err'); return; }
  const chunks = [];
  rec.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: type || 'audio/webm' });
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    saveBlob(blob, 'bum-' + safeName(e.label) + '-' + stamp() + '.' + ext);
    btn.classList.remove('on'); btn.textContent = 'RECORD 5s';
    log('recorded ' + (blob.size / 1024).toFixed(0) + ' KB from ' + e.label + ' as ' + (type || 'the default container'),
        'MediaRecorder takes the MediaStream directly, before the audio graph. it captures the device, not what you hear.');
  };
  rec.start();
  btn.classList.add('on'); btn.textContent = 'RECORDING…';
  setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 5000);
}

/* ---------- render ---------- */
function settingsGrid(e) {
  const s = e.settings || {};
  const ctx = getCtx();
  const rows = [
    ['channels', s.channelCount != null ? s.channelCount : '1 (assumed)'],
    ['sample rate', s.sampleRate ? nice(s.sampleRate) + ' Hz' : (ctx ? nice(ctx.sampleRate) + ' Hz (engine)' : '—')],
    ['sample size', s.sampleSize ? s.sampleSize + ' bit' : 'not reported'],
    ['echo cancellation', fmtBool(s.echoCancellation)],
    ['noise suppression', fmtBool(s.noiseSuppression)],
    ['auto gain', fmtBool(s.autoGainControl)],
    ['device latency', s.latency != null ? (s.latency * 1000).toFixed(1) + ' ms' : 'not reported'],
    ['track state', e.track ? e.track.readyState + (e.track.muted ? ' (muted by OS)' : '') : '—'],
  ];
  if (e.caps && e.caps.channelCount && e.caps.channelCount.max) rows.push(['channels available', e.caps.channelCount.max]);
  return kv(rows);
}

function metersFor(e) {
  const m = el('div', 'meters');
  dropMeters(e.bars);
  e.bars = e.analysers.map((a, i) => makeMeter(m, 'ch ' + (i + 1), a));
  return m;
}

function card(key, e, dev, i) {
  const c = el('div', 'dev' + (e ? ' armed' : ''));
  const hd = el('div', 'hd');
  hd.appendChild(el('div', 'nm', e && e.kind === 'display' ? e.label : (dev.label || 'input ' + (i + 1) + ' (name withheld)')));
  const tags = el('div', 'tags');
  if (e && e.kind === 'display') tags.appendChild(pill('screen / tab capture', 'hot'));
  else {
    if (dev.deviceId === 'default') tags.appendChild(pill('system default', 'hot'));
    if (dev.deviceId === 'communications') tags.appendChild(pill('comms default', 'hot'));
    tags.appendChild(pill('id ' + short(dev.deviceId)));
    if (dev.groupId) tags.appendChild(pill('grp ' + short(dev.groupId)));
  }
  hd.appendChild(tags);
  c.appendChild(hd);

  const row = el('div', 'row tight last');
  const b = el('button', e ? 'on' : '', e ? (e.kind === 'display' ? 'STOP CAPTURE' : 'DISARM') : 'ARM');
  b.onclick = () => (e ? disarm(key) : armInput(dev));
  row.appendChild(b);
  if (e) {
    const r = el('button', 'tiny', 'RECORD 5s');
    r.onclick = () => record(key, r);
    row.appendChild(r);
  }
  c.appendChild(row);
  if (e) { c.appendChild(settingsGrid(e)); c.appendChild(metersFor(e)); }
  return c;
}

function render() {
  if (!ui) return;
  const wrap = ui.list;
  wrap.textContent = '';
  for (const [key, e] of armed) if (e.kind === 'display') wrap.appendChild(card(key, e, {}, 0));
  const ins = devices.audioinput;
  if (!ins.length) {
    wrap.appendChild(el('p', 'empty', 'no audio inputs listed. either nothing is connected, or this browser is withholding the list until you grant permission.'));
  } else {
    ins.forEach((d, i) => wrap.appendChild(card(d.deviceId, armed.get(d.deviceId), d, i)));
  }
  topline('audio', count(devices.audioinput.length, 'audio in') + '<span class="sep">·</span>' +
                   count(devices.audiooutput.length, 'audio out') +
                   (armed.size ? '<span class="sep">·</span>' + count(armed.size, 'armed') : '') +
                   (ins.length && !ins.some(d => d.label) ? '<span class="sep">·</span><b>names withheld</b>' : ''));
}

export default {
  id: 'audio-in',
  title: 'ins',
  mount(root) {
    const row = el('div', 'row');
    const rescan = el('button', 'tiny', 'RESCAN INPUTS');
    const disp = el('button', 'tiny', 'CAPTURE TAB / SYSTEM AUDIO');
    row.append(rescan, disp);
    const list = el('div');
    const note = el('p', 'note',
      'Names stay blank until microphone permission is granted once for this origin. That is a privacy rule, not a bug — ' +
      'the device list alone would fingerprint you. Arming asks for 32 channels and turns off echo cancellation, noise ' +
      'suppression and gain control, then reports what you actually got.');
    root.append(row, list, note);
    ui = { list };
    rescan.onclick = () => scan();
    disp.onclick = captureDisplay;
    onDevices(render);
    onEngine(d => { if (d.event === 'closing') disarmAll(); });
    render();
  },
  snapshot() {
    return {
      armedCount: armed.size,
      armed: [...armed.values()].map(e => ({
        label: e.label, kind: e.kind, channels: e.analysers.length,
        settings: e.settings || null, capabilities: e.caps || null,
      })),
    };
  },
};
