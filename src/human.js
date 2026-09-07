// human.js — you, as an input device. Pointer, stylus, keyboard, controller.
import { el, kv, pill, fill, log, clamp, onTick, mq, topline, count } from './core.js';

let ui = null;
let last = null;                 // last PointerEvent reading
let lastKey = null;
let layout = null;               // keyboard layout map
const padSeen = new Map();

/* ---------- the pointer pad ---------- */
function buildPad() {
  const pad = el('div', 'pad');
  const canvas = document.createElement('canvas');
  const hint = el('div', 'hint', 'press, drag, or draw here — a stylus will report far more than a mouse');
  pad.append(canvas, hint);

  const ctx = canvas.getContext('2d');
  let sized = false;
  // Setting canvas.width clears it, so only resize when the size genuinely changed.
  const size = () => {
    const r = pad.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * devicePixelRatio));
    const h = Math.max(1, Math.round(r.height * devicePixelRatio));
    if (canvas.width === w && canvas.height === h) { sized = true; return; }
    canvas.width = w; canvas.height = h;
    sized = true;
  };
  new ResizeObserver(size).observe(pad);

  const draw = e => {
    if (!sized) size();
    const r = pad.getBoundingClientRect();
    const x = (e.clientX - r.left) * devicePixelRatio;
    const y = (e.clientY - r.top) * devicePixelRatio;
    const p = e.pressure > 0 ? e.pressure : 0.5;
    ctx.fillStyle = 'rgba(185,103,255,' + (0.25 + p * 0.75) + ')';
    ctx.beginPath();
    ctx.arc(x, y, 1 + p * 14 * devicePixelRatio, 0, Math.PI * 2);
    ctx.fill();
  };

  const read = e => {
    last = {
      type: e.pointerType, id: e.pointerId, isPrimary: e.isPrimary,
      pressure: e.pressure, tangential: e.tangentialPressure,
      tiltX: e.tiltX, tiltY: e.tiltY, twist: e.twist,
      width: e.width, height: e.height, buttons: e.buttons,
      x: Math.round(e.clientX), y: Math.round(e.clientY),
    };
    hint.hidden = true;
    render();
  };

  pad.addEventListener('pointerdown', e => { pad.setPointerCapture(e.pointerId); read(e); draw(e); });
  pad.addEventListener('pointermove', e => {
    read(e);
    if (e.buttons) {
      // coalesced events are the ones a tablet actually sent, not the ones the frame rate kept
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ce of evs) draw(ce);
    }
  });
  pad.addEventListener('pointerup', read);
  pad.addEventListener('pointercancel', read);
  pad.addEventListener('contextmenu', e => e.preventDefault());

  const clear = el('button', 'tiny', 'CLEAR');
  clear.onclick = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); hint.hidden = false; };
  return { pad, clear };
}

/* ---------- gamepads ---------- */
function pollPads() {
  if (!navigator.getGamepads || !ui) return;
  let pads = [];
  try { pads = [...navigator.getGamepads()].filter(Boolean); } catch (e) { return; }
  if (pads.length !== padSeen.size) {
    padSeen.clear();
    ui.pads.textContent = '';
    if (!pads.length) {
      ui.pads.appendChild(el('p', 'empty', 'none seen. plug one in and press a button — the browser hides gamepads until you do.'));
    }
    pads.forEach(p => {
      const c = el('div', 'dev');
      const hd = el('div', 'hd');
      hd.appendChild(el('div', 'nm', p.id));
      const tags = el('div', 'tags');
      tags.appendChild(pill(p.axes.length + ' axes'));
      tags.appendChild(pill(p.buttons.length + ' buttons'));
      if (p.vibrationActuator) tags.appendChild(pill('haptics', 'ok'));
      hd.appendChild(tags);
      c.appendChild(hd);
      const readout = el('div', 'kv');
      c.appendChild(readout);
      if (p.vibrationActuator) {
        const row = el('div', 'row tight last');
        const b = el('button', 'tiny', 'RUMBLE');
        b.onclick = () => {
          const g = [...navigator.getGamepads()].filter(Boolean).find(x => x.index === p.index);
          if (!g || !g.vibrationActuator) return;
          g.vibrationActuator.playEffect('dual-rumble', { duration: 400, strongMagnitude: 1, weakMagnitude: 0.6 })
            .then(() => log('rumbled ' + p.id, 'a controller is an output as well as an input.'))
            .catch(e => log('rumble refused: ' + e.name, '', 'err'));
        };
        row.appendChild(b);
        c.appendChild(row);
      }
      ui.pads.appendChild(c);
      padSeen.set(p.index, readout);
    });
    topline('human', pads.length ? count(pads.length, 'gamepad' + (pads.length === 1 ? '' : 's')) : null);
  }
  pads.forEach(p => {
    const r = padSeen.get(p.index);
    if (!r) return;
    const pressed = p.buttons.map((b, i) => (b.pressed ? i : -1)).filter(i => i >= 0);
    r.innerHTML =
      '<div><span>axes</span> ' + p.axes.map(a => a.toFixed(2)).join('  ') + '</div>' +
      '<div><span>pressed</span> ' + (pressed.length ? pressed.join(', ') : 'none') + '</div>';
  });
}

