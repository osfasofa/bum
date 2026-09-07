// audio-out.js — where the sound goes, and which physical socket it comes out of.
import { el, kv, fill, log, makeMeter, dropMeters, nice } from './core.js';
import { devices, scan, onDevices } from './devices.js';
import { getCtx, getMaster, onEngine, rebuildMaster, maxOutChannels, canPickOutput } from './engine.js';

let splitter = null, bars = [], ui = null;
let toneOsc = null, toneGain = null, toneMerger = null;
let toneFreq = 220, toneTarget = 'all';

/* ---------- metering the real output ---------- */
function buildMeters() {
  const ctx = getCtx();
  if (!ui) return;
  dropMeters(bars); bars = [];
  ui.meters.textContent = '';
  try { splitter && splitter.disconnect(); } catch (e) {}
  splitter = null;
  if (!ctx) return;
  const n = maxOutChannels();
  splitter = ctx.createChannelSplitter(n);
  getMaster().connect(splitter);
  for (let c = 0; c < n; c++) {
    const a = ctx.createAnalyser();
    a.fftSize = 1024; a.smoothingTimeConstant = 0;
    splitter.connect(a, c);
    bars.push(makeMeter(ui.meters, 'out ' + (c + 1), a));
  }
}

/* ---------- test tone ---------- */
function startTone() {
  const ctx = getCtx();
  if (!ctx) return;
  const n = maxOutChannels();
  toneOsc = ctx.createOscillator();
  toneOsc.type = 'sine';
  toneOsc.frequency.value = toneFreq;
  toneGain = ctx.createGain();
  toneGain.gain.value = 0;
  toneGain.gain.setTargetAtTime(0.15, ctx.currentTime, 0.02);
  toneMerger = ctx.createChannelMerger(n);
  toneOsc.connect(toneGain);
  if (toneTarget === 'all') for (let c = 0; c < n; c++) toneGain.connect(toneMerger, 0, c);
  else toneGain.connect(toneMerger, 0, Math.min(parseInt(toneTarget, 10), n - 1));
  toneMerger.connect(getMaster());
  toneOsc.start();
  ui.tone.classList.add('on');
  render();
}
function stopTone() {
  if (!toneOsc) return;
  try { toneOsc.stop(); toneOsc.disconnect(); toneGain.disconnect(); toneMerger.disconnect(); } catch (e) {}
  toneOsc = toneGain = toneMerger = null;
  if (ui) ui.tone.classList.remove('on');
  render();
}

async function pingEach() {
  const ctx = getCtx();
  if (!ctx) return;
  const n = maxOutChannels();
  log('pinging each of the ' + n + ' output channel(s) in turn',
      'one 400 ms burst per physical out, discrete, no up-mixing. this is how you find out which speaker is actually channel 5.');
  for (let c = 0; c < n; c++) {
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = 440 + c * 55;
    const g = ctx.createGain(); g.gain.value = 0;
    const mg = ctx.createChannelMerger(n);
    o.connect(g); g.connect(mg, 0, c); mg.connect(getMaster());
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.02);
    g.gain.setValueAtTime(0.2, t + 0.34);
    g.gain.linearRampToValueAtTime(0, t + 0.4);
    o.start(t); o.stop(t + 0.45);
    o.onended = () => { try { o.disconnect(); g.disconnect(); mg.disconnect(); } catch (e) {} };
    await new Promise(r => setTimeout(r, 500));
  }
}

/* ---------- device selection ---------- */
function currentLabel() {
  const ctx = getCtx();
  if (!ctx) return '—';
  const id = ('sinkId' in ctx) ? ctx.sinkId : '';
  if (!id) return 'system default';
  const d = devices.audiooutput.find(x => x.deviceId === id);
  return d ? (d.label || id.slice(0, 8)) : id.slice(0, 8);
}

async function pick(id) {
  const ctx = getCtx();
  if (!ctx || !('setSinkId' in ctx)) return;
  try {
    await ctx.setSinkId(id === 'default' ? '' : id);
    log('output switched to ' + currentLabel(),
        'same engine, same clock, new destination. the channel count may have just changed underneath every node you built — check the number below.');
    rebuildMaster();
    buildMeters();
    if (toneOsc) { stopTone(); startTone(); }
    render();
  } catch (err) { log('could not switch output: ' + err.name, '', 'err'); }
}

