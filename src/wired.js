// wired.js — everything that plugs in and refuses to be MIDI.
// HID, serial, USB and Bluetooth all work the same way: nothing is visible until you
// pick a device from a browser chooser, and the chooser needs a click.
import { el, kv, pill, fill, log, esc, topline, count, IS_IOS } from './core.js';

let ui = null;
const hid = [], serial = [], usb = [], bt = [];

const hex = a => [...a].map(b => b.toString(16).padStart(2, '0')).join(' ');
const id4 = n => (n == null ? '—' : '0x' + n.toString(16).padStart(4, '0'));

function missing(what, why) {
  const p = el('p', 'empty');
  p.textContent = what + ' is not in this browser. ' + why;
  return p;
}

/* ---------- HID ---------- */
async function hidRequest() {
  try {
    const got = await navigator.hid.requestDevice({ filters: [] });
    if (!got.length) { log('HID chooser cancelled'); return; }
    for (const d of got) await hidOpen(d);
  } catch (e) { log('HID request failed: ' + e.name, '', 'err'); }
  renderHid();
}
async function hidOpen(d) {
  if (hid.includes(d)) return;
  hid.push(d);
  try {
    if (!d.opened) await d.open();
    d.addEventListener('inputreport', ev => {
      const bytes = new Uint8Array(ev.data.buffer);
      d.__last = 'report ' + ev.reportId + ': ' + hex(bytes.slice(0, 16)) + (bytes.length > 16 ? ' …' : '');
      renderHid();
    });
    log('opened HID device: ' + d.productName,
        'raw input reports now stream in. this is how a control surface that never speaks MIDI still talks to a web page.');
  } catch (e) { log('could not open ' + d.productName + ': ' + e.name, 'another process may hold it, or the OS reserves it.', 'err'); }
}
function renderHid() {
  const w = ui.hid;
  w.textContent = '';
  if (!('hid' in navigator)) { w.appendChild(missing('WebHID', IS_IOS ? 'iOS has no WebHID at all.' : 'Chrome and Edge only.')); return; }
  if (!hid.length) { w.appendChild(el('p', 'empty', 'nothing granted. press the button and pick something.')); return; }
  hid.forEach(d => {
    const c = el('div', 'dev');
    const hd = el('div', 'hd');
    hd.appendChild(el('div', 'nm', d.productName || 'unnamed HID device'));
    const tags = el('div', 'tags');
    tags.appendChild(pill('vid ' + id4(d.vendorId)));
    tags.appendChild(pill('pid ' + id4(d.productId)));
    tags.appendChild(pill(d.opened ? 'open' : 'closed', d.opened ? 'ok' : 'warn'));
    hd.appendChild(tags);
    c.appendChild(hd);
    c.appendChild(kv([
      ['collections', d.collections ? d.collections.length : 0],
      ['usage page', d.collections && d.collections[0] ? id4(d.collections[0].usagePage) : '—'],
      ['last report', d.__last || 'nothing yet — touch the device'],
    ]));
    w.appendChild(c);
  });
}

