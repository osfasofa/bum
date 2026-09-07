// outs.js — the outputs that are not audio. A voice, a buzz, a light kept on, a message.
import { el, kv, fill, log, emit, topline, count } from './core.js';

let ui = null;
let voices = [];
let wakeLock = null;
let fonts = null;
let xr = { vr: null, ar: null };

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices();
  if (!ui) return;
  ui.voice.textContent = '';
  if (!voices.length) { ui.voice.appendChild(new Option('— none loaded yet —', '')); return; }
  voices.forEach((v, i) => ui.voice.appendChild(new Option(v.name + '  ·  ' + v.lang + (v.localService ? '' : '  (network)'), String(i))));
  render();
}

async function toggleWakeLock(btn) {
  if (!('wakeLock' in navigator)) { log('no Wake Lock API here', '', 'err'); return; }
  if (wakeLock) {
    try { await wakeLock.release(); } catch (e) {}
    wakeLock = null;
    btn.classList.remove('on');
    log('wake lock released', 'the screen may sleep again.');
    render();
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; if (ui) ui.wake.classList.remove('on'); render(); });
    btn.classList.add('on');
    log('screen wake lock held', 'the display will not sleep while this is on. the browser drops it by itself if the tab goes to the background.');
  } catch (e) { log('wake lock refused: ' + e.name, '', 'err'); }
  render();
}

async function notify() {
  if (!('Notification' in window)) { log('no Notification API here', '', 'err'); return; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  emit('permissions');
  if (perm !== 'granted') { log('notifications refused', 'a page cannot undo a denial; clear it in site settings.', 'err'); render(); return; }
  try {
    new Notification('bum', { body: 'This is an output too.', tag: 'bum-test' });
    log('fired a notification', 'this leaves the tab entirely and is drawn by the operating system.');
  } catch (e) {
    log('notification refused: ' + e.name, 'some platforms only allow notifications from a service worker.', 'err');
  }
  render();
}

async function clipboard() {
  const text = 'bum — clipboard test at ' + new Date().toLocaleTimeString();
  try {
    await navigator.clipboard.writeText(text);
    log('wrote to the clipboard', 'writing is usually allowed straight after a click. reading is a stronger permission.');
  } catch (e) { log('clipboard write refused: ' + e.name, '', 'err'); return; }
  try {
    const back = await navigator.clipboard.readText();
    log('read it back: ' + (back === text ? 'identical' : 'different content — something else owns the clipboard'),
        'reading the clipboard is a separate permission and most browsers prompt for it.');
  } catch (e) { log('clipboard read refused: ' + e.name, 'expected — reading is gated harder than writing.'); }
  emit('permissions');
  render();
}

async function localFonts() {
  if (!('queryLocalFonts' in window)) { log('queryLocalFonts is not in this browser', 'Chrome and Edge only. elsewhere a page can only guess which fonts you have by measuring text.', 'err'); return; }
  try {
    const list = await window.queryLocalFonts();
    fonts = list;
    const fams = new Set(list.map(f => f.family));
    log('read ' + list.length + ' font faces across ' + fams.size + ' families',
        'an installed font list is a strong fingerprint, which is why this needs a permission prompt and why every other browser refuses outright.');
    emit('permissions');
    render();
  } catch (e) { log('local fonts refused: ' + e.name, '', 'err'); }
}

async function checkXR() {
  if (!navigator.xr) return;
  try { xr.vr = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { xr.vr = false; }
  try { xr.ar = await navigator.xr.isSessionSupported('immersive-ar'); } catch (e) { xr.ar = false; }
  render();
}

function render() {
  if (!ui) return;
  const fams = fonts ? new Set(fonts.map(f => f.family)).size : null;
  fill(ui.stats, kv([
    ['speech voices', voices.length || 'none'],
    ['languages', voices.length ? new Set(voices.map(v => v.lang)).size : '—'],
    ['on-device voices', voices.length ? voices.filter(v => v.localService).length : '—'],
    ['vibration', navigator.vibrate ? 'supported' : 'not supported'],
    ['wake lock', 'wakeLock' in navigator ? (wakeLock ? 'HELD' : 'available') : 'not supported', !!wakeLock],
    ['notifications', 'Notification' in window ? Notification.permission : 'not supported'],
    ['clipboard', navigator.clipboard ? 'available' : 'not supported'],
    ['local fonts', fonts ? fonts.length + ' faces, ' + fams + ' families' : ('queryLocalFonts' in window ? 'available' : 'not exposed')],
    ['immersive VR', navigator.xr ? (xr.vr == null ? 'checking…' : xr.vr ? 'supported' : 'no headset') : 'no WebXR'],
    ['immersive AR', navigator.xr ? (xr.ar == null ? 'checking…' : xr.ar ? 'supported' : 'no') : 'no WebXR'],
  ]));
  if (voices.length) topline('voices', count(voices.length, 'voices'));
}

export default {
  id: 'outs',
  title: 'other outs',
  mount(root) {
    const r1 = el('div', 'row');
    const voice = el('select', 'wide');
    const speak = el('button', 'tiny', 'SPEAK');
    r1.append(voice, speak);

    const r2 = el('div', 'row');
    const vibe = el('button', 'tiny', 'BUZZ');
    const wake = el('button', 'tiny', 'HOLD WAKE LOCK');
    const noti = el('button', 'tiny', 'NOTIFY ME');
    const clip = el('button', 'tiny', 'CLIPBOARD ROUND TRIP');
    const font = el('button', 'tiny', 'LIST LOCAL FONTS');
    r2.append(vibe, wake, noti, clip, font);

    const stats = el('div');
    const note = el('p', 'note',
      'Speech does not go through your AudioContext or your chosen output device. It is the operating system talking, past your graph entirely — ' +
      'which is why a synth app cannot record it.');
    root.append(r1, r2, stats, note);
    ui = { voice, stats, wake };

    speak.onclick = () => {
      if (!('speechSynthesis' in window)) return;
      const i = parseInt(voice.value, 10);
      const u = new SpeechSynthesisUtterance('This is a bum in a browser, checking the outs.');
      if (voices[i]) u.voice = voices[i];
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      log('spoke through ' + (voices[i] ? voices[i].name : 'the default voice'));
    };
    vibe.onclick = () => {
      if (!navigator.vibrate) { log('no vibration on this device', 'desktops report nothing here.', 'err'); return; }
      const ok = navigator.vibrate([120, 60, 120]);
      log(ok ? 'buzzed' : 'the browser refused to vibrate',
          'desktop machines often claim support and then do nothing, because there is no motor.');
    };
    wake.onclick = () => toggleWakeLock(wake);
    noti.onclick = notify;
    clip.onclick = clipboard;
    font.onclick = localFonts;

    if ('speechSynthesis' in window) { speechSynthesis.onvoiceschanged = loadVoices; loadVoices(); }
    checkXR();
    render();
  },
  snapshot() {
    return {
      speech: {
        count: voices.length,
        languages: [...new Set(voices.map(v => v.lang))],
        local: voices.filter(v => v.localService).length,
        names: voices.slice(0, 200).map(v => ({ name: v.name, lang: v.lang, local: v.localService })),
      },
      vibration: !!navigator.vibrate,
      wakeLock: { supported: 'wakeLock' in navigator, held: !!wakeLock },
      notifications: 'Notification' in window ? Notification.permission : null,
      clipboard: !!navigator.clipboard,
      localFonts: fonts ? { faces: fonts.length, families: new Set(fonts.map(f => f.family)).size } : null,
      xr: navigator.xr ? xr : null,
    };
  },
};
