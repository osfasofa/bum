// main.js — the only wiring. Import a section, add it to the list, and it mounts,
// appears in the report, and can never silently fall out of either.
import { $, initLog, initTopline, log, clearLog, IS_IOS, IS_FF, IS_SAFARI } from './core.js';
import { register, mountAll } from './registry.js';
import { scan } from './devices.js';
import { startEngine } from './engine.js';

import seat from './seat.js';
import permissions, { askEverything } from './permissions.js';
import caps from './caps.js';
import engine from './engine.js';
import audioIn, { disarmAll } from './audio-in.js';
import mixer from './mixer.js';
import audioOut from './audio-out.js';
import midi from './midi.js';
import screens from './screens.js';
import cameras from './cameras.js';
import human from './human.js';
import wired from './wired.js';
import sensors from './sensors.js';
import outs from './outs.js';
import profile, { registerToolbar } from './profile.js';

register(seat, permissions, caps, engine, audioIn, mixer, audioOut, midi,
         screens, cameras, human, wired, sensors, outs, profile);

initLog($('log'));
initTopline($('topline'));
mountAll();

$('btnClearLog').onclick = clearLog;
$('btnWake').onclick = async () => { await startEngine(); await scan(); };
$('btnGrantAll').onclick = askEverything;
$('btnRescan').onclick = () => scan();
registerToolbar($('btnSave'), $('btnRestore'), $('btnExport'));

window.addEventListener('beforeunload', () => { try { disarmAll(); } catch (e) {} });

scan(true).then(() => {
  log('bum is awake. nothing has been asked for yet.',
      'the device counts above came for free — enumerateDevices works with no permission at all, it just refuses to say what anything ' +
      'is called. that gap is the whole privacy model in one line: you may know how many, not which.');
  if (!window.isSecureContext) {
    log('this page is not in a secure context',
        'no microphone, no camera, no MIDI, no device names. serve it over https or from localhost.', 'err');
  }
  if (IS_IOS) {
    log('iOS detected',
        'expect: no output device picker, an empty output list, one capture at a time, no Web MIDI, no HID or serial or USB, ' +
        'the engine suspending on lock, and the ring/silent switch muting everything.');
  } else if (IS_SAFARI) {
    log('Safari detected', 'no Web MIDI, no output device selection, no HID, serial, USB or Bluetooth. audio follows the system default output.');
  } else if (IS_FF) {
    log('Firefox detected', 'no setSinkId on AudioContext, so output follows the system default. Web MIDI is there in recent versions, behind a prompt. No HID, serial or USB.');
  }
});