/* ---------- Serial ---------- */
async function serialRequest() {
  try {
    const port = await navigator.serial.requestPort();
    serial.push(port);
    log('serial port granted', 'a port is not open yet. pick a baud rate and open it — get that wrong and you get bytes that look like noise.');
    renderSerial();
  } catch (e) { log('serial chooser cancelled or refused: ' + e.name); }
}
async function serialOpen(port, baud, card) {
  try {
    await port.open({ baudRate: baud });
    log('serial port open at ' + baud + ' baud', 'reading bytes as they arrive. nothing is interpreted — this shows you what is actually on the wire.');
    port.__open = true;
    renderSerial();
    const reader = port.readable.getReader();
    port.__reader = reader;
    let buf = '';
    while (port.__open) {
      const { value, done } = await reader.read();
      if (done) break;
      buf = (hex(value.slice(0, 16)) + '  ' + buf).slice(0, 240);
      port.__last = buf;
      const n = card.querySelector('.last');
      if (n) n.textContent = buf;
    }
  } catch (e) { log('serial read stopped: ' + e.name, '', 'err'); port.__open = false; renderSerial(); }
}
async function serialClose(port) {
  port.__open = false;
  try { port.__reader && await port.__reader.cancel(); } catch (e) {}
  try { port.__reader && port.__reader.releaseLock(); } catch (e) {}
  try { await port.close(); } catch (e) {}
  log('serial port closed');
  renderSerial();
}
function renderSerial() {
  const w = ui.serial;
  w.textContent = '';
  if (!('serial' in navigator)) { w.appendChild(missing('WebSerial', IS_IOS ? 'iOS has none.' : 'Chrome and Edge only.')); return; }
  if (!serial.length) { w.appendChild(el('p', 'empty', 'no ports granted.')); return; }
  serial.forEach((port, i) => {
    const info = port.getInfo ? port.getInfo() : {};
    const c = el('div', 'dev');
    const hd = el('div', 'hd');
    hd.appendChild(el('div', 'nm', 'serial port ' + (i + 1)));
    const tags = el('div', 'tags');
    if (info.usbVendorId != null) tags.appendChild(pill('vid ' + id4(info.usbVendorId)));
    if (info.usbProductId != null) tags.appendChild(pill('pid ' + id4(info.usbProductId)));
    tags.appendChild(pill(port.__open ? 'open' : 'closed', port.__open ? 'ok' : 'warn'));
    hd.appendChild(tags);
    c.appendChild(hd);
    const row = el('div', 'row tight');
    const baud = el('select');
    [9600, 19200, 31250, 38400, 57600, 115200, 230400, 921600].forEach(b => baud.appendChild(new Option(b + ' baud', String(b))));
    baud.value = '115200';
    const b = el('button', 'tiny' + (port.__open ? ' on' : ''), port.__open ? 'CLOSE' : 'OPEN');
    b.onclick = () => (port.__open ? serialClose(port) : serialOpen(port, parseInt(baud.value, 10), c));
    row.append(baud, b);
    c.appendChild(row);
    const g = kv([['bytes in', port.__last || 'nothing yet']]);
    g.firstChild.lastChild.className = 'last';
    c.appendChild(g);
    w.appendChild(c);
  });
}

/* ---------- USB ---------- */
async function usbRequest() {
  try {
    const d = await navigator.usb.requestDevice({ filters: [] });
    usb.push(d);
    log('USB device granted: ' + (d.productName || id4(d.productId)),
        'this is the raw device, below any driver. the browser will not let you touch a class the OS has claimed, which is why an audio interface usually refuses here and works fine as an audio input.');
    renderUsb();
  } catch (e) { log('USB chooser cancelled or refused: ' + e.name); }
}
function renderUsb() {
  const w = ui.usb;
  w.textContent = '';
  if (!('usb' in navigator)) { w.appendChild(missing('WebUSB', IS_IOS ? 'iOS has none.' : 'Chrome and Edge only.')); return; }
  if (!usb.length) { w.appendChild(el('p', 'empty', 'nothing granted.')); return; }
  usb.forEach(d => {
    const c = el('div', 'dev');
    const hd = el('div', 'hd');
    hd.appendChild(el('div', 'nm', (d.manufacturerName ? d.manufacturerName + ' ' : '') + (d.productName || 'unnamed USB device')));
    const tags = el('div', 'tags');
    tags.appendChild(pill('vid ' + id4(d.vendorId)));
    tags.appendChild(pill('pid ' + id4(d.productId)));
    tags.appendChild(pill('USB ' + d.usbVersionMajor + '.' + d.usbVersionMinor));
    hd.appendChild(tags);
    c.appendChild(hd);
    c.appendChild(kv([
      ['serial', d.serialNumber || 'not exposed'],
      ['configurations', d.configurations ? d.configurations.length : 0],
      ['interfaces', d.configuration ? d.configuration.interfaces.length : '—'],
      ['device class', id4(d.deviceClass)],
      ['opened', d.opened ? 'yes' : 'no'],
    ]));
    w.appendChild(c);
  });
}