/* ---------- render ---------- */
function render() {
  if (!ui) return;
  const ctx = getCtx();
  const outs = devices.audiooutput;
  const n = maxOutChannels();

  ui.sel.textContent = '';
  if (!outs.length) {
    ui.sel.appendChild(new Option(ctx ? '(this browser exposes no output devices)' : '— start the engine —', ''));
    ui.sel.disabled = true;
  } else {
    outs.forEach((d, i) => ui.sel.appendChild(new Option(d.label || 'output ' + (i + 1) + ' (name withheld)', d.deviceId)));
    ui.sel.disabled = !canPickOutput();
    if (ctx && 'sinkId' in ctx && ctx.sinkId) ui.sel.value = ctx.sinkId;
  }
  ui.picker.hidden = !(navigator.mediaDevices && navigator.mediaDevices.selectAudioOutput);

  const prev = ui.toneCh.value;
  ui.toneCh.textContent = '';
  ui.toneCh.appendChild(new Option('all channels', 'all'));
  for (let c = 0; c < n; c++) ui.toneCh.appendChild(new Option('channel ' + (c + 1) + ' only', String(c)));
  ui.toneCh.value = [...ui.toneCh.options].some(o => o.value === prev) ? prev : 'all';
  toneTarget = ui.toneCh.value;

  ['tone', 'toneCh', 'freq', 'ping'].forEach(k => { ui[k].disabled = !ctx; });

  fill(ui.stats, kv([
    ['device', currentLabel()],
    ['channels', ctx ? n : '—'],
    ['can page choose output', ctx ? (canPickOutput() ? 'yes' : 'no — OS default only') : '—'],
    ['test tone', toneOsc ? Math.round(toneFreq) + ' Hz to ' + (toneTarget === 'all' ? 'every channel' : 'channel ' + (+toneTarget + 1)) : 'off', !!toneOsc],
  ]));
}

export default {
  id: 'audio-out',
  title: 'outs',
  mount(root) {
    const r1 = el('div', 'row');
    const sel = el('select', 'wide'); sel.disabled = true;
    const picker = el('button', 'tiny', 'SYSTEM PICKER'); picker.hidden = true;
    r1.append(sel, picker);

    const r2 = el('div', 'row');
    const tone = el('button', null, 'TEST TONE'); tone.disabled = true;
    const toneCh = el('select'); toneCh.disabled = true;
    const freq = document.createElement('input');
    freq.type = 'range'; freq.min = '40'; freq.max = '4000'; freq.step = '1'; freq.value = '220'; freq.disabled = true;
    const freqLab = el('b', null, '220 Hz');
    const fk = el('div', 'knob'); fk.append(freq, freqLab);
    const ping = el('button', 'tiny', 'PING EACH CHANNEL'); ping.disabled = true;
    r2.append(tone, toneCh, fk, ping);

    const stats = el('div');
    const meters = el('div', 'meters');
    root.append(r1, r2, stats, meters);
    ui = { sel, picker, tone, toneCh, freq, ping, stats, meters };

    sel.onchange = e => pick(e.target.value);
    picker.onclick = async () => {
      try {
        const d = await navigator.mediaDevices.selectAudioOutput();
        log('picked ' + (d.label || d.deviceId) + ' from the system dialog',
            'this dialog also grants permission to read output device names for this origin.');
        await scan();
        pick(d.deviceId);
      } catch (e) { log('output picker cancelled'); }
    };
    tone.onclick = () => {
      if (toneOsc) { stopTone(); log('tone stopped'); return; }
      startTone();
      log('sine at ' + toneFreq + ' Hz to ' + (toneTarget === 'all' ? 'every channel' : 'channel ' + (+toneTarget + 1)),
          'oscillator to gain to a ChannelMerger to destination is the entire graph. the merger is what lets you address one physical output ' +
          'on its own instead of letting the browser up-mix for you.');
    };
    toneCh.onchange = () => { toneTarget = toneCh.value; if (toneOsc) { stopTone(); startTone(); } render(); };
    freq.oninput = () => {
      toneFreq = parseFloat(freq.value);
      freqLab.textContent = toneFreq + ' Hz';
      const ctx = getCtx();
      if (toneOsc && ctx) toneOsc.frequency.setTargetAtTime(toneFreq, ctx.currentTime, 0.01);
    };
    ping.onclick = pingEach;

    onDevices(render);
    onEngine(d => {
      if (d.event === 'closing') { stopTone(); dropMeters(bars); bars = []; splitter = null; if (ui) ui.meters.textContent = ''; }
      else if (d.event === 'ready' || d.event === 'rebuilt') { buildMeters(); }
      render();
    });
    render();
  },
  snapshot() {
    const ctx = getCtx();
    return {
      device: currentLabel(),
      channels: ctx ? maxOutChannels() : null,
      canChooseOutput: ctx ? canPickOutput() : null,
      hasSystemPicker: !!(navigator.mediaDevices && navigator.mediaDevices.selectAudioOutput),
      devicesListed: devices.audiooutput.length,
      tone: toneOsc ? { freq: toneFreq, target: toneTarget } : null,
    };
  },
};