/* ---------- render ---------- */
function render() {
  if (!ui) return;
  fill(ui.stats, kv([
    ['touch points', navigator.maxTouchPoints || 0],
    ['primary pointer', mq('(pointer: fine)') ? 'fine' : mq('(pointer: coarse)') ? 'coarse' : 'none'],
    ['any pointer', mq('(any-pointer: fine)') ? 'fine available' : mq('(any-pointer: coarse)') ? 'coarse only' : 'none'],
    ['hover', mq('(hover: hover)') ? 'yes' : 'no'],
    ['keyboard layout map', navigator.keyboard && navigator.keyboard.getLayoutMap ? (layout ? layout.size + ' keys read' : 'available') : 'not exposed'],
  ]));

  fill(ui.point, kv(last ? [
    ['pointer type', last.type],
    ['pressure', last.pressure != null ? last.pressure.toFixed(3) : '—'],
    ['tangential', last.tangential != null ? last.tangential.toFixed(3) : '—'],
    ['tilt x / y', last.tiltX + '° / ' + last.tiltY + '°'],
    ['twist', last.twist + '°'],
    ['contact size', last.width + ' × ' + last.height],
    ['buttons', last.buttons],
    ['primary', last.isPrimary ? 'yes' : 'no'],
  ] : [['pointer', 'nothing yet — touch the pad above']]));

  fill(ui.keys, kv(lastKey ? [
    ['code (physical)', lastKey.code],
    ['key (what it types)', JSON.stringify(lastKey.key)],
    ['layout says', layout && layout.get(lastKey.code) ? JSON.stringify(layout.get(lastKey.code)) : 'unknown'],
    ['modifiers', lastKey.mods || 'none'],
    ['repeat', lastKey.repeat ? 'yes' : 'no'],
  ] : [['keyboard', 'press any key while this page has focus']]));
}

export default {
  id: 'human',
  title: 'human input',
  mount(root) {
    const { pad, clear } = buildPad();
    const stats = el('div');
    const point = el('div');
    const keys = el('div');
    const pads = el('div');

    const hPad = el('h3', 'sub first', 'pointer & stylus');
    const rowPad = el('div', 'row'); rowPad.appendChild(clear);
    const hKeys = el('h3', 'sub', 'keyboard');
    const rowKeys = el('div', 'row');
    const readLayout = el('button', 'tiny', 'READ LAYOUT MAP');
    rowKeys.appendChild(readLayout);
    const hPads = el('h3', 'sub', 'gamepads & controllers');

    root.append(stats, hPad, pad, rowPad, point, hKeys, rowKeys, keys, hPads, pads);
    ui = { stats, point, keys, pads };

    readLayout.onclick = async () => {
      if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) {
        log('no keyboard layout map here', 'Chrome and Edge only. elsewhere a page can see which physical key you hit but not what is printed on it.', 'err');
        return;
      }
      try {
        layout = await navigator.keyboard.getLayoutMap();
        log('read the keyboard layout: ' + layout.size + ' keys',
            'this is the difference between the physical key (KeyZ) and the character printed on it, which on an AZERTY board is a W.');
        render();
      } catch (e) { log('layout map refused: ' + e.name, '', 'err'); }
    };

    window.addEventListener('keydown', e => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const mods = ['ctrl', 'alt', 'shift', 'meta'].filter(m => e[m + 'Key']).join(' + ');
      lastKey = { code: e.code, key: e.key, mods, repeat: e.repeat };
      render();
    });
    window.addEventListener('gamepadconnected', e => {
      padSeen.clear();
      log('gamepad connected: ' + e.gamepad.id,
          'the browser hides gamepads until one is used, so this only appears after you press something. every axis is a fader if you decide it is.');
    });
    window.addEventListener('gamepaddisconnected', () => padSeen.clear());
    onTick(pollPads);
    render();
  },
  snapshot() {
    let pads = [];
    try { pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean); } catch (e) {}
    return {
      maxTouchPoints: navigator.maxTouchPoints || 0,
      pointer: mq('(pointer: fine)') ? 'fine' : mq('(pointer: coarse)') ? 'coarse' : 'none',
      hover: mq('(hover: hover)'),
      lastPointer: last,
      keyboardLayoutAvailable: !!(navigator.keyboard && navigator.keyboard.getLayoutMap),
      keyboardLayoutKeys: layout ? layout.size : null,
      gamepads: pads.map(p => ({ id: p.id, axes: p.axes.length, buttons: p.buttons.length, haptics: !!p.vibrationActuator })),
    };
  },
};
