// cordova-plugin-boogie-volumebuttons — JS bridge (global: boogieVolumeButtons).
//
// Turns hardware volume Up/Down presses into events on Android, iOS, and the
// browser. iOS exposes no public "button pressed" API, so the native side
// observes the audio-session output volume and — by default — hides the system
// volume HUD and snaps the level back to a mid baseline after each press;
// without that snap the volume sticks at 0 or 1 and further presses stop
// registering. Android reads the real key events in the foreground and a
// volume-change broadcast (kept alive by a looping ambient sound) while
// backgrounded or locked. The browser build maps keyboard keys so the same app
// code is testable on the desktop.
//
// Beyond the raw presses ('volume'/'up'/'down') a small gesture layer derives
// 'double' and 'hold'/'holdend' on top of the stream.
//
// Subscribing to a button/gesture event lazily arms native detection; removing
// the last listener disarms it, so the audio session and hidden volume view are
// never held without a consumer.

'use strict';

var exec = require('cordova/exec');
var gestures = require('./gestures');

var SERVICE = 'VolumeButtonsPlugin';

// Raw press events straight off the native stream...
var RAW_EVENTS = ['volume', 'up', 'down'];
// ...and gestures derived from that stream by the JS layer.
var GESTURE_EVENTS = ['double', 'doubleup', 'doubledown', 'hold', 'holdend'];
// Any of these, when subscribed, needs the native stream running.
var ARMING_EVENTS = RAW_EVENTS.concat(GESTURE_EVENTS);
// ...plus 'error', which reports a failure from the native detector.
var ALL_EVENTS = ARMING_EVENTS.concat(['error']);

var SOUNDS = ['silence', 'whitenoise', 'rain'];

var listeners = {}; // type -> array of callbacks
var running = false;

var options = {
    suppressIndicator: true, // hide the system volume HUD
    keepAtBaseline: true,    // snap the volume back to `baseline` after each press
    baseline: 0.5,           // 0..1, the level snapped back to (mid = headroom both ways)
    background: true,        // keep detecting while backgrounded / screen locked
    sound: 'silence',        // ambient sound kept looping to stay alive: SOUNDS
    soundVolume: 0.3         // 0..1, volume of the ambient sound (ignored for 'silence')
};

// JS-only gesture tuning (never sent to native).
var gestureOptions = {
    doublePressWindow: 350,
    holdMs: 500,
    repeatGap: 300
};

