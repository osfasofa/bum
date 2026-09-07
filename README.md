# bum

**A bum in a browser.** Open a tab, see what you've got.

### [master.bate.lol](https://master.bate.lol)

You showed up. The seat was already here. A browser tab owns no hardware — it *asks*,
and the OS decides what to hand over. This page asks for everything, one thing at a time,
and shows you exactly what came back.

It's an inventory of every in and every out: what you can bring in, what you can send out,
and what this particular browser on this particular machine will let you do with it.
Aimed at audio, honest about the rest.

## What it shows you

| | |
|---|---|
| **the seat** | cores, memory, storage quota, power, network, cross-origin isolation, and the OS preferences your browser passes along |
| **permissions** | live state for microphone, camera, MIDI, sysex, output selection, motion, clipboard, fonts, sensors — granted, prompt, denied, or "this browser won't say" |
| **allowed** | the capability matrix: secure context, worklets, `setSinkId`, SharedArrayBuffer, OPFS, WebHID, WebSerial, WebUSB, Bluetooth, WebCodecs, plus every container the recorder and decoder actually take |
| **engine** | AudioContext state, sample rate, base and output latency, render quantum in milliseconds, channel count, live clock — and two worklet probes that *load real modules* rather than checking for a constructor |
| **ins** | every audio input the OS lists. Arm one for its real channel count, rate, and whether echo cancellation, noise suppression and AGC actually turned off. Per-channel meters with peak hold and clip latch. Record to disk. Capture another tab's audio as an input. |
| **mixer** | a strip per armed input: gain, pan, mute, solo, and on a multichannel interface, which physical socket it lands on. Post-fader metering. This is the part that makes the tab an interface. |
| **outs** | pick the output device, address channels discretely, ping each physical out to find which speaker is really channel 5, watch per-channel output meters |
| **midi** | in and out, live decoded messages with raw bytes, send a note, sweep a CC, panic |
| **screens** | resolution, pixel ratio, colour gamut, dynamic range, measured refresh rate, and every physical display if you grant window management |
| **cameras** | listed with resolution and frame rate, because an honest inventory counts them |
| **human input** | pointer type, touch points, hover, keyboard `code` versus `key`, the physical layout map, gamepad axes and rumble — and a pad that reports stylus pressure, tilt and twist as you draw on it |
| **wired & wireless** | HID, serial, USB and Bluetooth with real device choosers. Streams raw HID input reports and serial bytes. |
| **sensors** | motion, orientation, accelerometer, gyroscope, magnetometer, ambient light, and a location fix reported only as its accuracy |
| **other outs** | speech voices, vibration, screen wake lock, notifications, clipboard round trip, local fonts, WebXR |
| **profile** | save what you had armed and mixed, restore it next visit, export every section as one JSON file |

## Local only

No network calls. No analytics. No upload. No dependencies, no build step, no fonts fetched.

The deployed site sends `connect-src 'none'` in its Content-Security-Policy, so that is not a
promise you have to take on trust — the browser refuses to let this page open a connection at all.
The profile lives in your browser's localStorage; exports download to your own disk.

## Run it

Needs a secure context — https or localhost — or the browser withholds microphones, cameras,
MIDI and every device name. ES modules also need a real server; `file://` will not do.

```sh
npx serve .                     # then http://localhost:3000
python3 -m http.server 8777     # or http://127.0.0.1:8777
```

Served that way you lose the response headers, so `SharedArrayBuffer` will read *no* and
`connect-src` is not enforced. That difference is itself worth seeing.

## Headers

`vercel.json` sets them, and they are part of the tool rather than boilerplate:

| header | why |
|---|---|
| `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` | makes the origin cross-origin isolated, which turns `SharedArrayBuffer` and "AudioWorklet + SAB" from no into yes |
| `Content-Security-Policy` | `script-src 'self' blob:`, `style-src 'self'`, no `unsafe-inline` anywhere; `frame-ancestors 'none'` so the page cannot be framed to bait a permission prompt |
| `connect-src 'none'` | the browser enforces the no-network claim |
| `Permissions-Policy` | every feature the page uses, listed explicitly |

## Layout

No bundler. The browser resolves the imports itself.

```
index.html          the shell and the prose
bum.css             every style
vercel.json         the headers above
src/
  core.js           dom helpers, log, the single meter loop, the event bus
  registry.js       the section contract
  devices.js        one enumerateDevices for the whole page
  engine.js  audio-in.js  mixer.js  audio-out.js
  midi.js  screens.js  cameras.js  human.js  wired.js  sensors.js  outs.js
  seat.js  permissions.js  caps.js  profile.js
  probe-worklet.js  a real worklet module, loaded to prove the path works
  main.js           the only wiring
```

Every section exports the same shape — `{ id, title, mount(root), snapshot() }` — so adding one
to the list in `main.js` mounts it *and* puts it in the export. Nothing can quietly fall out of
the report.

## What to expect from each seat

- **Chrome / Edge** — all of it. Output selection, Web MIDI, HID, serial, USB, Bluetooth, window management, local fonts.
- **Firefox** — no `setSinkId` on AudioContext, so audio follows the system default output. Web MIDI in recent versions. No HID, serial or USB.
- **Safari** — no Web MIDI, no output selection, empty output device list, none of the wired APIs.
- **iOS** — every browser there is WebKit whatever the icon says. No MIDI, no output picker, one capture at a time, engine suspends on lock, ring/silent switch mutes everything.

## Things worth trying

- Load it before granting anything. Counts, no names. That gap is the whole privacy model.
- Arm two inputs at once on desktop. Try the same on iOS.
- Switch output device while the test tone is playing.
- Build an Aggregate Device in Audio MIDI Setup, then rescan.
- Route another app through BlackHole or Loopback and arm it here.
- Force 96000 Hz and watch what the hardware actually gives back.
- Ping each channel on an eight-out interface and label your speakers properly for once.
- Draw on the pointer pad with a stylus, then with a finger, then with a mouse.
- Plug in a control surface that refuses to be MIDI and open it as a HID device.
- Export the JSON before filing a bug against an audio app. It answers most of the questions.

## License

MIT
