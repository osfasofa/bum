// registry.js — every section is the same shape, so nothing can fall out of the report.
//
//   export default { id, title, mount(rootEl), snapshot() }
//
// main.js mounts them; profile.js snapshots them. Adding a module to the list in
// main.js is the only wiring required.

const mods = [];

export function register(...list) { mods.push(...list); }
export function all() { return mods.slice(); }

export function mountAll(doc = document) {
  for (const m of mods) {
    const node = doc.querySelector('[data-mod="' + m.id + '"]');
    if (!node) { console.warn('bum: no mount point for section "' + m.id + '"'); continue; }
    try { m.mount(node); }
    catch (e) {
      console.error('bum: section "' + m.id + '" failed to mount', e);
      node.textContent = 'this section failed to start: ' + e.message;
    }
  }
}

/** Collect every section's snapshot. Async-tolerant, failure-tolerant. */
export async function snapshotAll() {
  const out = {};
  for (const m of mods) {
    if (typeof m.snapshot !== 'function') continue;
    try { out[m.id] = await m.snapshot(); }
    catch (e) { out[m.id] = { error: String(e && e.message || e) }; }
  }
  return out;
}