function clamp01 (value, fallback) {
    value = Number(value);
    if (!isFinite(value)) return fallback;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function dispatch (type, event) {
    var list = listeners[type];
    if (!list || !list.length) return;
    list.slice(0).forEach(function (fn) {
        try {
            fn(event);
        } catch (e) {
            if (typeof console !== 'undefined' && console.error) {
                console.error('boogieVolumeButtons: "' + type + '" listener threw', e);
            }
        }
    });
}

var engine = gestures.create(dispatch, gestureOptions);

function hasButtonListener () {
    return ARMING_EVENTS.some(function (type) {
        return listeners[type] && listeners[type].length > 0;
    });
}

// One native message is either a raw press or a precise hold marker (Android).
function onVolumeEvent (event) {
    if (event && event.gesture === 'holdstart') {
        engine.holdStart(event);
        return;
    }
    if (event && event.gesture === 'holdend') {
        engine.holdEnd(event);
        return;
    }
    dispatch('volume', event);
    if (event && (event.direction === 'up' || event.direction === 'down')) {
        dispatch(event.direction, event);
    }
    engine.push(event);
}

function onError (error) {
    dispatch('error', {
        code: (error && error.code) || 0,
        message: (error && error.message) || String(error)
    });
}

function nativeOptions () {
    return {
        suppressIndicator: !!options.suppressIndicator,
        keepAtBaseline: !!options.keepAtBaseline,
        baseline: clamp01(options.baseline, 0.5),
        background: !!options.background,
        sound: SOUNDS.indexOf(options.sound) > -1 ? options.sound : 'silence',
        soundVolume: clamp01(options.soundVolume, 0.3),
        // Sent so Android can time its precise (key up/down) hold detection;
        // iOS/browser infer holds in the JS gesture layer instead.
        holdMs: gestureOptions.holdMs
    };
}

// Arm/disarm native detection to match the current listener set.
function syncDetection () {
    var need = hasButtonListener();
    if (need && !running) {
        running = true;
        exec(onVolumeEvent, onError, SERVICE, 'start', [nativeOptions()]);
    } else if (!need && running) {
        running = false;
        engine.reset();
        exec(null, null, SERVICE, 'stop', []);
    }
}

function assertType (type) {
    if (ALL_EVENTS.indexOf(type) === -1) {
        throw new Error('boogieVolumeButtons: unknown event "' + type +
            '". Known events: ' + ALL_EVENTS.join(', '));
    }
}

var boogieVolumeButtons = {
    /**
     * Subscribes to an event. The first button/gesture subscriber arms native
     * detection. Returns an unsubscribe function for this exact subscription.
     *
     * Events:
     *   'volume' — any press: { direction:'up'|'down', steps, level, delta, timestamp }
     *   'up' / 'down' — the same payload, filtered by direction
     *   'double' / 'doubleup' / 'doubledown' — two same-direction taps in a window
     *   'hold' — a sustained press begins: { direction, duration, source, timestamp }
     *   'holdend' — a sustained press ends: { direction, duration, timestamp }
     *   'error' — { code, message }
     */
    on: function (type, callback) {
        assertType(type);
        if (typeof callback !== 'function') {
            throw new TypeError('boogieVolumeButtons.on: callback must be a function');
        }
        (listeners[type] = listeners[type] || []).push(callback);
        syncDetection();
        return function () {
            boogieVolumeButtons.off(type, callback);
        };
    },

    /** Subscribes for a single event, then auto-unsubscribes. */
    once: function (type, callback) {
        var off = boogieVolumeButtons.on(type, function (event) {
            off();
            callback(event);
        });
        return off;
    },

    /**
     * Removes a subscription. Without a callback, removes every listener of the
     * given type. The last removal disarms native detection.
     */
    off: function (type, callback) {
        assertType(type);
        var list = listeners[type];
        if (!list) return;
        if (callback) {
            var idx = list.indexOf(callback);
            if (idx > -1) list.splice(idx, 1);
        } else {
            list.length = 0;
        }
        syncDetection();
    },

    /**
     * Merges options over the current ones. Detection options are applied live
     * (native) while running; gesture options tune the JS layer immediately.
     *
     * @param {Object} opts { suppressIndicator, keepAtBaseline, baseline,
     *   background, sound, soundVolume, doublePressWindow, holdMs, repeatGap }
     * @returns {Object} the resulting options
     */
    configure: function (opts) {
        opts = opts || {};
        if ('suppressIndicator' in opts) options.suppressIndicator = !!opts.suppressIndicator;
        if ('keepAtBaseline' in opts) options.keepAtBaseline = !!opts.keepAtBaseline;
        if ('baseline' in opts) options.baseline = clamp01(opts.baseline, options.baseline);
        if ('background' in opts) options.background = !!opts.background;
        if ('sound' in opts && SOUNDS.indexOf(opts.sound) > -1) options.sound = opts.sound;
        if ('soundVolume' in opts) options.soundVolume = clamp01(opts.soundVolume, options.soundVolume);

        if ('doublePressWindow' in opts) gestureOptions.doublePressWindow = Number(opts.doublePressWindow);
        if ('holdMs' in opts) gestureOptions.holdMs = Number(opts.holdMs);
        if ('repeatGap' in opts) gestureOptions.repeatGap = Number(opts.repeatGap);
        engine.setOptions(gestureOptions);

        if (running) {
            exec(null, onError, SERVICE, 'configure', [nativeOptions()]);
        }
        return this.getOptions();
    },

    /** Returns a copy of the current options (detection + gestures). */
    getOptions: function () {
        return {
            suppressIndicator: options.suppressIndicator,
            keepAtBaseline: options.keepAtBaseline,
            baseline: options.baseline,
            background: options.background,
            sound: options.sound,
            soundVolume: options.soundVolume,
            doublePressWindow: gestureOptions.doublePressWindow,
            holdMs: gestureOptions.holdMs,
            repeatGap: gestureOptions.repeatGap
        };
    },

    /** The ambient sounds that can be looped to stay alive in the background. */
    sounds: SOUNDS.slice(),

    /** Resolves the current output volume as a number in 0..1. */
    getVolume: function () {
        return new Promise(function (resolve, reject) {
            exec(function (value) { resolve(Number(value)); }, reject, SERVICE, 'getVolume', []);
        });
    },

    /** Sets the output volume (0..1). Resolves once applied. */
    setVolume: function (level) {
        var value = clamp01(level, 0.5);
        return new Promise(function (resolve, reject) {
            exec(function () { resolve(); }, reject, SERVICE, 'setVolume', [value]);
        });
    },

    /** Whether native detection is currently armed. Synchronous. */
    isRunning: function () {
        return running;
    },

    /** Event names accepted by on/once/off. */
    events: ALL_EVENTS.slice()
};

module.exports = boogieVolumeButtons;
