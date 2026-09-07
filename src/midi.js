// midi.js — controllers and synths. Its own permission, its own list, no audio engine needed.
import { el, kv, pill, fill, log, esc, topline, count, IS_IOS } from './core.js';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => NOTES[n % 12] + (Math.floor(n / 12) - 1);

export function describe(data) {
  const st = data[0], type = st & 0xf0, chn = (st & 0x0f) + 1;
  const d1 = data[1], d2 = data[2];
  switch (type) {
    case 0x80: return 'ch' + chn + ' note off   ' + noteName(d1) + ' vel ' + d2;
    case 0x90: return 'ch' + chn + (d2 === 0 ? ' note off   ' : ' note on    ') + noteName(d1) + ' vel ' + d2;
    case 0xA0: return 'ch' + chn + ' aftertouch ' + noteName(d1) + ' ' + d2;
    case 0xB0: return 'ch' + chn + ' cc ' + d1 + ' = ' + d2;
    case 0xC0: return 'ch' + chn + ' program ' + d1;
    case 0xD0: return 'ch' + chn + ' pressure ' + d1;
    case 0xE0: return 'ch' + chn + ' pitch bend ' + (((d2 << 7) | d1) - 8192);
  }
  if (st === 0xF0) return 'sysex, ' + data.length + ' bytes';
  if (st === 0xF8) return 'clock';
  if (st === 0xFA) return 'start';
  if (st === 0xFB) return 'continue';
  if (st === 0xFC) return 'stop';
  if (st === 0xFE) return 'active sensing';
  return 'status 0x' + st.toString(16);
}

let midi = null, ui = null;
let sysex = false, showClock = false;
let feedFirst = true;
const counts = { in: 0, out: 0 };

export async function connect() {
  if (!navigator.requestMIDIAccess) {
    log('no Web MIDI in this browser',
        IS_IOS ? 'iOS has none, in any browser — they are all WebKit and WebKit does not ship it.'
               : 'Safari does not ship it. Chrome, Edge and recent Firefox do.', 'err');
    return null;
  }
  try { midi = await navigator.requestMIDIAccess({ sysex }); }
  catch (e) {
    log('MIDI refused: ' + e.name,
        sysex ? 'sysex is a stronger permission and is refused more often. try again without it.'
              : 'permission denied for this origin.', 'err');
    return null;
  }
  midi.onstatechange = ev => {
    log('MIDI port ' + ev.port.state + ': ' + (ev.port.name || 'unnamed') + ' (' + ev.port.type + ')',
        'MIDI hot-plugs and tells you about it without a rescan.');
    render();
  };
  render();
  log('MIDI connected' + (sysex ? ' with sysex' : ''),
      'MIDI has its own permission, its own device list and its own hot-plug event. it needs no AudioContext at all — it is just bytes.');
  return midi;
}

function feed(text) {
  if (!ui) return;
  if (feedFirst) { ui.feed.textContent = ''; feedFirst = false; }
  const d = el('div', 'new');
  d.innerHTML = '<b>' + new Date().toLocaleTimeString() + '</b> ' + esc(text);
  ui.feed.appendChild(d);
  setTimeout(() => d.classList.remove('new'), 300);
  while (ui.feed.children.length > 200) ui.feed.removeChild(ui.feed.firstChild);
  ui.feed.scrollTop = ui.feed.scrollHeight;
}

function inCard(p) {
  const c = el('div', 'dev');
  const hd = el('div', 'hd');
  hd.appendChild(el('div', 'nm', p.name || 'unnamed input'));
  const tags = el('div', 'tags');
  tags.appendChild(pill(p.manufacturer || 'unknown maker'));
  tags.appendChild(pill(p.state, p.state === 'connected' ? 'ok' : 'warn'));
  const act = pill('idle');
  tags.appendChild(act);
  hd.appendChild(tags);
  c.appendChild(hd);
  const last = el('div', 'kv');
  last.innerHTML = '<div><span>last</span> —</div>';
  c.appendChild(last);
  p.onmidimessage = m => {
    const st = m.data[0];
    if (!showClock && (st === 0xF8 || st === 0xFE)) return;
    const txt = describe(m.data);
    last.firstChild.innerHTML = '<span>last</span> ' + esc(txt) +
      ' <span class="bytes">[' + [...m.data].map(b => b.toString(16).padStart(2, '0')).join(' ') + ']</span>';
    act.textContent = 'live'; act.className = 'pill hot';
    clearTimeout(p.__t);
    p.__t = setTimeout(() => { act.textContent = 'idle'; act.className = 'pill'; }, 400);
    feed((p.name || 'in') + ' — ' + txt);
  };
  return c;
}