/* ---------- Bluetooth ---------- */
async function btRequest() {
  try {
    const d = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [] });
    bt.push(d);
    log('bluetooth device granted: ' + (d.name || d.id),
        'the page can see this one device and nothing else nearby. web bluetooth never hands over a scan of the room.');
    renderBt();
  } catch (e) { log('bluetooth chooser cancelled or refused: ' + e.name); }
}
async function renderBt() {
  const w = ui.bt;
  w.textContent = '';
  if (!('bluetooth' in navigator)) { w.appendChild(missing('Web Bluetooth', IS_IOS ? 'iOS has none.' : 'Chrome and Edge only, and not on Linux by default.')); return; }
  let avail = null;
  try { avail = await navigator.bluetooth.getAvailability(); } catch (e) {}
  w.appendChild(kv([['radio available', avail == null ? 'unknown' : avail ? 'yes' : 'no adapter or it is off']]));
  if (!bt.length) { w.appendChild(el('p', 'empty', 'nothing granted.')); return; }
  bt.forEach(d => {
    const c = el('div', 'dev');
    const hd = el('div', 'hd');
    hd.appendChild(el('div', 'nm', d.name || 'unnamed device'));
    const tags = el('div', 'tags');
    tags.appendChild(pill('id ' + String(d.id).slice(0, 8)));
    tags.appendChild(pill(d.gatt && d.gatt.connected ? 'connected' : 'not connected', d.gatt && d.gatt.connected ? 'ok' : 'warn'));
    hd.appendChild(tags);
    c.appendChild(hd);
    w.appendChild(c);
  });
}

function renderAll() {
  renderHid(); renderSerial(); renderUsb(); renderBt();
  const n = hid.length + serial.length + usb.length + bt.length;
  topline('wired', n ? count(n, 'wired device' + (n === 1 ? '' : 's')) : null);
}

export default {
  id: 'wired',
  title: 'wired & wireless',
  mount(root) {
    const mk = (title, label, fn, present) => {
      const h = el('h3', 'sub', title);
      const row = el('div', 'row');
      const b = el('button', 'tiny', label);
      b.disabled = !present;
      b.onclick = fn;
      row.appendChild(b);
      const w = el('div');
      root.append(h, row, w);
      return w;
    };
    ui = {};
    root.append(el('p', 'note',
      'None of these show anything until you pick a device from the browser’s own chooser. That is the whole security model: ' +
      'a page never gets a list of what is plugged in, only the one thing you handed it.'));
    ui.hid = mk('human interface devices (HID)', 'PICK A HID DEVICE', hidRequest, 'hid' in navigator);
    ui.serial = mk('serial ports', 'PICK A SERIAL PORT', serialRequest, 'serial' in navigator);
    ui.usb = mk('usb', 'PICK A USB DEVICE', usbRequest, 'usb' in navigator);
    ui.bt = mk('bluetooth', 'PICK A BLUETOOTH DEVICE', btRequest, 'bluetooth' in navigator);

    // devices granted in an earlier visit come back without a prompt
    if ('hid' in navigator) navigator.hid.getDevices().then(ds => { ds.forEach(d => hid.push(d)); renderHid(); }).catch(() => {});
    if ('serial' in navigator) navigator.serial.getPorts().then(ps => { ps.forEach(p => serial.push(p)); renderSerial(); }).catch(() => {});
    if ('usb' in navigator) navigator.usb.getDevices().then(ds => { ds.forEach(d => usb.push(d)); renderUsb(); }).catch(() => {});
    renderAll();
  },
  snapshot() {
    return {
      supported: { hid: 'hid' in navigator, serial: 'serial' in navigator, usb: 'usb' in navigator, bluetooth: 'bluetooth' in navigator },
      hid: hid.map(d => ({ product: d.productName, vendorId: d.vendorId, productId: d.productId, opened: d.opened })),
      serial: serial.map(p => ({ info: p.getInfo ? p.getInfo() : null, open: !!p.__open })),
      usb: usb.map(d => ({ product: d.productName, manufacturer: d.manufacturerName, vendorId: d.vendorId, productId: d.productId })),
      bluetooth: bt.map(d => ({ name: d.name || null })),
    };
  },
};
