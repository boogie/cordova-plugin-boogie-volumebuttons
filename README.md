# cordova-plugin-boogie-volumebuttons

![platforms](https://img.shields.io/badge/platforms-android%20%7C%20ios%20%7C%20browser-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![tests](https://img.shields.io/badge/tests-node--test-brightgreen)

Turn the hardware **volume Up / Down buttons into events** — even while the app
is **backgrounded or the screen is locked** — on **Android, iOS, and the
browser**. A tiny, dependency-free bridge with a modern event API, sensible
defaults, and the one trick that makes volume-button detection actually work:
holding the level at a baseline so presses keep firing at the 0 / max edges.

```js
boogieVolumeButtons.on('volume', (e) => {
  console.log(e.direction); // 'up' or 'down'
});
```

The volume keys are the only physical buttons a normal app can reliably capture
on both platforms, which makes them a great **invisible remote** — for
performances, camera shutters, page turners, presentation clickers, kiosk
controls, accessibility shortcuts, or any hands-free trigger.

## Why this is harder than it looks

iOS has **no public "volume button pressed" API**. All you can observe is that
`AVAudioSession.outputVolume` *changed* — and that reveals two problems this
plugin solves for you:

- **The system volume HUD pops up** on every press. A hidden `MPVolumeView` in
  the view hierarchy swallows it (`suppressIndicator`).
- **The volume sticks at the edges.** At 100 % an up-press changes nothing, so
  no event fires; same at 0 % going down. The fix is to **snap the volume back
  to a mid baseline** (0.5 by default) after each press, so there is always
  headroom in both directions (`keepAtBaseline`). Most libraries in this space
  get this wrong — presses silently stop at the extremes.

Android is cleaner: in the foreground the real `KEYCODE_VOLUME_*` key events are
read and consumed (no volume change, no HUD); while backgrounded or locked a
volume-change broadcast — kept alive by a silent audio track — takes over.

## Install

From the Git repository:

```
cordova plugin add https://github.com/boogie/cordova-plugin-boogie-volumebuttons.git
```

Or from a local checkout:

```
cordova plugin add /path/to/cordova-plugin-boogie-volumebuttons
```

No configuration and **no special permissions** are required (no microphone, no
overlay). The defaults suppress the HUD and hold the baseline — the classic
"stealth remote" behavior — out of the box.

## Quick start

```js
document.addEventListener('deviceready', function () {
  // Any press:
  const off = boogieVolumeButtons.on('volume', function (e) {
    console.log(e.direction, e.steps, e.level, e.delta);
  });

  // Or listen per direction:
  boogieVolumeButtons.on('up', () => nextSlide());
  boogieVolumeButtons.on('down', () => prevSlide());

  // Later, stop listening (the last listener removed tears the native side down):
  // off();
}, false);
```

## JavaScript API

The plugin clobbers a global **`boogieVolumeButtons`**.

Subscribing to a button event **lazily arms** native detection; removing the
last listener **disarms** it, so the audio session and hidden volume view are
never held without a consumer.

### Events

| Event    | Payload |
|----------|---------|
| `volume` | `{ direction, steps, level, delta, timestamp }` — fires on any press |
| `up`     | same payload, only for up-presses |
| `down`   | same payload, only for down-presses |
| `error`  | `{ code, message }` |

The event object:

- **`direction`** — `'up'` or `'down'`.
- **`steps`** — how many volume increments the press represented (≥ 1; usually
  1, but a fast multi-step change reports the real count on Android).
- **`level`** — the output volume the press reached, `0..1` (before any
  baseline snap-back).
- **`delta`** — milliseconds since the previous volume event (`0` for the
  first). Handy for detecting double-presses or rhythms — a discreet way to
  send more than one signal.
- **`timestamp`** — ms since epoch.

### Subscribing

- **`on(type, callback)`** → `Function` — subscribe; returns an unsubscribe
  function for this exact subscription.
- **`once(type, callback)`** → `Function` — subscribe for a single event, then
  auto-unsubscribe.
- **`off(type, callback?)`** — remove a subscription, or every listener of the
  type when no callback is given.

### Options

- **`configure(options)`** → `Object` — merge options over the current ones and,
  if detection is running, apply them **live** (no dropped events). Returns the
  resulting options.
- **`getOptions()`** → `Object` — a copy of the current options.

| Option              | Default | Meaning |
|---------------------|---------|---------|
| `suppressIndicator` | `true`  | Hide the system volume HUD. iOS: hidden `MPVolumeView`. Android (foreground): consume the key event. |
| `keepAtBaseline`    | `true`  | Snap the volume back to `baseline` after each press, so presses keep firing at 0 / max and the real volume doesn't drift. |
| `baseline`          | `0.5`   | The level (0..1) to snap back to. Mid gives equal headroom both ways. |
| `background`        | `true`  | Keep detecting while backgrounded / the screen is locked (silent audio session/track). Costs a little battery. |

These map onto the three "modes" older plugins expose:

| Old mode     | Equivalent options |
|--------------|--------------------|
| `aggressive` | `{ suppressIndicator: true,  keepAtBaseline: true }` (the default) |
| `silent`     | `{ suppressIndicator: false, keepAtBaseline: false }` — HUD shows, volume changes, presses still detected |
| `none`       | remove your listeners (`off(...)`) — detection fully stops and native tears down |

### Volume control

- **`getVolume()`** → `Promise<number>` — the current output volume, `0..1`.
- **`setVolume(level)`** → `Promise<void>` — set the output volume (`0..1`).

### Misc

- **`isRunning()`** → `boolean` — whether detection is currently armed.
- **`events`** — the array of event names accepted by `on`/`once`/`off`.

## How it works

- **iOS** — KVO on `AVAudioSession.outputVolume` detects each press; a hidden,
  off-screen `MPVolumeView` suppresses the HUD and provides the slider used to
  snap the level back to `baseline`; a looping silent `AVAudioPlayer` keeps the
  audio session active so events keep arriving while backgrounded/locked. The
  session uses the `playback` category with `mixWithOthers`, so background music
  keeps playing. Self-triggered changes (the snap-back and the initial set) land
  on the baseline and are ignored.
- **Android** — in the foreground an `OnKeyListener` on the WebView reads
  `KEYCODE_VOLUME_UP/DOWN`; consuming the event both detects the press and stops
  the volume/HUD. While backgrounded or locked, a `VOLUME_CHANGED` broadcast
  receiver (kept alive by a silent `AudioTrack`) takes over and, with
  `keepAtBaseline`, resets the level. The receiver ignores changes while the app
  is foregrounded, so a press is never reported twice.
- **Browser** — there are no hardware volume keys exposed to web pages, so the
  proxy **simulates** them from the keyboard: `ArrowUp` = up, `ArrowDown` = down
  (remappable, see below). The same app code runs and is testable on the
  desktop.

## Behavior notes (read before shipping)

- **Test on a real device (iOS).** `MPVolumeView`-based volume changes — which
  the baseline snap-back relies on — **do not work on the iOS Simulator**.
- **Background costs battery.** Keeping the audio session/track alive to detect
  while backgrounded is a real, if small, drain. Set `background: false` if you
  only need detection while the app is on screen.
- **iOS background execution.** Detection continues while the app has a
  background audio context (the silent player provides one while the app is
  running). For detection to survive the app being *suspended* with the screen
  off, the app must enable the **Audio** background mode
  (`UIBackgroundModes` → `audio`) in its `Info.plist`. Add it in your app if you
  need locked-screen detection over long idle periods.
- **Control Center / hardware slider drags** also change `outputVolume` on iOS,
  so they surface as `up`/`down` events too. Use `delta`/`steps` if you need to
  distinguish deliberate button taps from a drag.
- **Android background HUD.** In the background broadcast path the system volume
  UI cannot be suppressed the way a consumed foreground key can — the change has
  already happened by the time the broadcast arrives. `keepAtBaseline` still
  keeps presses working; it just can't hide that brief change.
- **Simulator/desktop testing** — use the browser platform (keyboard) for logic
  and the real devices for the native behavior.

## Other physical buttons (iPhone)

Only the volume buttons are capturable as live in-app events. For the record:

- **Action Button (iPhone 15 Pro and later)** — **not** capturable. It is
  user-configured in Settings (Shortcut / camera / etc.); an app can only
  publish an App Intent the user *manually* assigns. There is no live
  "Action button pressed" event.
- **Camera Control (iPhone 16)** — reachable only via `AVCaptureEventInteraction`
  (iOS 17.2+) **while an `AVCaptureSession` is active** (camera apps in the
  foreground). Not usable from a general Cordova WebView.
- **Power button / ring-silent switch** — not capturable.

That's why volume-button detection remains the standard technique.

## Browser (development)

The browser build maps the keyboard so you can develop and test without a
device:

```js
// Defaults: ArrowUp = up, ArrowDown = down.
boogieVolumeButtons.configure({ keys: { up: ['w', 'ArrowUp'], down: ['s', 'ArrowDown'] } });
```

`getVolume`/`setVolume` track a simulated level starting at `0.5`.

## TypeScript

`index.d.ts` ships with the plugin and declares the `boogieVolumeButtons`
global; most setups pick it up automatically via the `types` field.

## Migrating from other volume-button plugins

Older plugins expose a single register callback and never tear down. The move
is mechanical:

```js
// benkesmith / manueldeveloper style:
VolumeButtons.onVolumeButtonPressed((dir) => { /* 'up' | 'down' */ });
window.addEventListener('volumebuttonslistener', (e) => { /* e.signal */ });

// here:
boogieVolumeButtons.on('volume', (e) => { /* e.direction */ });
```

Modes become options (see the table above), and you can now actually stop
listening — `off(...)` (or removing the last listener) tears the native side
down cleanly.

## Ideas / roadmap

Not implemented yet, but a natural fit:

- **Long-press and press/release events** — distinguish a hold from a tap.
- **Debounce / min-interval option** — collapse rapid or drag-generated events.
- **Chord / sequence recognition** — "up-up-down" as a single gesture, built on
  `delta`.
- **Per-stream selection on Android** (`music`, `ring`, `alarm`, …).
- **Android foreground-service mode** for guaranteed long locked-screen sessions.

Issues and PRs welcome.

## Tests

```
npm test
```

Runs on Node 18+ with the built-in `node:test` runner — no dev dependencies.
The suite unit-tests the JS bridge against a mocked `cordova/exec` (lazy
arm/disarm, event fan-out to `volume`/`up`/`down`, live configuration, option
clamping, promise helpers, error routing), exercises the browser proxy against a
faked `window` (keyboard-simulated presses, volume round-trip, key remapping),
and cross-checks `plugin.xml`, `package.json`, `index.d.ts`, and the native
sources for consistency (ids, versions, referenced files, feature/service names,
action coverage, bundled resources).

## Layout

```
plugin.xml                     — Cordova manifest (android + ios + browser)
package.json                   — npm/cordova metadata, npm test
index.d.ts                     — TypeScript definitions for the boogieVolumeButtons global
www/volumebuttons.js           — the JS bridge (global: boogieVolumeButtons)
src/android/VolumeButtonsPlugin.java — native Android (key listener + broadcast + silent track)
src/ios/VolumeButtonsPlugin.{h,m}    — native iOS (outputVolume KVO + MPVolumeView + silent player)
src/ios/silence.mp3            — looped silent audio that keeps the iOS session alive
src/browser/volumebuttons.js   — browser proxy (keyboard simulation)
tests/                         — node:test suite (bridge + browser + structure)
```

The Java package is `hu.barthazi.volumebuttons`; the iOS class is
`VolumeButtonsPlugin`.

## License

MIT.
