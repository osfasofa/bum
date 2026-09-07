// cameras.js — not the point of this page, but they are ins, and an honest inventory counts them.
import { el, kv, pill, log, short } from './core.js';
import { devices, onDevices } from './devices.js';

let ui = null, preview = null;

async function start(d) {
  stop();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: d.deviceId } } }); }
  catch (e) { log('camera would not open: ' + e.name, '', 'err'); return; }
  const v = document.createElement('video');
  v.autoplay = true; v.playsInline = true; v.muted = true; v.srcObject = stream;
  const s = stream.getVideoTracks()[0].getSettings();
  preview = { deviceId: d.deviceId, stream, video: v, settings: s };
  render();
  log('camera open: ' + (d.label || 'camera') + ' at ' + s.width + '×' + s.height,
      'video is an in too. it is here so the inventory is honest, not because this page is about it.');
}
function stop() {
  if (!preview) return;
  preview.stream.getTracks().forEach(t => t.stop());
  preview = null;
  render();
}

function render() {
  if (!ui) return;
  ui.list.textContent = '';
  if (!devices.videoinput.length) {
    ui.list.appendChild(el('p', 'empty', 'no cameras listed.'));
    return;
  }
  devices.videoinput.forEach((d, i) => {
    const c = el('div', 'dev');
    const hd = el('div', 'hd');
    hd.appendChild(el('div', 'nm', d.label || 'camera ' + (i + 1) + ' (name withheld)'));
    const tags = el('div', 'tags');
    tags.appendChild(pill('id ' + short(d.deviceId)));
    if (d.groupId) tags.appendChild(pill('grp ' + short(d.groupId)));
    hd.appendChild(tags);
    c.appendChild(hd);
    const on = preview && preview.deviceId === d.deviceId;
    const row = el('div', 'row tight last');
    const b = el('button', on ? 'on' : '', on ? 'STOP' : 'PREVIEW');
    b.onclick = () => (on ? stop() : start(d));
    row.appendChild(b);
    c.appendChild(row);
    if (on) {
      const s = preview.settings;
      c.appendChild(kv([
        ['resolution', (s.width || '?') + ' × ' + (s.height || '?')],
        ['frame rate', s.frameRate ? s.frameRate.toFixed(0) + ' fps' : 'not reported'],
        ['facing', s.facingMode || 'not reported'],
      ]));
      c.appendChild(preview.video);
    }
    ui.list.appendChild(c);
  });
}

export default {
  id: 'cameras',
  title: 'cameras',
  mount(root) {
    const list = el('div');
    root.append(list);
    ui = { list };
    onDevices(render);
    window.addEventListener('beforeunload', stop);
    render();
  },
  snapshot() {
    return {
      count: devices.videoinput.length,
      previewing: preview ? preview.settings : null,
    };
  },
};
