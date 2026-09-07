// caps.js — what this browser, on this machine, at this URL, will let a page do at all.
// No permission needed to find any of this out.
import { el, esc, fill, UA, IS_IOS } from './core.js';

const AC = window.AudioContext || window.webkitAudioContext;

/** true allowed · false blocked · null the browser will not say */
function policyAllows(feature) {
  try {
    const fp = document.featurePolicy || document.permissionsPolicy;
    if (fp && typeof fp.allowsFeature === 'function') return fp.allowsFeature(feature);
  } catch (e) {}
  return null;
}

export function groups() {
  const md = navigator.mediaDevices;
  const sc = md && md.getSupportedConstraints ? md.getSupportedConstraints() : {};
  const acp = AC ? AC.prototype : {};
  return [
    ['the address bar', [
      ['secure context', window.isSecureContext, 'https or localhost. without it, almost nothing below works'],
      ['cross-origin isolated', !!window.crossOriginIsolated, 'needs COOP + COEP response headers; unlocks SharedArrayBuffer'],
      ['microphone allowed by policy', policyAllows('microphone'), 'a page inside an iframe can be refused the mic before it ever asks'],
      ['camera allowed by policy', policyAllows('camera'), 'same gate, different device'],
      ['midi allowed by policy', policyAllows('midi'), 'same gate again'],
    ]],
    ['getting sound in', [
      ['getUserMedia', !!(md && md.getUserMedia), 'the only way to open a microphone or a line in'],
      ['enumerateDevices', !!(md && md.enumerateDevices), 'the device list, names withheld until you allow once'],
      ['getDisplayMedia', !!(md && md.getDisplayMedia), 'capture a tab, a window or the screen — sometimes with its audio'],
      ['channelCount constraint', !!sc.channelCount, 'ask a multi-channel interface for all of its inputs'],
      ['sampleRate constraint', !!sc.sampleRate, 'ask for a specific rate on the way in'],
      ['echoCancellation switch', !!sc.echoCancellation, 'must be off for music, on for calls'],
      ['noiseSuppression switch', !!sc.noiseSuppression, 'the thing that eats your reverb tail'],
      ['autoGainControl switch', !!sc.autoGainControl, 'the thing that ruins your dynamics'],
      ['applyConstraints', !!(window.MediaStreamTrack && MediaStreamTrack.prototype.applyConstraints), 'renegotiate a live track without reopening it'],
    ]],
    ['getting sound out', [
      ['AudioContext', !!AC, 'the rack itself'],
      ['setSinkId on context', !!(acp && 'setSinkId' in acp), IS_IOS ? 'iOS routes output itself; a page never chooses' : 'choose the output device from the page — Chrome and Edge only'],
      ['selectAudioOutput()', !!(md && md.selectAudioOutput), 'a system picker that also unlocks output device names'],
      ['setSinkId on media elements', !!(window.HTMLMediaElement && 'setSinkId' in HTMLMediaElement.prototype), 'the older, wider route to a chosen output'],
      ['AudioWorklet', typeof AudioWorkletNode !== 'undefined', 'your own DSP on the audio thread, 128 frames at a time'],
      ['ScriptProcessor (legacy)', typeof ScriptProcessorNode !== 'undefined', 'the deprecated main-thread fallback'],
      ['OfflineAudioContext', typeof OfflineAudioContext !== 'undefined', 'render faster than real time, for bouncing'],
      ['StereoPanner', !!(AC && typeof StereoPannerNode !== 'undefined'), 'equal-power panning without building it yourself'],
      ['MediaSession', 'mediaSession' in navigator, 'lock-screen transport controls'],
      ['speechSynthesis', 'speechSynthesis' in window, 'a voice you did not have to record'],
    ]],
    ['other ins and outs', [
      ['Web MIDI', !!navigator.requestMIDIAccess, IS_IOS ? 'not on iOS — every browser there is WebKit' : 'controllers, synths, sysex'],
      ['MediaRecorder', typeof MediaRecorder !== 'undefined', 'capture a stream straight to a file'],
      ['WebCodecs (audio)', typeof AudioEncoder !== 'undefined', 'frame-level encode and decode'],
      ['SharedArrayBuffer', typeof SharedArrayBuffer !== 'undefined', 'lock-free ring buffers between a worklet and the main thread'],
      ['Atomics', typeof Atomics !== 'undefined', 'the other half of that'],
      ['AudioWorklet + SAB', typeof AudioWorkletNode !== 'undefined' && typeof SharedArrayBuffer !== 'undefined', 'the combination real-time audio actually wants'],
      ['WebAssembly', typeof WebAssembly !== 'undefined', 'someone else’s DSP, compiled'],
      ['WebGPU', 'gpu' in navigator, 'not audio, but it is an out'],
      ['Gamepad API', !!navigator.getGamepads, 'knobs and faders that were never meant to be knobs and faders'],
      ['WebHID', 'hid' in navigator, 'raw access to control surfaces that refuse to be MIDI'],
      ['WebSerial', 'serial' in navigator, 'a microcontroller on a wire'],
      ['WebUSB', 'usb' in navigator, 'the last resort'],
      ['Web Bluetooth', 'bluetooth' in navigator, 'BLE MIDI, sometimes'],
      ['Window Management', 'getScreenDetails' in window, 'see every display, not just the one you are on'],
      ['Vibration', !!navigator.vibrate, 'an out you can feel'],
      ['Wake Lock', 'wakeLock' in navigator, 'keep the screen up during a take'],
      ['Notifications', 'Notification' in window, 'an out that leaves the tab'],
      ['Clipboard', !!navigator.clipboard, 'in and out, gated differently in each direction'],
      ['queryLocalFonts', 'queryLocalFonts' in window, 'the installed font list, behind a prompt because it fingerprints you'],
      ['WebXR', 'xr' in navigator, 'headsets are ins and outs at once'],
      ['DeviceMotion', typeof DeviceMotionEvent !== 'undefined', 'the whole machine as a controller'],
      ['Generic Sensors', typeof window.Accelerometer !== 'undefined', 'accelerometer, gyroscope, magnetometer, light'],
      ['Geolocation', !!navigator.geolocation, 'an in you should think about before granting'],
      ['Storage estimate', !!(navigator.storage && navigator.storage.estimate), 'how much room you actually have'],
      ['localStorage', (() => { try { localStorage.setItem('bum.t', '1'); localStorage.removeItem('bum.t'); return true; } catch (e) { return false; } })(), 'where your profile is kept'],
      ['File System Access', 'showOpenFilePicker' in window, 'read and write real files, with permission'],
      ['OPFS', !!(navigator.storage && navigator.storage.getDirectory), 'a private filesystem fast enough to stream audio from'],
    ]],
  ];
}