function outCard(p) {
  const c = el('div', 'dev');
  const hd = el('div', 'hd');
  hd.appendChild(el('div', 'nm', p.name || 'unnamed output'));
  const tags = el('div', 'tags');
  tags.appendChild(pill(p.manufacturer || 'unknown maker'));
  tags.appendChild(pill(p.state, p.state === 'connected' ? 'ok' : 'warn'));
  hd.appendChild(tags);
  c.appendChild(hd);
  const row = el('div', 'row tight last');
  const note = el('button', 'tiny', 'SEND C3');
  note.onclick = () => {
    try {
      p.send([0x90, 48, 100]);
      p.send([0x80, 48, 0], performance.now() + 400);
      log('sent note on C3 to ' + (p.name || 'output') + ', note off scheduled 400 ms later',
          'MIDI out is timestamped against performance.now(), so the browser schedules it rather than firing whenever the JavaScript happens to run.');
    } catch (e) { log('send failed: ' + e.name, '', 'err'); }
  };
  const cc = el('button', 'tiny', 'CC 1 SWEEP');
  cc.onclick = () => {
    const t0 = performance.now();
    for (let v = 0; v <= 127; v += 2) p.send([0xB0, 1, v], t0 + v * 8);
    log('swept CC 1 from 0 to 127 over about a second on ' + (p.name || 'output'));
  };
  row.append(note, cc);
  c.appendChild(row);
  return c;
}

function render() {
  if (!ui) return;
  ui.in.textContent = ''; ui.out.textContent = '';
  if (!midi) {
    ui.in.appendChild(el('p', 'empty', 'not connected.'));
    ui.out.appendChild(el('p', 'empty', 'not connected.'));
    ui.panic.disabled = true;
    topline('midi', '<b>midi</b> not connected');
    return;
  }
  const ins = [...midi.inputs.values()], outs = [...midi.outputs.values()];
  counts.in = ins.length; counts.out = outs.length;
  if (!ins.length) ui.in.appendChild(el('p', 'empty', 'no MIDI inputs. plug something in — this redraws itself.'));
  ins.forEach(p => ui.in.appendChild(inCard(p)));
  if (!outs.length) ui.out.appendChild(el('p', 'empty', 'no MIDI outputs.'));
  outs.forEach(p => ui.out.appendChild(outCard(p)));
  ui.panic.disabled = !outs.length;
  topline('midi', count(ins.length, 'midi in') + '<span class="sep">·</span>' + count(outs.length, 'midi out'));
}

export default {
  id: 'midi',
  title: 'midi',
  mount(root) {
    const row = el('div', 'row');
    const btn = el('button', null, 'CONNECT MIDI');
    const sx = el('label', 'chk');
    const sxb = document.createElement('input'); sxb.type = 'checkbox';
    sx.append(sxb, document.createTextNode('request sysex'));
    const ck = el('label', 'chk');
    const ckb = document.createElement('input'); ckb.type = 'checkbox';
    ck.append(ckb, document.createTextNode('show clock & sensing'));
    const panic = el('button', 'tiny danger', 'ALL NOTES OFF'); panic.disabled = true;
    row.append(btn, sx, ck, panic);

    const hIn = el('h3', 'sub', 'in');
    const inW = el('div');
    const hOut = el('h3', 'sub', 'out');
    const outW = el('div');
    const hFeed = el('h3', 'sub', 'stream');
    const feedW = el('div', 'feed');
    feedW.appendChild(el('div', null, 'nothing yet.'));

    root.append(row, hIn, inW, hOut, outW, hFeed, feedW);
    ui = { in: inW, out: outW, feed: feedW, panic };

    btn.onclick = connect;
    sxb.onchange = () => { sysex = sxb.checked; if (midi) connect(); };
    ckb.onchange = () => { showClock = ckb.checked; };
    panic.onclick = () => {
      if (!midi) return;
      let n = 0;
      for (const p of midi.outputs.values()) {
        for (let ch = 0; ch < 16; ch++) { p.send([0xB0 | ch, 123, 0]); p.send([0xB0 | ch, 120, 0]); n++; }
      }
      log('all notes off and all sound off on every channel of every output (' + n + ' channels)',
          'CC 123 then CC 120. the standard panic.');
    };
    render();
  },
  snapshot() {
    if (!midi) return { connected: false, available: !!navigator.requestMIDIAccess };
    const p = x => ({ name: x.name, manufacturer: x.manufacturer, state: x.state, version: x.version });
    return {
      connected: true, sysex,
      inputs: [...midi.inputs.values()].map(p),
      outputs: [...midi.outputs.values()].map(p),
    };
  },
};
