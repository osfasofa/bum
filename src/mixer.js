// mixer.js — armed inputs, placed. Gain, pan, mute, solo, and which physical out they land on.
//
// Per strip:  source ─▶ gain ─┬─▶ panner ─▶ splitLR ─▶ merger[0], merger[1]   (stereo output)
//                            └─▶ mono   ─────────────▶ merger[c] for each c  (more than two outs)
// The merger is sized to destination.maxChannelCount and is discrete, so nothing is
// silently up-mixed on the way to the hardware.

import { el, kv, fill, log, clamp, makeMeter, dropMeters, topline } from './core.js';
import { armed, onArmed } from './audio-in.js';
import { getCtx, getMaster, onEngine, maxOutChannels } from './engine.js';

const dbToLin = db => (db <= -60 ? 0 : Math.pow(10, db / 20));

/** key -> { gainDb, pan, mute, solo, channels:Set<number> } — survives re-arming. */
const state = new Map();
/** key -> live nodes */
const nodes = new Map();

let merger = null, masterGain = null, ui = null;
let monitorOn = false, masterDb = -6;

function defaults() { return { gainDb: 0, pan: 0, mute: false, solo: false, channels: new Set([0, 1]) }; }
function stateFor(key) {
  if (!state.has(key)) state.set(key, defaults());
  return state.get(key);
}
const anySolo = () => [...armed.keys()].some(k => stateFor(k).solo);

/* ---------- graph ---------- */
function ensureBus() {
  const ctx = getCtx();
  if (!ctx) return false;
  const n = maxOutChannels();
  if (merger && merger.numberOfInputs === n) return true;
  teardown();
  merger = ctx.createChannelMerger(n);
  masterGain = ctx.createGain();
  masterGain.channelCount = n;
  masterGain.channelCountMode = 'explicit';
  masterGain.channelInterpretation = 'discrete';
  masterGain.gain.value = monitorOn ? dbToLin(masterDb) : 0;
  merger.connect(masterGain);
  masterGain.connect(getMaster());
  return true;
}

function teardown() {
  for (const key of [...nodes.keys()]) unwire(key);
  try { merger && merger.disconnect(); } catch (e) {}
  try { masterGain && masterGain.disconnect(); } catch (e) {}
  merger = null; masterGain = null;
}

function wire(key) {
  const e = armed.get(key);
  const ctx = getCtx();
  if (!e || !ctx || !ensureBus()) return;
  unwire(key);
  const n = maxOutChannels();
  const st = stateFor(key);

  const gain = ctx.createGain();
  gain.gain.value = effectiveGain(key);
  e.source.connect(gain);

  const meter = ctx.createAnalyser();
  meter.fftSize = 1024; meter.smoothingTimeConstant = 0;
  gain.connect(meter);

  const made = { gain, meter, panner: null, splitLR: null, mono: null, bars: [] };

  if (n <= 2) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = st.pan;
    const splitLR = ctx.createChannelSplitter(2);
    gain.connect(panner);
    panner.connect(splitLR);
    splitLR.connect(merger, 0, 0);
    if (n > 1) splitLR.connect(merger, 1, 1);
    made.panner = panner; made.splitLR = splitLR;
  } else {
    const mono = ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    mono.channelInterpretation = 'speakers';
    gain.connect(mono);
    for (const c of st.channels) if (c < n) mono.connect(merger, 0, c);
    made.mono = mono;
  }
  nodes.set(key, made);
}

function unwire(key) {
  const m = nodes.get(key);
  if (!m) return;
  dropMeters(m.bars);
  for (const k of ['gain', 'panner', 'splitLR', 'mono', 'meter']) {
    try { m[k] && m[k].disconnect(); } catch (e) {}
  }
  nodes.delete(key);
}

function effectiveGain(key) {
  const st = stateFor(key);
  if (st.mute) return 0;
  if (anySolo() && !st.solo) return 0;
  return dbToLin(st.gainDb);
}

function applyGains() {
  const ctx = getCtx();
  if (!ctx) return;
  for (const [key, m] of nodes) m.gain.gain.setTargetAtTime(effectiveGain(key), ctx.currentTime, 0.02);
}

