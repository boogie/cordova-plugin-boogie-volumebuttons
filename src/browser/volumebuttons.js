// cordova-plugin-boogie-volumebuttons — browser implementation.
//
// Web pages cannot read the device's hardware volume keys (browsers don't
// expose them), so this proxy simulates them from the keyboard: ArrowUp = up,
// ArrowDown = down by default. That keeps the same app code runnable — and
// testable — on the desktop. Configure the keys with
// boogieVolumeButtons.configure({ keys: { up: [...], down: [...] } }).

var ID = 'cordova-plugin-boogie-volumebuttons';
var VERSION = '1.1.0'; // keep in sync with plugin.xml (the structure test checks)

var STEP = 1 / 16; // mirrors a typical device volume increment

var eventCallback = null;   // the streaming success callback while running
var keyHandler = null;
var level = 0.5;            // simulated output volume
var lastEventTime = -1;
var upKeys = ['ArrowUp'];
var downKeys = ['ArrowDown'];

function clamp01(value, fallback) {
    value = Number(value);
    if (!isFinite(value)) return fallback;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function applyKeyOptions(options) {
    if (options && options.keys) {
        if (Array.isArray(options.keys.up)) upKeys = options.keys.up.slice();
        if (Array.isArray(options.keys.down)) downKeys = options.keys.down.slice();
    }
    if (options && typeof options.baseline === 'number') {
        level = clamp01(options.baseline, level);
    }
}

function emit(direction) {
    if (!eventCallback) return;
    if (direction === 'up') level = clamp01(level + STEP, level);
    else level = clamp01(level - STEP, level);

    var now = Date.now();
    var delta = lastEventTime < 0 ? 0 : now - lastEventTime;
    lastEventTime = now;

    eventCallback({
        direction: direction,
        steps: 1,
        level: level,
        delta: delta,
        timestamp: now
    });
}

module.exports = {
    start: function (success, error, args) {
        applyKeyOptions(args && args[0]);
        eventCallback = success;

        if (typeof window === 'undefined' || !window.addEventListener) {
            if (error) error({ code: 1, message: 'No window to attach key listeners to.' });
            return;
        }

        keyHandler = function (e) {
            var key = e.key;
            if (upKeys.indexOf(key) > -1) {
                e.preventDefault();
                emit('up');
            } else if (downKeys.indexOf(key) > -1) {
                e.preventDefault();
                emit('down');
            }
        };
        window.addEventListener('keydown', keyHandler, false);
    },

    stop: function (success) {
        if (keyHandler && typeof window !== 'undefined' && window.removeEventListener) {
            window.removeEventListener('keydown', keyHandler, false);
        }
        keyHandler = null;
        eventCallback = null;
        lastEventTime = -1;
        if (success) success();
    },

    configure: function (success, error, args) {
        applyKeyOptions(args && args[0]);
        if (success) success();
    },

    getVolume: function (success) {
        success(level);
    },

    setVolume: function (success, error, args) {
        level = clamp01(args && args[0], level);
        if (success) success();
    },

    // Bridge contract v1: what this half is and can do — static facts only,
    // never fails. `actions` lists every method above, sorted.
    describe: function (success) {
        success({
            id: ID,
            version: VERSION,
            platform: 'browser',
            api: 1,
            actions: ['configure', 'describe', 'getVolume', 'setVolume', 'start', 'stop'],
            features: {
                background: false,   // keyboard events only reach a focused page
                lockedScreen: false,
                gestures: true,      // inferred by the JS layer from key auto-repeat
                preciseHold: false,
                hudSuppression: false,
                baseline: false,     // the simulated level moves freely
                ambientSounds: []    // nothing is played
            }
        });
    }
};

require('cordova/exec/proxy').add('VolumeButtonsPlugin', module.exports);
