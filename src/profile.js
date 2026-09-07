// profile.js — what you had set up, kept in this browser; and the whole inventory, on your disk.
import { el, kv, fill, log, saveBlob, stamp, UA } from './core.js';
import { snapshotAll } from './registry.js';
import { devices, scan, snapshotDevices } from './devices.js';
import { armed, armInput } from './audio-in.js';
import { getCtx, startEngine, canPickOutput } from './engine.js';
import { mixerState, restoreMixer } from './mixer.js';

const KEY = 'bum.profile.v2';
let ui = null;
let lastReport = '';

function current() {
  const ctx = getCtx();
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    output: ctx && 'sinkId' in ctx ? ctx.sinkId : null,
    armed: [...armed.values()].filter(e => e.kind === 'device').map(e => ({ id: e.key, label: e.label })),
    mixer: mixerState(),
  };
}

function read() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; }
  catch (e) { return null; }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current()));
    log('profile saved to this browser',
        'localStorage on this origin only. it never leaves the machine, and clearing site data erases it along with the device id salt that makes it meaningful.');
  } catch (e) { log('could not save: ' + e.name, 'private browsing, or storage is blocked.', 'err'); }
  render();
}

async function restore() {
  const p = read();
  if (!p) return;
  if (!getCtx()) await startEngine();
  await scan(true);

  if (p.output && canPickOutput()) {
    try { await getCtx().setSinkId(p.output); }
    catch (e) { log('the saved output device is gone', 'device ids are salted per origin and change when site data is cleared.'); }
  }

  let hit = 0, miss = 0;
  for (const a of (p.armed || [])) {
    const d = devices.audioinput.find(x => x.deviceId === a.id)
           || devices.audioinput.find(x => x.label && x.label === a.label);
    if (d) { await armInput(d); hit++; } else miss++;
  }
  restoreMixer(p.mixer);
  log('profile restored: ' + hit + ' input(s) re-armed' + (miss ? ', ' + miss + ' no longer present' : ''),
      miss ? 'the missing ones were matched by id first and by name second. if the hardware is unplugged or the salt was reset, nothing can find them.' : '');
  render();
}

function forget() {
  try { localStorage.removeItem(KEY); } catch (e) {}
  log('profile forgotten');
  render();
}

export async function buildReport() {
  const sections = await snapshotAll();
  return {
    tool: 'bum',
    url: 'https://master.bate.lol',
    generatedAt: new Date().toISOString(),
    userAgent: UA,
    devices: snapshotDevices(),
    sections,
  };
}

async function makeReport() {
  lastReport = JSON.stringify(await buildReport(), null, 2);
  if (ui) ui.report.textContent = lastReport;
  log('report built: ' + (lastReport.length / 1024).toFixed(1) + ' KB of JSON, entirely in this tab');
  return lastReport;
}

export async function download() {
  if (!lastReport) await makeReport();
  saveBlob(new Blob([lastReport], { type: 'application/json' }), 'bum-' + stamp() + '.json');
  log('report downloaded to your disk');
}

function render() {
  if (!ui) return;
  const p = read();
  const rows = p ? [
    ['saved', new Date(p.savedAt).toLocaleString()],
    ['inputs', (p.armed || []).length],
    ['output', p.output ? p.output.slice(0, 8) : 'system default'],
    ['mixer strips', p.mixer && p.mixer.strips ? p.mixer.strips.length : 0],
    ['monitoring', p.mixer && p.mixer.monitorOn ? 'on' : 'off'],
  ] : [['saved', 'nothing yet']];
  fill(ui.state, kv(rows));
  for (const b of ui.restoreButtons) b.disabled = !p;
}

export function hasProfile() { return !!read(); }
export { save, restore };

export default {
  id: 'profile',
  title: 'profile',
  mount(root) {
    const row = el('div', 'row');
    const s = el('button', 'tiny', 'SAVE PROFILE');
    const r = el('button', 'tiny', 'RESTORE PROFILE');
    const f = el('button', 'tiny danger', 'FORGET');
    const b = el('button', 'tiny', 'BUILD REPORT');
    const c = el('button', 'tiny', 'COPY');
    const d = el('button', 'tiny', 'DOWNLOAD');
    row.append(s, r, f, b, c, d);

    const state = el('div');
    const report = el('pre', 'report', 'press BUILD REPORT.');
    const note = el('p', 'note',
      'Device ids are salted per origin and reset when you clear site data, so a saved profile can go stale. ' +
      'Labels are your real hardware names — treat an export like a photo of the back of your desk.');
    root.append(row, state, report, note);
    ui = { state, report, restoreButtons: [r] };

    s.onclick = save;
    r.onclick = restore;
    f.onclick = forget;
    b.onclick = makeReport;
    d.onclick = download;
    c.onclick = async () => {
      if (!lastReport) await makeReport();
      try { await navigator.clipboard.writeText(lastReport); log('report copied to the clipboard'); }
      catch (e) { log('clipboard refused: ' + e.name, 'select the text and copy it by hand.', 'err'); }
    };
    render();
  },
  snapshot() {
    const p = read();
    return { saved: !!p, savedAt: p ? p.savedAt : null };
  },
};

export function registerToolbar(saveBtn, restoreBtn, exportBtn) {
  saveBtn.onclick = save;
  restoreBtn.onclick = restore;
  exportBtn.onclick = download;
  if (ui) ui.restoreButtons.push(restoreBtn);
  restoreBtn.disabled = !read();
}
