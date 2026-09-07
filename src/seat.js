// seat.js — the machine itself, and how much of it this page is allowed to see.
import { el, kv, fill, log, nice, onTick, topline, count, mq, mqPick, UA } from './core.js';

let ui = null;
let battery = null;
let storage = null;

const bytes = n => {
  if (n == null) return 'not reported';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
};

async function readStorage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try { return await navigator.storage.estimate(); } catch (e) { return null; }
}

async function readBattery() {
  if (!navigator.getBattery) return null;
  try {
    const b = await navigator.getBattery();
    ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange']
      .forEach(ev => b.addEventListener(ev, render));
    return b;
  } catch (e) { return null; }
}

function net() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return null;
  return { effectiveType: c.effectiveType, downlink: c.downlink, rtt: c.rtt, saveData: c.saveData, type: c.type };
}

function render() {
  if (!ui) return;
  const n = net();
  const rows = [
    ['cores', navigator.hardwareConcurrency != null ? navigator.hardwareConcurrency : 'not reported'],
    ['memory', navigator.deviceMemory != null ? navigator.deviceMemory + ' GB (rounded)' : 'not reported'],
    ['platform', navigator.platform || 'not reported'],
    ['language', navigator.language || '—'],
    ['secure context', window.isSecureContext ? 'yes' : 'NO — most of this page is dead', window.isSecureContext],
    ['cross-origin isolated', window.crossOriginIsolated ? 'yes' : 'no', !!window.crossOriginIsolated],
    ['origin', location.origin],
    ['storage quota', storage ? bytes(storage.quota) : 'not reported'],
    ['storage used', storage ? bytes(storage.usage) : 'not reported'],
    ['online', navigator.onLine ? 'yes' : 'no'],
    ['connection', n ? (n.effectiveType || n.type || 'unknown') : 'not reported'],
    ['downlink', n && n.downlink != null ? n.downlink + ' Mbit/s (estimate)' : 'not reported'],
    ['round trip', n && n.rtt != null ? n.rtt + ' ms (estimate)' : 'not reported'],
    ['battery', battery ? Math.round(battery.level * 100) + '%' + (battery.charging ? ', charging' : '') : 'not reported'],
    ['colour scheme', mqPick([['(prefers-color-scheme: dark)', 'dark'], ['(prefers-color-scheme: light)', 'light']], 'no preference')],
    ['reduced motion', mq('(prefers-reduced-motion: reduce)') ? 'yes' : 'no'],
    ['contrast', mqPick([['(prefers-contrast: more)', 'more'], ['(prefers-contrast: less)', 'less']], 'no preference')],
    ['forced colours', mq('(forced-colors: active)') ? 'active' : 'none'],
  ];
  fill(ui.stats, kv(rows));
  topline('seat', navigator.hardwareConcurrency ? count(navigator.hardwareConcurrency, 'cores') : null);
}

export default {
  id: 'seat',
  title: 'the seat',
  mount(root) {
    const stats = el('div');
    const note = el('p', 'note');
    note.innerHTML = window.crossOriginIsolated
      ? '<b>This origin sets COOP and COEP</b>, so it is cross-origin isolated and <b>SharedArrayBuffer works here</b>. ' +
        'Most pages are not configured that way. If you are checking whether your own app can use a shared ring buffer between ' +
        'a worklet and the main thread, the answer here is about this site, not about yours — you have to send those two headers too.'
      : 'This origin is <b>not</b> cross-origin isolated, so SharedArrayBuffer is off. That is the ordinary state of the web. ' +
        'It takes two response headers, COOP and COEP, to change it, and they have to come from the server.';
    root.append(stats, note);
    ui = { stats };

    window.addEventListener('online', () => { log('back online'); render(); });
    window.addEventListener('offline', () => { log('went offline', 'nothing here needs the network, so nothing changes.'); render(); });
    const c = navigator.connection;
    if (c && c.addEventListener) c.addEventListener('change', render);

    readStorage().then(s => { storage = s; render(); });
    readBattery().then(b => { battery = b; render(); });
    onTick(() => { if (battery) render(); });
    render();
  },
  snapshot() {
    return {
      cores: navigator.hardwareConcurrency || null,
      deviceMemoryGB: navigator.deviceMemory || null,
      platform: navigator.platform || null,
      language: navigator.language || null,
      userAgent: UA,
      secureContext: window.isSecureContext,
      crossOriginIsolated: !!window.crossOriginIsolated,
      origin: location.origin,
      storage: storage ? { quota: storage.quota, usage: storage.usage } : null,
      network: net(),
      battery: battery ? { level: battery.level, charging: battery.charging } : null,
      preferences: {
        colorScheme: mqPick([['(prefers-color-scheme: dark)', 'dark'], ['(prefers-color-scheme: light)', 'light']], 'no-preference'),
        reducedMotion: mq('(prefers-reduced-motion: reduce)'),
        forcedColors: mq('(forced-colors: active)'),
      },
    };
  },
};
