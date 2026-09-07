// sensors.js — the machine noticing the room it is in.
import { el, kv, fill, log, emit } from './core.js';

let ui = null;
const live = { motion: null, orientation: null, light: null, geo: null };
const running = new Set();

/* ---------- motion & orientation ---------- */
export async function askMotion() {
  if (typeof DeviceMotionEvent === 'undefined') {
    log('no motion sensors exposed here', 'desktops usually have none. this is a phone and tablet feature.', 'err');
    render();
    return false;
  }
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') {
        log('motion refused', 'iOS requires a tap for this and will not ask twice in the same page load.', 'err');
        render();
        return false;
      }
    } catch (e) { log('motion request failed: ' + e.name, '', 'err'); render(); return false; }
  }
  window.addEventListener('devicemotion', e => {
    const a = e.accelerationIncludingGravity || {};
    const r = e.rotationRate || {};
    live.motion = { x: a.x, y: a.y, z: a.z, alpha: r.alpha, beta: r.beta, gamma: r.gamma, interval: e.interval };
    render();
  });
  window.addEventListener('deviceorientation', e => {
    live.orientation = { alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: e.absolute };
    render();
  });
  running.add('motion');
  log('motion and orientation reading', 'on a phone the whole machine is a controller. tilt is a modulation source if you decide it is.');
  emit('permissions');
  render();
  return true;
}

/* ---------- generic sensors ---------- */
const GENERIC = [
  ['Accelerometer', 'accelerometer', s => ({ x: s.x, y: s.y, z: s.z })],
  ['Gyroscope', 'gyroscope', s => ({ x: s.x, y: s.y, z: s.z })],
  ['Magnetometer', 'magnetometer', s => ({ x: s.x, y: s.y, z: s.z })],
  ['AmbientLightSensor', 'light', s => ({ illuminance: s.illuminance })],
  ['AbsoluteOrientationSensor', 'orientation-abs', s => ({ quaternion: s.quaternion })],
];

function startGeneric(name, key, read) {
  const Ctor = window[name];
  if (!Ctor) { log(name + ' is not in this browser', 'the Generic Sensor API is Chrome-only, and most of it needs a phone.', 'err'); return; }
  try {
    const s = new Ctor({ frequency: 10 });
    s.addEventListener('reading', () => { live[key] = read(s); render(); });
    s.addEventListener('error', ev => log(name + ' error: ' + (ev.error && ev.error.name), 'often a permissions-policy block or no such hardware.', 'err'));
    s.start();
    running.add(key);
    log('started ' + name);
    render();
  } catch (e) { log(name + ' refused: ' + e.name, '', 'err'); }
}

/* ---------- geolocation ---------- */
function askGeo() {
  if (!navigator.geolocation) { log('no geolocation here', '', 'err'); return; }
  navigator.geolocation.getCurrentPosition(
    p => {
      live.geo = { accuracy: p.coords.accuracy, altitude: p.coords.altitude, altitudeAccuracy: p.coords.altitudeAccuracy,
                   heading: p.coords.heading, speed: p.coords.speed };
      log('location granted, accurate to about ' + Math.round(p.coords.accuracy) + ' m',
          'the coordinates themselves are deliberately not shown or exported here. the accuracy figure tells you whether it came from GPS or from a wifi lookup, which is the part that is interesting about your hardware.');
      emit('permissions');
      render();
    },
    e => { log('location refused: ' + e.message, '', 'err'); emit('permissions'); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

const f = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));

function render() {
  if (!ui) return;
  const rows = [];
  rows.push(['motion sensors', typeof DeviceMotionEvent !== 'undefined' ? (running.has('motion') ? 'reading' : 'available, not started') : 'none']);
  if (live.motion) {
    rows.push(['accel x/y/z', [live.motion.x, live.motion.y, live.motion.z].map(v => f(v)).join('  ')]);
    rows.push(['rotation a/b/g', [live.motion.alpha, live.motion.beta, live.motion.gamma].map(v => f(v, 1)).join('  ')]);
    rows.push(['sample interval', live.motion.interval != null ? live.motion.interval + ' ms' : '—']);
  }
  if (live.orientation) {
    rows.push(['orientation a/b/g', [live.orientation.alpha, live.orientation.beta, live.orientation.gamma].map(v => f(v, 1)).join('  ')]);
    rows.push(['absolute', live.orientation.absolute ? 'yes' : 'no']);
  }
  if (live.light) rows.push(['ambient light', f(live.light.illuminance, 0) + ' lux']);
  if (live.geo) {
    rows.push(['location accuracy', Math.round(live.geo.accuracy) + ' m']);
    rows.push(['altitude', live.geo.altitude != null ? Math.round(live.geo.altitude) + ' m' : 'not reported']);
    rows.push(['heading / speed', f(live.geo.heading, 0) + '° / ' + f(live.geo.speed, 1) + ' m/s']);
  }
  fill(ui.stats, kv(rows));
}

export default {
  id: 'sensors',
  title: 'sensors',
  mount(root) {
    const row = el('div', 'row');
    const motion = el('button', 'tiny', 'READ MOTION');
    motion.onclick = askMotion;
    row.appendChild(motion);
    GENERIC.forEach(([name, key, read]) => {
      const b = el('button', 'tiny', name.replace('Sensor', '').toUpperCase());
      b.disabled = !window[name];
      b.onclick = () => startGeneric(name, key, read);
      row.appendChild(b);
    });
    const geo = el('button', 'tiny', 'LOCATION');
    geo.onclick = askGeo;
    row.appendChild(geo);

    const stats = el('div');
    const note = el('p', 'note',
      'Location is here for completeness and is the one input on this page you should think twice about granting. ' +
      'Nothing about your position is stored, shown or exported — only how accurate the fix was, which tells you whether it came ' +
      'from a GPS chip or from a wifi lookup.');
    root.append(row, stats, note);
    ui = { stats };
    render();
  },
  snapshot() {
    return {
      motionAvailable: typeof DeviceMotionEvent !== 'undefined',
      motionNeedsPermission: typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function',
      genericSensors: GENERIC.reduce((a, [n]) => (a[n] = !!window[n], a), {}),
      running: [...running],
      lastMotion: live.motion,
      lastOrientation: live.orientation,
      ambientLightLux: live.light ? live.light.illuminance : null,
      geolocationAccuracyM: live.geo ? live.geo.accuracy : null,
    };
  },
};
