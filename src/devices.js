// devices.js — one enumerateDevices for the whole page.
import { log, emit, on } from './core.js';

export const devices = { audioinput: [], audiooutput: [], videoinput: [] };
let everScanned = false;

export function labelsKnown() {
  return [...devices.audioinput, ...devices.videoinput].some(d => d.label);
}

export async function scan(quiet) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    log('this browser will not enumerate devices at all', '', 'err');
    return devices;
  }
  let list = [];
  try { list = await navigator.mediaDevices.enumerateDevices(); }
  catch (e) { log('enumerateDevices failed: ' + e.name, '', 'err'); return devices; }

  devices.audioinput  = list.filter(d => d.kind === 'audioinput');
  devices.audiooutput = list.filter(d => d.kind === 'audiooutput');
  devices.videoinput  = list.filter(d => d.kind === 'videoinput');
  emit('devices', devices);

  if (!quiet) {
    const anon = devices.audioinput.some(d => !d.label);
    log('found ' + devices.audioinput.length + ' audio in, ' + devices.audiooutput.length +
        ' audio out, ' + devices.videoinput.length + ' camera(s)',
      'this is the OS device list mirrored into the tab — USB interfaces, Bluetooth, aggregate devices, ' +
      'virtual cables like BlackHole or Loopback, all of it. ' +
      (anon ? 'names are blank because permission has not been granted yet: the count is free, the identity is not.'
            : 'names are readable because you granted permission once.') +
      (devices.audiooutput.length === 0
        ? ' zero outputs listed is normal in Safari and Firefox — they do not expose output devices to pages at all.' : ''));
  }
  everScanned = true;
  return devices;
}

export function onDevices(fn) { return on('devices', fn); }

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (!everScanned) return;
    log('the device list changed',
        'something was plugged in, unplugged, or woken up. the browser tells you for free — a real app just redraws here.');
    scan(true);
  });
}

export function snapshotDevices() {
  const map = d => ({ label: d.label || null, deviceId: d.deviceId, groupId: d.groupId });
  return {
    audioInputs: devices.audioinput.map(map),
    audioOutputs: devices.audiooutput.map(map),
    cameras: devices.videoinput.map(map),
    labelsKnown: labelsKnown(),
  };
}