const REC_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2',
                   'audio/mp4', 'audio/mpeg', 'audio/wav', 'video/webm;codecs=vp9,opus', 'video/mp4'];
const PLAY_TYPES = ['audio/wav', 'audio/flac', 'audio/mpeg', 'audio/aac', 'audio/mp4',
                    'audio/ogg; codecs=vorbis', 'audio/ogg; codecs=opus', 'audio/webm; codecs=opus', 'audio/aiff'];

export function recordable() {
  const can = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported;
  return REC_TYPES.map(t => [t, can ? MediaRecorder.isTypeSupported(t) : false]);
}
export function playable() {
  const probe = document.createElement('audio');
  return PLAY_TYPES.map(t => [t, probe.canPlayType(t) || '']);
}

function capRow(name, ok, why) {
  const cls = ok === true ? 'yes' : ok === false ? 'no' : 'part';
  const word = ok === true ? 'yes' : ok === false ? 'no ' : ' ? ';
  const d = el('div', 'cap ' + cls);
  d.innerHTML = '<b>' + word + '</b> ' + esc(name) + (why ? ' <em>— ' + esc(why) + '</em>' : '');
  return d;
}

export default {
  id: 'caps',
  title: 'allowed',
  mount(root) {
    const wrap = el('div');
    let first = true;
    for (const [group, rows] of groups()) {
      const h = el('h3', 'sub' + (first ? ' first' : ''), group);
      first = false;
      wrap.appendChild(h);
      const g = el('div', 'caps');
      for (const [name, ok, why] of rows) g.appendChild(capRow(name, ok, why));
      wrap.appendChild(g);
    }

    wrap.appendChild(el('h3', 'sub', 'record to'));
    const rg = el('div', 'caps');
    for (const [t, ok] of recordable()) rg.appendChild(capRow(t, ok));
    wrap.appendChild(rg);

    wrap.appendChild(el('h3', 'sub', 'play back'));
    const pg = el('div', 'caps');
    for (const [t, r] of playable()) {
      const cls = r === 'probably' ? true : r === 'maybe' ? null : false;
      const d = capRow(t, cls);
      d.querySelector('b').textContent = r || 'no ';
      pg.appendChild(d);
    }
    wrap.appendChild(pg);

    const note = el('p', 'note');
    note.textContent =
      (IS_IOS ? 'iOS: every browser here is WebKit underneath, whatever the icon says. ' : '') +
      (window.isSecureContext ? '' : 'NOT a secure context — open this over https or from localhost or most of the page is dead. ') +
      UA;
    wrap.appendChild(note);
    fill(root, wrap);
  },
  snapshot() {
    const caps = {};
    for (const [g, rows] of groups()) {
      caps[g] = {};
      for (const [n, ok] of rows) caps[g][n] = ok === null ? 'unknown' : !!ok;
    }
    return {
      capabilities: caps,
      recordFormats: recordable().filter(([, ok]) => ok).map(([t]) => t),
      playbackFormats: playable().filter(([, r]) => r).map(([t, r]) => t + ' (' + r + ')'),
    };
  },
};
