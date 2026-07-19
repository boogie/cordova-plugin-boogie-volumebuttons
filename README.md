# cordova-plugin-boogie-volumebuttons

![platforms](https://img.shields.io/badge/platforms-android%20%7C%20ios%20%7C%20browser-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![tests](https://img.shields.io/badge/tests-node--test-brightgreen)

Turn the hardware **volume Up / Down buttons into events** — even while the app
is **backgrounded or the screen is locked** — on **Android, iOS, and the
browser**. A tiny, dependency-free bridge with a modern event API, sensible
defaults, derived **double-press and hold** gestures, and the one trick that
makes volume-button detection actually work: holding the level at a baseline so
presses keep firing at the 0 / max edges.

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
`AVAudioSession.outputVolume` *changed* — and that reveals three problems this
plugin solves for you:

- **The system volume HUD pops up** on every press. A hidden `MPVolumeView` in
  the view hierarchy swallows it (`suppressIndicator`).
- **The volume sticks at the edges.** At 100 % an up-press changes nothing, so
  no event fires; same at 0 % going down. The fix is to **snap the volume back
  to a mid baseline** (0.5 by default) after each press (`keepAtBaseline`). Most
  libraries in this space get this wrong — presses silently stop at the extremes.
- **The buttons must control *media* volume, not the ringer.** They only do that
  while the app's audio session is active — so if the session loses the race at
  launch, nothing is detected until something re-activates it (see
  [Locked-screen & cold-start](#locked-screen--cold-start-ios)).

Android is cleaner: in the foreground the real `KEYCODE_VOLUME_*` key events are
read and consumed (no volume change, no HUD, and a precise long-press); while
backgrounded or locked a volume-change broadcast — kept alive by a looping
ambient sound — takes over.

## Install

```
cordova plugin add https://github.com/boogie/cordova-plugin-boogie-volumebuttons.git
```

For **locked-screen detection on iOS**, opt in to the Audio background mode:

```
cordova plugin add https://github.com/boogie/cordova-plugin-boogie-volumebuttons.git --variable ENABLE_LOCKSCREEN=true
```

No special runtime permissions are required (no microphone, no overlay). The
defaults suppress the HUD and hold the baseline — the classic "stealth remote"
behavior — out of the box.

## Quick start

```js
document.addEventListener('deviceready', function () {
  boogieVolumeButtons.on('up',     () => nextSlide());
  boogieVolumeButtons.on('down',   () => prevSlide());
  boogieVolumeButtons.on('double', (e) => console.log('double', e.direction));
  boogieVolumeButtons.on('hold',   (e) => console.log('held', e.direction));
}, false);
```

## JavaScript API

The plugin clobbers a global **`boogieVolumeButtons`**.

Subscribing to any button/gesture event **lazily arms** native detection;
removing the last listener **disarms** it, so the audio session and hidden
volume view are never held without a consumer.

### Events

| Event | Payload |
|-------|---------|
| `volume` | `{ direction, steps, level, delta, timestamp }` — any press |
| `up` / `down` | same payload, filtered by direction |
| `double` / `doubleup` / `doubledown` | `{ direction, timestamp }` — two same-direction taps in a window |
| `hold` | `{ direction, duration, source, timestamp }` — a sustained press begins |
| `holdend` | `{ direction, duration, timestamp }` — a sustained press ends |
| `error` | `{ code, message }` |

The press event object:

- **`direction`** — `'up'` or `'down'`.
- **`steps`** — how many volume increments the press represented (≥ 1; usually 1).
- **`level`** — the output volume the press reached, `0..1` (before any snap-back).
- **`delta`** — ms since the previous volume event (`0` for the first). Handy for
  your own rhythm/sequence detection.
- **`timestamp`** — ms since epoch.

### Gestures (double-press & hold)

Both are derived in the JS layer on top of the raw press stream, so they work on
all three platforms:

- **`double`** fires when two same-direction taps land within `doublePressWindow`
  (default 350 ms). A single tap or three-plus rapid presses never fire it.
- **`hold`** / **`holdend`** mark a sustained press. On **Android in the
  foreground** they are **precise** — measured from the real key down/up, with an
  exact `duration` on `holdend` (`source: 'native'`). Everywhere else (iOS, the
  browser, Android in the background) a hold is **inferred** from the OS
  auto-repeat burst (`source: 'inferred'`): `hold` fires once the press has been
  sustained past `holdMs` (default 500 ms), `holdend` when the repeats stop.
  Because it's inferred there, rapid button-mashing can look like a hold, and the
  duration is approximate — see the notes below.

> A held button on iOS also emits a stream of raw `volume`/`up`/`down` events
> (one per OS auto-repeat); the `hold`/`holdend` gestures are the clean
> abstraction over that. On Android foreground a hold emits one raw press (the
> initial down) plus `hold`/`holdend`.

### Subscribing

- **`on(type, callback)`** → `Function` — subscribe; returns an unsubscribe
  function for this exact subscription.
- **`once(type, callback)`** → `Function` — subscribe for one event, then
  auto-unsubscribe.
- **`off(type, callback?)`** — remove a subscription, or every listener of the
  type when no callback is given.

### Options

- **`configure(options)`** → `Object` — merge options over the current ones and,
  if running, apply the detection options **live**. Gesture tuning applies
  immediately. Returns the resulting options.
- **`getOptions()`** → `Object` — a copy of the current options.

| Option | Default | Meaning |
|--------|---------|---------|
| `suppressIndicator` | `true` | Hide the system volume HUD. iOS: hidden `MPVolumeView`. Android (foreground): consume the key event. |
| `keepAtBaseline` | `true` | Snap the volume back to `baseline` after each press. |
| `baseline` | `0.5` | The level (0..1) to snap back to. |
| `background` | `true` | Keep detecting while backgrounded / locked (needs setup on iOS — see below). |
| `sound` | `'silence'` | Ambient keep-alive sound: `'silence'`, `'whitenoise'`, or `'rain'` (see `.sounds`). |
| `soundVolume` | `0.3` | Volume of the ambient sound, `0..1` (ignored for `'silence'`). |
| `doublePressWindow` | `350` | Max ms between the two taps of a `double`. |
| `holdMs` | `500` | Min ms a press must be sustained to count as a `hold`. |
| `repeatGap` | `300` | Max ms between presses to treat them as one hold/auto-repeat run. |

These map onto the three "modes" older plugins expose:

| Old mode | Equivalent options |
|----------|--------------------|
| `aggressive` | `{ suppressIndicator: true, keepAtBaseline: true }` (the default) |
| `silent` | `{ suppressIndicator: false, keepAtBaseline: false }` — HUD shows, volume changes, presses still detected |
| `none` | remove your listeners — detection fully stops and native tears down |

### Volume control & misc

- **`getVolume()`** → `Promise<number>` — the current output volume, `0..1`.
- **`setVolume(level)`** → `Promise<void>` — set the output volume (`0..1`).
- **`isRunning()`** → `boolean` — whether detection is armed.
- **`sounds`** — the ambient sounds available: `['silence', 'whitenoise', 'rain']`.
- **`events`** — the array of event names accepted by `on`/`once`/`off`.

## Locked-screen & cold-start (iOS)

Two symptoms people hit with naïve volume-button plugins — both understood and
handled here:

**"It only works after I lock and unlock once."** A cold-start race: the audio
session isn't active at the first press, so the buttons adjust the *ringer*, not
the *media* volume, and `outputVolume` never changes. A lock/unlock cycle
re-activates the session and "repairs" it. **This plugin fixes it automatically**
by re-activating the session shortly after start (and on every app-active /
interruption-ended event), so detection works from the first press without a
lock/unlock dance.

**"When I just lock the screen, it stops."** Once locked, iOS suspends the app
and silences its audio — **unless** the app declares the **Audio background
mode**. That is the deciding factor, and it's opt-in:

1. Install with `--variable ENABLE_LOCKSCREEN=true` (a bundled hook adds
   `UIBackgroundModes → audio` to your app's `Info.plist`).
2. Pick an **audible** ambient sound so the entitlement is legitimate:
   ```js
   boogieVolumeButtons.configure({ sound: 'rain', soundVolume: 0.4 });
   ```

> **App Store note.** Declaring the Audio background mode while playing only
> *silent* audio is a known **Guideline 2.5.4** rejection risk (reviewers expect
> to hear something in the background). That's why it's opt-in, and why the
> plugin ships two genuinely audible, self-generated (royalty-free) ambient
> sounds — **`whitenoise`** and **`rain`** — so the background audio is real and
> defensible. Use `'silence'` only if you have another audible background
> purpose or accept the review risk. The chosen sound plays whenever detection is
> armed with `background: true`, so pick `'silence'` unless you actually want the
> ambient audio audible.

**Android** doesn't need the entitlement: the background volume-change broadcast
plus the looping ambient `MediaPlayer` keep detection alive when locked.

## How it works

- **iOS** — KVO on `AVAudioSession.outputVolume`; a hidden, off-screen
  `MPVolumeView` suppresses the HUD and provides the slider for the baseline
  snap-back; a looping ambient `AVAudioPlayer` (silence / white noise / rain)
  keeps the session active for background/locked detection. A delayed
  re-activation after start defeats the cold-start "ringer vs media" race.
- **Android** — a foreground `OnKeyListener` reads `KEYCODE_VOLUME_UP/DOWN`
  (consumed to suppress the change/HUD, and timed via key repeat/up for a precise
  hold); backgrounded/locked, a `VOLUME_CHANGED` broadcast receiver — kept alive
  by a looping ambient `MediaPlayer` — takes over and is ignored while
  foregrounded so presses never double-fire.
- **Browser** — no hardware volume keys are exposed to web pages, so the proxy
  **simulates** them from the keyboard: `ArrowUp` = up, `ArrowDown` = down
  (remappable). The same app code runs and is testable on the desktop.

## Behavior notes (read before shipping)

- **Test on a real device (iOS).** `MPVolumeView`-based volume changes — which
  the baseline snap-back relies on — **do not work on the iOS Simulator**.
- **Background costs battery.** Keeping audio alive to detect while backgrounded
  is a small drain. Set `background: false` for foreground-only.
- **Control Center / hardware slider drags** also change `outputVolume` on iOS,
  so they surface as `up`/`down` events. Use `delta`/`steps` to distinguish
  deliberate taps if needed.
- **Android background HUD** can't be suppressed in the broadcast path (the
  change already happened by the time the broadcast arrives); `keepAtBaseline`
  still keeps presses working.
- **Inferred holds** (iOS / browser / Android-background) can't tell a real hold
  from fast mashing, and their duration is approximate; only Android-foreground
  holds are exact.

## Hard limitations

- **No Audio background mode on iOS → no locked-screen detection.** If the app
  can't declare it (e.g. to avoid 2.5.4), locked detection is impossible on iOS —
  the app suspends. Foreground-only is the fallback.
- **The Simulator** won't detect (device-only).
- **At the exact 0/max edges without `keepAtBaseline`** a press produces no
  volume change and so no event — keep the snap-back on for reliable detection.

## Other physical buttons (iPhone)

Only the volume buttons are capturable as live in-app events:

- **Action Button (iPhone 15 Pro+)** — **not** capturable; user-configured in
  Settings (Shortcut / App Intents only), no live press event to an app.
- **Camera Control (iPhone 16)** — only via `AVCaptureEventInteraction`
  (iOS 17.2+) while an `AVCaptureSession` is active (camera apps). Not usable
  from a Cordova WebView.
- **Power button / ring-silent switch** — not capturable.

## Browser (development)

```js
// Defaults: ArrowUp = up, ArrowDown = down.
boogieVolumeButtons.configure({ keys: { up: ['w', 'ArrowUp'], down: ['s', 'ArrowDown'] } });
```

Holding a key produces the browser's keyboard auto-repeat, which the gesture
layer reads as a hold; two quick presses read as a double. `getVolume`/
`setVolume` track a simulated level starting at `0.5`.

## TypeScript

`index.d.ts` ships with the plugin and declares the `boogieVolumeButtons`
global; most setups pick it up automatically via the `types` field.

## Migrating from other volume-button plugins

```js
// benkesmith / manueldeveloper style:
VolumeButtons.onVolumeButtonPressed((dir) => { /* 'up' | 'down' */ });
window.addEventListener('volumebuttonslistener', (e) => { /* e.signal */ });

// here:
boogieVolumeButtons.on('volume', (e) => { /* e.direction */ });
```

Modes become options (see the table), you get double/hold gestures for free, and
`off(...)` (or removing the last listener) tears the native side down cleanly.

## Ideas / roadmap

- **Sequence recognition** — "up-up-down" as one gesture, built on `delta`.
- **Per-stream selection on Android** (`music`, `ring`, `alarm`, …).
- **Custom ambient sound** — point `sound` at an app-provided file.
- **Android foreground-service mode** for guaranteed long locked sessions.

Issues and PRs welcome.

## Tests

```
npm test
```

Runs on Node 18+ with the built-in `node:test` runner — no dev dependencies.
The suite unit-tests the JS bridge against a mocked `cordova/exec` (lazy
arm/disarm, event fan-out, live configuration, option clamping, sound/holdMs
passthrough, native hold routing, promise helpers, error routing), the gesture
engine (double detection, inferred holds, native holds, run separation), the
browser proxy against a faked `window` (keyboard presses, volume round-trip, key
remapping), and cross-checks `plugin.xml`, `package.json`, `index.d.ts`, and the
native sources for consistency (ids, versions, platforms, referenced files,
feature/service names, action coverage, bundled sounds).

## Layout

```
plugin.xml                     — Cordova manifest (android + ios + browser)
package.json                   — npm/cordova metadata, npm test
index.d.ts                     — TypeScript definitions for the boogieVolumeButtons global
www/volumebuttons.js           — the JS bridge (global: boogieVolumeButtons)
www/gestures.js                — double-press / hold gesture engine
src/android/VolumeButtonsPlugin.java — native Android (key listener + broadcast + ambient player)
src/ios/VolumeButtonsPlugin.{h,m}    — native iOS (outputVolume KVO + MPVolumeView + ambient player)
src/audio/{silence,whitenoise,rain}.mp3 — royalty-free ambient keep-alive sounds
src/browser/volumebuttons.js   — browser proxy (keyboard simulation)
hooks/enable_background_audio.js — opt-in iOS Audio background mode (ENABLE_LOCKSCREEN)
tests/                         — node:test suite (bridge + gestures + browser + structure)
```

The Java package is `hu.barthazi.volumebuttons`; the iOS class is
`VolumeButtonsPlugin`.

## License

MIT.