/* ---------- controls ---------- */
function setMonitor(on) {
  monitorOn = on;
  const ctx = getCtx();
  if (masterGain && ctx) masterGain.gain.setTargetAtTime(on ? dbToLin(masterDb) : 0, ctx.currentTime, 0.03);
  if (ui) ui.monitor.classList.toggle('on', on);
  log(on ? 'monitoring on: ' + armed.size + ' armed input(s) into the output'
         : 'monitoring off',
    on ? 'every armed input now runs through its own strip into a discrete merger and out to the hardware. this is the moment the tab ' +
         'becomes an audio interface. if you are on speakers with an open microphone, that is a feedback loop and it will find itself.'
       : '');
  render();
}

/* ---------- render ---------- */
function strip(key) {
  const e = armed.get(key);
  const st = stateFor(key);
  const n = maxOutChannels();
  const box = el('div', 'strip' + (st.mute ? ' muted' : ''));

  const hd = el('div', 'hd');
  hd.appendChild(el('div', 'nm', e.label));
  const mute = el('button', 'tiny mute' + (st.mute ? ' on' : ''), 'MUTE');
  const solo = el('button', 'tiny solo' + (st.solo ? ' on' : ''), 'SOLO');
  mute.onclick = () => { st.mute = !st.mute; applyGains(); render(); };
  solo.onclick = () => { st.solo = !st.solo; applyGains(); render(); };
  const btns = el('div', 'tags'); btns.append(mute, solo);
  hd.appendChild(btns);
  box.appendChild(hd);

  const knobs = el('div', 'knobs');

  const gk = el('div', 'knob');
  gk.appendChild(el('span', null, 'gain'));
  const gr = document.createElement('input');
  gr.type = 'range'; gr.min = '-60'; gr.max = '12'; gr.step = '0.5'; gr.value = String(st.gainDb);
  const gv = el('b', null, fmtDb(st.gainDb));
  gr.oninput = () => {
    st.gainDb = parseFloat(gr.value);
    gv.textContent = fmtDb(st.gainDb);
    applyGains();
  };
  gk.append(gr, gv);
  knobs.appendChild(gk);

  if (n <= 2) {
    const pk = el('div', 'knob');
    pk.appendChild(el('span', null, 'pan'));
    const pr = document.createElement('input');
    pr.type = 'range'; pr.min = '-1'; pr.max = '1'; pr.step = '0.02'; pr.value = String(st.pan);
    pr.className = 'short';
    const pv = el('b', null, fmtPan(st.pan));
    pr.oninput = () => {
      st.pan = parseFloat(pr.value);
      pv.textContent = fmtPan(st.pan);
      const m = nodes.get(key);
      const ctx = getCtx();
      if (m && m.panner && ctx) m.panner.pan.setTargetAtTime(st.pan, ctx.currentTime, 0.02);
    };
    pk.append(pr, pv);
    knobs.appendChild(pk);
  }
  knobs.appendChild(el('span', null, e.analysers.length + ' ch in'));
  box.appendChild(knobs);

  if (n > 2) {
    const mx = el('div', 'matrix');
    mx.appendChild(el('span', 'lbl', 'send to'));
    for (let c = 0; c < n; c++) {
      const on = st.channels.has(c);
      const lab = el('label', on ? 'on' : null);
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = on;
      cb.onchange = () => {
        if (cb.checked) st.channels.add(c); else st.channels.delete(c);
        wire(key); render();
      };
      lab.append(cb, document.createTextNode('out ' + (c + 1)));
      mx.appendChild(lab);
    }
    box.appendChild(mx);
  }

  const m = nodes.get(key);
  if (m) {
    const mw = el('div', 'meters');
    dropMeters(m.bars);
    m.bars = [makeMeter(mw, 'post', m.meter)];
    box.appendChild(mw);
  }
  return box;
}

const fmtDb = d => (d <= -60 ? '−inf' : (d > 0 ? '+' : '') + d.toFixed(1) + ' dB');
const fmtPan = p => (Math.abs(p) < 0.005 ? 'centre' : (p < 0 ? 'L' : 'R') + Math.round(Math.abs(p) * 100));

