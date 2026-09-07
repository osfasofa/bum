// screens.js — the display is an output. Usually the only one anybody notices.
import { el, kv, pill, fill, log, nice, mq, mqPick, topline, count } from './core.js';

let ui = null, refresh = null, details = null;

/** Count animation frames for a second. Only meaningful while the tab is actually painting. */
function measureRefresh() {
  return new Promise(resolve => {
    let frames = 0;
    const t0 = performance.now();
    const step = () => {
      frames++;
      const dt = performance.now() - t0;
      if (dt < 1000) requestAnimationFrame(step);
      else resolve({ hz: Math.round(frames / (dt / 1000)), frames, ms: Math.round(dt) });
    };
    requestAnimationFrame(step);
  });
}

/** A backgrounded tab is throttled to a crawl, so a reading taken there is about the
    throttling, not the panel. Measure only while visible, and say so when we cannot. */
async function runMeasure(manual) {
  if (document.visibilityState !== 'visible') {
    refresh = 'hidden';
    render();
    return;
  }
  refresh = null;
  render();
  const r = await measureRefresh();
  if (r.ms > 1600 || r.hz < 5) {
    refresh = 'throttled';
    log('could not measure a refresh rate: ' + r.frames + ' frames in ' + r.ms + ' ms',
        'the browser was not painting this tab. Chrome throttles background tabs to about one frame a second, and stops ' +
        'altogether when the window is occluded. bring the window to the front and measure again.');
  } else {
    refresh = r.hz;
    if (manual || true) {
      log('measured ' + r.hz + ' Hz of animation frames',
          'no API reports the refresh rate, so this counts requestAnimationFrame callbacks for a second. it is the rate the ' +
          'browser is willing to give you, which on a 120 Hz panel is often still 60.');
    }
  }
  render();
}

async function askScreens() {
  if (!window.getScreenDetails) {
    log('this browser has no Window Management API', 'only Chrome and Edge enumerate physical displays. everywhere else a page sees one screen: the one it is on.', 'err');
    return;
  }
  try {
    details = await window.getScreenDetails();
    details.addEventListener('screenschange', render);
    log('window management granted: ' + details.screens.length + ' display(s)',
        'without this permission a page only ever sees the screen it happens to be on, and its coordinates are relative to that one.');
  } catch (e) {
    log('window management refused: ' + e.name, 'the page can still describe the display it is on, just not the others.', 'err');
  }
  render();
}

function screenCard(s, i, isCurrent) {
  const c = el('div', 'dev');
  const hd = el('div', 'hd');
  hd.appendChild(el('div', 'nm', s.label || 'display ' + (i + 1)));
  const tags = el('div', 'tags');
  if (s.isPrimary) tags.appendChild(pill('primary', 'hot'));
  if (s.isInternal) tags.appendChild(pill('internal'));
  if (isCurrent) tags.appendChild(pill('this window', 'ok'));
  hd.appendChild(tags);
  c.appendChild(hd);
  c.appendChild(kv([
    ['size', s.width + ' × ' + s.height],
    ['available', s.availWidth + ' × ' + s.availHeight],
    ['position', s.left + ', ' + s.top],
    ['scale', s.devicePixelRatio ? s.devicePixelRatio + '×' : '—'],
    ['colour depth', s.colorDepth ? s.colorDepth + ' bit' : '—'],
    ['orientation', s.orientation ? s.orientation.type : '—'],
  ]));
  return c;
}

function render() {
  if (!ui) return;
  const s = window.screen;
  const rows = [
    ['window', window.innerWidth + ' × ' + window.innerHeight + ' css px'],
    ['screen', s.width + ' × ' + s.height + ' css px'],
    ['available', s.availWidth + ' × ' + s.availHeight],
    ['device pixels', Math.round(s.width * devicePixelRatio) + ' × ' + Math.round(s.height * devicePixelRatio)],
    ['pixel ratio', devicePixelRatio + '×'],
    ['colour depth', s.colorDepth + ' bit'],
    ['colour gamut', mqPick([['(color-gamut: rec2020)', 'rec2020'], ['(color-gamut: p3)', 'display-p3'], ['(color-gamut: srgb)', 'sRGB']], 'below sRGB')],
    ['dynamic range', mq('(dynamic-range: high)') ? 'high (HDR)' : 'standard'],
    ['video dynamic range', mq('(video-dynamic-range: high)') ? 'high' : 'standard'],
    ['refresh rate', refresh === null ? 'measuring…' : refresh === 'hidden' ? 'tab not visible — bring it to the front'
      : refresh === 'throttled' ? 'the browser was not painting this tab' : refresh + ' Hz (measured)'],
    ['orientation', s.orientation ? s.orientation.type + ' at ' + s.orientation.angle + '°' : 'not reported'],
    ['fullscreen', document.fullscreenEnabled ? 'allowed' : 'not allowed'],
    ['displays visible to this page', details ? details.screens.length : '1 (no window-management permission)'],
  ];
  fill(ui.stats, kv(rows));

  ui.list.textContent = '';
  if (details) {
    details.screens.forEach((sc, i) => ui.list.appendChild(screenCard(sc, i, sc === details.currentScreen)));
  }
  ui.ask.hidden = !window.getScreenDetails || !!details;
  topline('screens', count(details ? details.screens.length : 1, details && details.screens.length !== 1 ? 'displays' : 'display'));
}

export default {
  id: 'screens',
  title: 'screens',
  mount(root) {
    const row = el('div', 'row');
    const ask = el('button', 'tiny', 'ENUMERATE ALL DISPLAYS');
    const fs = el('button', 'tiny', 'FULLSCREEN');
    const again = el('button', 'tiny', 'MEASURE REFRESH');
    again.onclick = () => runMeasure(true);
    row.append(ask, fs, again);
    const stats = el('div');
    const list = el('div');
    const note = el('p', 'note',
      'Colour gamut, dynamic range and refresh rate come from the browser describing the panel it is drawing on. ' +
      'Refresh is measured here rather than reported, because no API tells you.');
    root.append(row, stats, list, note);
    ui = { stats, list, ask };

    ask.onclick = askScreens;
    fs.onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(e => log('fullscreen refused: ' + e.name, '', 'err'));
    };
    if (window.screen.orientation) window.screen.orientation.addEventListener('change', render);
    window.addEventListener('resize', render);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && typeof refresh !== 'number') runMeasure();
      else render();
    });
    runMeasure();
    render();
  },
  snapshot() {
    const s = window.screen;
    return {
      window: { w: window.innerWidth, h: window.innerHeight },
      screen: { w: s.width, h: s.height, availW: s.availWidth, availH: s.availHeight, colorDepth: s.colorDepth },
      devicePixelRatio,
      colorGamut: mqPick([['(color-gamut: rec2020)', 'rec2020'], ['(color-gamut: p3)', 'p3'], ['(color-gamut: srgb)', 'srgb']], 'below-srgb'),
      hdr: mq('(dynamic-range: high)'),
      refreshHz: typeof refresh === 'number' ? refresh : null,
      refreshNote: typeof refresh === 'number' ? null : (refresh || 'not measured'),
      orientation: s.orientation ? { type: s.orientation.type, angle: s.orientation.angle } : null,
      fullscreenEnabled: document.fullscreenEnabled,
      displays: details ? details.screens.map(x => ({
        label: x.label || null, w: x.width, h: x.height, left: x.left, top: x.top,
        scale: x.devicePixelRatio, colorDepth: x.colorDepth, primary: x.isPrimary, internal: x.isInternal,
      })) : null,
    };
  },
};
