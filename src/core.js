// core.js — the things every section needs. No imports; nothing imports back.

/* ---------- dom ---------- */
export const $ = id => document.getElementById(id);
export const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
export const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const short = s => (s && s.length > 8 ? s.slice(0, 8) : (s || '—'));
export const nice  = n => (n == null ? '—' : Number(n).toLocaleString());
export const fmtBool = v => (v === true ? 'ON' : v === false ? 'off' : 'not reported');
export const pill = (text, cls) => el('span', 'pill ' + (cls || ''), text);

/** A key/value grid. rows: [label, value, isLive?] */
export function kv(rows, cls) {
  const g = el('div', 'kv' + (cls ? ' ' + cls : ''));
  for (const [k, v, live] of rows) {
    const d = el('div', live ? 'live' : null);
    d.innerHTML = '<span>' + esc(k) + '</span> ' + esc(v);
    g.appendChild(d);
  }
  return g;
}

/** Replace a node's children with new content. */
export function fill(node, ...kids) {
  node.textContent = '';
  for (const k of kids) if (k) node.appendChild(k);
  return node;
}

/* ---------- who is asking ---------- */
export const UA = navigator.userAgent;
export const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const IS_FF = /Firefox\//.test(UA);
export const IS_SAFARI = /^((?!chrome|android|crios|fxios).)*safari/i.test(UA);

/* ---------- log ---------- */
let logEl = null;
export function initLog(node) { logEl = node; }
export function log(msg, why, kind) {
  if (!logEl) { console.log(msg, why || ''); return; }
  logEl.appendChild(el('div', kind || '', msg));
  if (why) logEl.appendChild(el('div', 'why', why));
  while (logEl.children.length > 400) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}
export function clearLog() { if (logEl) logEl.textContent = ''; }

/* ---------- a tiny bus, so sections never import each other ---------- */
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  const s = listeners.get(evt);
  if (!s) return;
  for (const fn of s) { try { fn(data); } catch (e) { console.error(e); } }
}

/* ---------- topline ---------- */
const topBits = new Map();
const TOP_ORDER = ['seat', 'audio', 'engine', 'midi', 'screens', 'human', 'wired', 'note'];
let topNode = null;
export function initTopline(node) { topNode = node; }
export function topline(key, html) {
  if (html == null) topBits.delete(key); else topBits.set(key, html);
  if (!topNode) return;
  const keys = [...topBits.keys()].sort((a, b) => {
    const ia = TOP_ORDER.indexOf(a), ib = TOP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  topNode.innerHTML = keys.map(k => topBits.get(k)).join('<span class="sep">·</span>');
}
/** `3 audio in` with the number emphasised. */
export const count = (n, label) => '<b>' + esc(n) + '</b> ' + esc(label);

/* ---------- meters: one rAF loop for the whole page ---------- */
const meterBank = new Set();
const tickers = new Set();
export const DB_FLOOR = -72;
export const dbPct = db => clamp((db - DB_FLOOR) / -DB_FLOOR * 100, 0, 100);

export function makeMeter(container, label, analyser) {
  const row = el('div', 'meter');
  row.appendChild(el('span', null, label));
  const bar = el('div', 'bar');
  const fill_ = el('i'), peak = el('u');
  bar.appendChild(fill_); bar.appendChild(peak);
  row.appendChild(bar);
  const db = el('span', 'db', '−inf');
  row.appendChild(db);
  container.appendChild(row);
  const m = { row, fill: fill_, peak, db, analyser, buf: new Float32Array(analyser.fftSize), hold: DB_FLOOR, holdAt: 0 };
  row.onclick = () => { row.classList.remove('clip'); m.hold = DB_FLOOR; };
  meterBank.add(m);
  return m;
}
export function dropMeters(list) { for (const m of (list || [])) meterBank.delete(m); }
export function dropAllMeters() { meterBank.clear(); }

/** Register a callback run about five times a second. Returns an unsubscribe. */
export function onTick(fn) { tickers.add(fn); return () => tickers.delete(fn); }

let lastSlow = 0;
function pump(now) {
  for (const m of meterBank) {
    m.analyser.getFloatTimeDomainData(m.buf);
    let sum = 0, pk = 0;
    for (let i = 0; i < m.buf.length; i++) {
      const v = m.buf[i], a = v < 0 ? -v : v;
      sum += v * v; if (a > pk) pk = a;
    }
    const rmsDb = 20 * Math.log10(Math.sqrt(sum / m.buf.length) || 1e-8);
    const peakDb = 20 * Math.log10(pk || 1e-8);
    m.fill.style.width = dbPct(rmsDb) + '%';
    if (peakDb >= m.hold || now - m.holdAt > 1400) { m.hold = peakDb; m.holdAt = now; }
    m.peak.style.left = 'calc(' + dbPct(m.hold) + '% - 1px)';
    m.db.textContent = m.hold <= DB_FLOOR + 0.5 ? '−inf' : m.hold.toFixed(1);
    if (peakDb > -0.05) m.row.classList.add('clip');
  }
  if (now - lastSlow > 200) {
    lastSlow = now;
    for (const fn of tickers) { try { fn(now); } catch (e) { console.error(e); } }
  }
  requestAnimationFrame(pump);
}
requestAnimationFrame(pump);

/* ---------- files ---------- */
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
export const safeName = s => (s || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

/* ---------- media queries as data ---------- */
export const mq = q => (window.matchMedia ? window.matchMedia(q).matches : null);
/** First matching value from [query, label] pairs, else fallback. */
export function mqPick(pairs, fallback) {
  for (const [q, label] of pairs) if (mq(q)) return label;
  return fallback;
}