function render() {
  if (!ui) return;
  const ctx = getCtx();
  ui.monitor.disabled = !ctx;
  ui.masterRange.disabled = !ctx;
  ui.list.textContent = '';
  if (!ctx) { ui.list.appendChild(el('p', 'empty', 'start the engine first.')); ui.stats.textContent = ''; return; }
  if (!armed.size) {
    ui.list.appendChild(el('p', 'empty', 'nothing armed. arm an input above and a strip appears here.'));
  } else {
    for (const key of armed.keys()) ui.list.appendChild(strip(key));
  }
  fill(ui.stats, kv([
    ['monitoring', monitorOn ? 'ON' : 'off', monitorOn],
    ['strips', armed.size],
    ['master', fmtDb(masterDb)],
    ['bus width', maxOutChannels() + ' channel' + (maxOutChannels() > 1 ? 's' : '')],
    ['solo active', anySolo() ? 'yes' : 'no'],
  ]));
  topline('mixer', monitorOn ? '<b>monitoring</b>' : null);
}

function resync() {
  const ctx = getCtx();
  if (!ctx) { render(); return; }
  ensureBus();
  for (const key of [...nodes.keys()]) if (!armed.has(key)) unwire(key);
  for (const key of armed.keys()) if (!nodes.has(key)) wire(key);
  applyGains();
  render();
}

export default {
  id: 'mixer',
  title: 'mixer',
  mount(root) {
    const row = el('div', 'row');
    const monitor = el('button', null, 'MONITOR: OFF');
    monitor.disabled = true;
    const masterRange = document.createElement('input');
    masterRange.type = 'range'; masterRange.min = '-60'; masterRange.max = '6'; masterRange.step = '0.5';
    masterRange.value = String(masterDb); masterRange.disabled = true;
    const masterVal = el('b', null, fmtDb(masterDb));
    const mk = el('div', 'knob');
    mk.append(el('span', null, 'master'), masterRange, masterVal);
    row.append(monitor, mk);

    const list = el('div');
    const stats = el('div');
    const note = el('p', 'note warn',
      'Monitoring puts every armed input into your output in real time. On speakers with an open microphone that is a ' +
      'feedback loop, and it will find itself within a second. Headphones, or start with the master low.');

    root.append(row, stats, list, note);
    ui = { monitor, masterRange, list, stats };

    monitor.onclick = () => { setMonitor(!monitorOn); monitor.textContent = 'MONITOR: ' + (monitorOn ? 'ON' : 'OFF'); };
    masterRange.oninput = () => {
      masterDb = parseFloat(masterRange.value);
      masterVal.textContent = fmtDb(masterDb);
      const ctx = getCtx();
      if (masterGain && monitorOn && ctx) masterGain.gain.setTargetAtTime(dbToLin(masterDb), ctx.currentTime, 0.02);
      render();
    };

    onArmed(resync);
    onEngine(d => {
      if (d.event === 'closing') { teardown(); render(); }
      else if (d.event === 'ready' || d.event === 'rebuilt') resync();
    });
    render();
  },
  snapshot() {
    return {
      monitoring: monitorOn,
      masterDb,
      busChannels: maxOutChannels(),
      strips: [...armed.keys()].map(k => {
        const st = stateFor(k);
        return {
          label: armed.get(k).label, gainDb: st.gainDb, pan: st.pan,
          mute: st.mute, solo: st.solo, channels: [...st.channels],
        };
      }),
    };
  },
};

/* ---------- profile hooks ---------- */
export function mixerState() {
  return {
    monitorOn, masterDb,
    strips: [...state.entries()].map(([key, st]) => ({
      key, label: armed.get(key) ? armed.get(key).label : null,
      gainDb: st.gainDb, pan: st.pan, mute: st.mute, solo: st.solo, channels: [...st.channels],
    })),
  };
}
export function restoreMixer(saved) {
  if (!saved) return;
  masterDb = typeof saved.masterDb === 'number' ? saved.masterDb : masterDb;
  for (const s of (saved.strips || [])) {
    state.set(s.key, {
      gainDb: typeof s.gainDb === 'number' ? s.gainDb : 0,
      pan: typeof s.pan === 'number' ? clamp(s.pan, -1, 1) : 0,
      mute: !!s.mute, solo: !!s.solo,
      channels: new Set(Array.isArray(s.channels) ? s.channels : [0, 1]),
    });
  }
  if (ui) { ui.masterRange.value = String(masterDb); }
  resync();
  if (saved.monitorOn) { setMonitor(true); if (ui) ui.monitor.textContent = 'MONITOR: ON'; }
}
