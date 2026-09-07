// permissions.js — the gate. Nothing named, nothing captured, until you say yes.
import { el, kv, pill, fill, log, esc, on, emit } from './core.js';
import { scan } from './devices.js';
import { startEngine } from './engine.js';
import { connect as connectMidi } from './midi.js';
import { askMotion } from './sensors.js';

const NAMES = [
  ['microphone', 'microphone'],
  ['camera', 'camera'],
  ['midi', 'midi (basic)'],
  ['midi-sysex', 'midi (sysex)'],
  ['speaker-selection', 'choose output device'],
  ['geolocation', 'geolocation'],
  ['notifications', 'notifications'],
  ['clipboard-read', 'clipboard read'],
  ['clipboard-write', 'clipboard write'],
  ['window-management', 'window management'],
  ['local-fonts', 'local fonts'],
  ['accelerometer', 'accelerometer'],
  ['gyroscope', 'gyroscope'],
  ['magnetometer', 'magnetometer'],
  ['ambient-light-sensor', 'ambient light'],
  ['screen-wake-lock', 'screen wake lock'],
  ['storage-access', 'storage access'],
  ['persistent-storage', 'persistent storage'],
];

const state = {};
let ui = null;

export async function read() {
  const q = navigator.permissions && navigator.permissions.query;
  for (const [name, label] of NAMES) {
    let s = 'unsupported';
    if (q) {
      try {
        const opts = name === 'midi-sysex' ? { name: 'midi', sysex: true } : { name };
        const st = await navigator.permissions.query(opts);
        s = st.state;
        if (!st.__bum) {
          st.__bum = true;
          st.onchange = () => { log('permission changed: ' + label + ' → ' + st.state); read(); };
        }
      } catch (e) { s = 'not queryable'; }
    }
    state[name] = s;
  }
  render();
}

function render() {
  if (!ui) return;
  const rows = [];
  for (const [name, label] of NAMES) {
    const s = state[name] || 'unknown';
    if (s === 'unsupported' || s === 'not queryable') {
      if (!ui.showAll) continue;                      // keep the common case short
    }
    const cls = s === 'granted' ? 'ok' : s === 'prompt' ? 'warn' : s === 'denied' ? 'bad' : '';
    rows.push([label, s, cls]);
  }
  const g = el('div', 'kv');
  for (const [label, s, cls] of rows) {
    const d = el('div');
    d.innerHTML = '<span>' + esc(label) + '</span> <span class="pill ' + cls + '">' + esc(s) + '</span>';
    g.appendChild(d);
  }
  if (typeof DeviceMotionEvent !== 'undefined') {
    const needs = typeof DeviceMotionEvent.requestPermission === 'function';
    const d = el('div');
    d.innerHTML = '<span>device motion</span> <span class="pill ' + (needs ? 'warn' : 'ok') + '">' +
      (needs ? 'must ask (iOS)' : 'no prompt needed') + '</span>';
    g.appendChild(d);
  }
  if (!navigator.permissions) {
    g.appendChild(el('div', null, 'no Permissions API here — state is inferred from what actually happens'));
  }
  fill(ui.grid, g);
}

/* ---------- the asks ---------- */
export async function askMic() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    log('microphone permission granted',
        'we opened the default input and closed it immediately. that single yes unlocks real device names for this origin, for every ' +
        'input, permanently — until you clear site data.');
  } catch (e) {
    log('microphone refused: ' + e.name,
      e.name === 'NotAllowedError'
        ? 'you said no, or the browser said no on your behalf. a page cannot re-ask its way past this — clear it in site settings.'
        : 'the device could not be opened. something else may own it exclusively.', 'err');
  }
  await read();
  await scan();
}

export async function askCam() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach(t => t.stop());
    log('camera permission granted', 'camera names are now readable too. audio and video permissions are separate gates.');
  } catch (e) { log('camera refused: ' + e.name, '', 'err'); }
  await read();
  await scan();
}

export async function askEverything() {
  log('asking for everything, one at a time',
      'browsers queue permission prompts, and asking all at once gets them collapsed or ignored. this walks through them in order.');
  await startEngine();
  await askMic();
  await askCam();
  await connectMidi();
  await askMotion();
  await scan();
  log('done asking. whatever is still not granted, you said no to, or this browser does not have.');
}

export default {
  id: 'permissions',
  title: 'permissions',
  mount(root) {
    const row = el('div', 'row');
    const mic = el('button', null, 'MICROPHONE');
    const cam = el('button', null, 'CAMERA');
    const mid = el('button', null, 'MIDI');
    const mot = el('button', null, 'MOTION');
    const re = el('button', 'tiny', 'RE-CHECK');
    const all = el('label', 'chk');
    const allb = document.createElement('input');
    allb.type = 'checkbox';
    all.append(allb, document.createTextNode('show unsupported'));
    row.append(mic, cam, mid, mot, re, all);

    const grid = el('div');
    const note = el('p', 'note');
    note.innerHTML =
      '<b>granted</b> the browser will hand it over without asking again. ' +
      '<b>prompt</b> it will ask the next time you reach for it. ' +
      '<b>denied</b> you said no, or a policy did. Clear it in the site settings for this origin — a page cannot undo a denial.';
    root.append(row, grid, note);
    ui = { grid, showAll: false };

    mic.onclick = askMic;
    cam.onclick = askCam;
    mid.onclick = connectMidi;
    mot.onclick = askMotion;
    re.onclick = read;
    allb.onchange = () => { ui.showAll = allb.checked; render(); };
    on('permissions', read);
    read();
  },
  snapshot() { return { ...state }; },
};
