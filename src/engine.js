// engine.js — the AudioContext and the master chain everything else hangs off.
import { $, el, kv, fill, log, emit, on, topline, count, nice, onTick } from './core.js';
import { scan } from './devices.js';

const AC = window.AudioContext || window.webkitAudioContext;

let ctx = null;
let master = null;            // every sound source lands here
let forcedRate = null;
let workletFile = null;       // verified by loading a real module URL
let workletBlob = null;       // verified by loading a blob: URL
let ui = null;

export const hasAudio = !!AC;
export const getCtx = () => ctx;
export const getMaster = () => master;
export const maxOutChannels = () => (ctx ? ctx.destination.maxChannelCount || 2 : 0);
export const canPickOutput = () => !!(ctx && 'setSinkId' in ctx);
export function onEngine(fn) { return on('engine', fn); }

/* ---------- lifecycle ---------- */
export async function startEngine() {
  if (ctx) return ctx;
  if (!AC) { log('no AudioContext in this browser', '', 'err'); return null; }
  try {
    ctx = forcedRate ? new AC({ latencyHint: 'interactive', sampleRate: forcedRate })
                     : new AC({ latencyHint: 'interactive' });
  } catch (e) {
    log('could not build the engine at ' + forcedRate + ' Hz: ' + e.name,
        'the device refuses that rate and the browser will not resample the hardware for you. falling back to the default.', 'err');
    forcedRate = null;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  await ctx.resume().catch(() => {});
  buildMaster();
  ctx.onstatechange = () => { render(); log('engine state → ' + ctx.state); emit('engine', { ctx, event: 'state' }); };

  log('engine up: ' + ctx.sampleRate + ' Hz, ' + maxOutChannels() + ' output channel' + (maxOutChannels() > 1 ? 's' : '') + ', state ' + ctx.state,
      'the OS picked that sample rate from the current default output device unless you forced one. baseLatency is the fixed cost ' +
      'of the pipeline before your sound reaches hardware — that number is the operating system talking, not you.');
  if (!('setSinkId' in ctx)) {
    log('this browser cannot change output device from a page',
        'Chrome and Edge can. Safari and Firefox send audio wherever the OS default output points. Change it in system settings instead.');
  }
  emit('engine', { ctx, event: 'ready' });
  render();
  verifyWorklets();
  await scan();
  return ctx;
}

function buildMaster() {
  const n = ctx.destination.maxChannelCount || 2;
  try { ctx.destination.channelCount = n; } catch (e) {}
  ctx.destination.channelCountMode = 'explicit';
  ctx.destination.channelInterpretation = 'discrete';
  master = ctx.createGain();
  master.gain.value = 1;
  master.channelCount = n;
  master.channelCountMode = 'explicit';
  master.channelInterpretation = 'discrete';
  master.connect(ctx.destination);
}

/** Called after the output device changes: the channel count may be different now. */
export function rebuildMaster() {
  if (!ctx) return;
  const n = ctx.destination.maxChannelCount || 2;
  try { ctx.destination.channelCount = n; } catch (e) {}
  master.channelCount = n;
  emit('engine', { ctx, event: 'rebuilt' });
  render();
}

export async function setRate(rate) {
  const had = ctx;
  emit('engine', { ctx, event: 'closing' });     // sections tear their nodes down
  if (had) { try { await had.close(); } catch (e) {} }
  ctx = null; master = null;
  forcedRate = rate || null;
  log('rebuilding the engine' + (rate ? ' at ' + rate + ' Hz' : ' at the device default'),
      'a sample rate belongs to the context, not to a node. changing it means a new context, which means every node you had is garbage now.');
  await startEngine();
  if (ctx && rate && ctx.sampleRate !== rate) {
    log('asked for ' + rate + ' Hz, got ' + ctx.sampleRate + ' Hz',
        'the browser quietly gave you what the hardware would actually do.');
  }
}

export async function suspendResume() {
  if (!ctx) return;
  if (ctx.state === 'running') {
    await ctx.suspend();
    log('engine suspended', 'the clock stops and every node freezes. the cheapest way to pause a whole graph at once.');
  } else {
    await ctx.resume();
    log('engine resumed');
  }
  render();
}

/* ---------- worklets: two probes, because they can differ ---------- */
async function verifyWorklets() {
  if (!ctx || typeof AudioWorkletNode === 'undefined') { workletFile = workletBlob = false; render(); return; }
  try {
    await ctx.audioWorklet.addModule(new URL('./probe-worklet.js', import.meta.url));
    workletFile = true;
    log('AudioWorklet verified from a real module file',
        'a processor was compiled and registered on the audio thread. the render quantum is 128 frames, which at ' +
        ctx.sampleRate + ' Hz is ' + (128 / ctx.sampleRate * 1000).toFixed(2) + ' ms per block.');
  } catch (e) {
    workletFile = false;
    log('AudioWorklet would not load from a file: ' + e.name, 'usually a Content-Security-Policy blocking the script.', 'err');
  }
  try {
    const src = 'class T extends AudioWorkletProcessor{process(){return false}}registerProcessor("bum-probe-blob",T)';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    workletBlob = true;
  } catch (e) {
    workletBlob = false;
    log('AudioWorklet will not load DSP generated at runtime', 'this origin’s Content-Security-Policy refuses blob: scripts. ' +
        'a file-based worklet still works; anything that compiles DSP on the fly does not.');
  }
  render();
}

/* ---------- section ---------- */
function render() {
  if (!ui) return;
  const rows = ctx ? [
    ['state', ctx.state, ctx.state === 'running'],
    ['sample rate', nice(ctx.sampleRate) + ' Hz'],
    ['base latency', ctx.baseLatency != null ? (ctx.baseLatency * 1000).toFixed(2) + ' ms' : 'not reported'],
    ['output latency', ctx.outputLatency != null ? (ctx.outputLatency * 1000).toFixed(2) + ' ms' : 'not reported'],
    ['render quantum', '128 frames = ' + (128 / ctx.sampleRate * 1000).toFixed(2) + ' ms'],
    ['max output channels', ctx.destination.maxChannelCount],
    ['channels in use', ctx.destination.channelCount],
    ['worklet from a file', workletFile === null ? 'checking…' : workletFile ? 'loaded' : 'blocked'],
    ['worklet from a blob', workletBlob === null ? 'checking…' : workletBlob ? 'loaded' : 'blocked by CSP'],
    ['sink id', ('sinkId' in ctx) ? (ctx.sinkId === '' ? 'system default' : ctx.sinkId.slice(0, 8)) : 'not exposed'],
  ] : [['state', 'not started']];

  fill(ui.stats, kv(rows));
  if (ctx) {
    const c = el('div');
    c.innerHTML = '<span>clock</span> <span id="engClock">' + ctx.currentTime.toFixed(2) + ' s</span>';
    ui.stats.firstChild.appendChild(c);
  }
  ui.start.disabled = !!ctx;
  ui.suspend.disabled = !ctx;
  ui.rate.disabled = !ctx;
  ui.suspend.textContent = ctx && ctx.state === 'running' ? 'SUSPEND' : 'RESUME';

  topline('engine', ctx
    ? count(nice(ctx.sampleRate), 'Hz') + '<span class="sep">·</span>' +
      count(ctx.destination.maxChannelCount, 'out ch') + '<span class="sep">·</span>engine <b>' + ctx.state + '</b>'
    : 'engine <b>asleep</b>');
}

const RATES = [8000, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000];

export default {
  id: 'engine',
  title: 'engine',
  mount(root) {
    const row = el('div', 'row');
    const start = el('button', null, 'START ENGINE');
    const suspend = el('button', null, 'SUSPEND'); suspend.disabled = true;
    const rate = el('select', 'wide'); rate.disabled = true;
    rate.appendChild(new Option('sample rate — device default', ''));
    RATES.forEach(r => rate.appendChild(new Option(String(r), String(r))));
    row.append(start, suspend, rate);

    const stats = el('div');
    const note = el('p', 'note',
      'Changing the rate builds a brand-new engine and drops every armed input. If the device cannot do it, the browser says so and nothing changes.');

    root.append(row, stats, note);
    ui = { start, suspend, rate, stats };

    start.onclick = () => startEngine();
    suspend.onclick = () => suspendResume();
    rate.onchange = e => setRate(e.target.value ? parseInt(e.target.value, 10) : null);

    onTick(() => {
      const c = document.getElementById('engClock');
      if (c && ctx) c.textContent = ctx.currentTime.toFixed(2) + ' s';
    });
    render();
  },
  snapshot() {
    if (!ctx) return { started: false, available: hasAudio };
    return {
      started: true,
      state: ctx.state,
      sampleRate: ctx.sampleRate,
      forcedRate,
      baseLatencyMs: ctx.baseLatency != null ? +(ctx.baseLatency * 1000).toFixed(3) : null,
      outputLatencyMs: ctx.outputLatency != null ? +(ctx.outputLatency * 1000).toFixed(3) : null,
      renderQuantumMs: +(128 / ctx.sampleRate * 1000).toFixed(3),
      maxOutputChannels: ctx.destination.maxChannelCount,
      workletFromFile: workletFile,
      workletFromBlob: workletBlob,
      canPickOutput: canPickOutput(),
      sinkId: ('sinkId' in ctx) ? ctx.sinkId : null,
    };
  },
};
