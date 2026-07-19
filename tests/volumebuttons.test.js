// Unit tests for the JS bridge: listener lifecycle, lazy arm/disarm, event
// fan-out, promise helpers, configuration, and error routing.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const mock = require('./cordova-mock');

function countCalls (action) {
    return mock.calls.filter((c) => c.action === action).length;
}

// What the bridge sends to native on start/configure.
const NATIVE_DEFAULTS = {
    suppressIndicator: true,
    keepAtBaseline: true,
    baseline: 0.5,
    background: true,
    sound: 'silence',
    soundVolume: 0.3,
    holdMs: 500
};

// What getOptions() reports (detection + JS gesture tuning).
const FULL_OPTIONS = {
    suppressIndicator: true,
    keepAtBaseline: true,
    baseline: 0.5,
    background: true,
    sound: 'silence',
    soundVolume: 0.3,
    doublePressWindow: 350,
    holdMs: 500,
    repeatGap: 300
};

test('the first button listener arms detection, the last removal disarms it', () => {
    const vb = mock.loadPlugin();
    const offA = vb.on('volume', () => {});
    const offB = vb.on('up', () => {});

    assert.strictEqual(countCalls('start'), 1, 'armed once for both listeners');
    assert.strictEqual(mock.lastCall('start').service, 'VolumeButtonsPlugin');
    assert.deepStrictEqual(mock.lastCall('start').args, [NATIVE_DEFAULTS]);

    offA();
    assert.strictEqual(countCalls('stop'), 0, 'a listener remains');
    offB();
    assert.strictEqual(countCalls('stop'), 1, 'disarmed with the last removal');
});

test('a gesture listener also arms detection', () => {
    const vb = mock.loadPlugin();
    vb.on('double', () => {});
    assert.strictEqual(countCalls('start'), 1);
    vb.on('hold', () => {});
    assert.strictEqual(countCalls('start'), 1, 'still armed once');
});

test('a native event fans out to "volume" and the direction-specific event', () => {
    const vb = mock.loadPlugin();
    const all = [];
    const ups = [];
    const downs = [];
    vb.on('volume', (e) => all.push(e));
    vb.on('up', (e) => ups.push(e));
    vb.on('down', (e) => downs.push(e));

    const native = mock.lastCall('start');
    native.success({ direction: 'up', steps: 1, level: 0.5625, delta: 0, timestamp: 1 });
    native.success({ direction: 'down', steps: 2, level: 0.4375, delta: 120, timestamp: 2 });

    assert.strictEqual(all.length, 2);
    assert.strictEqual(ups.length, 1);
    assert.strictEqual(downs.length, 1);
    assert.strictEqual(ups[0].steps, 1);
    assert.strictEqual(downs[0].steps, 2);
    assert.strictEqual(downs[0].delta, 120);
});

test('once() delivers a single event and disarms detection', () => {
    const vb = mock.loadPlugin();
    let got = 0;
    vb.once('volume', () => got++);
    const native = mock.lastCall('start');
    native.success({ direction: 'up', steps: 1, level: 0.5, delta: 0, timestamp: 1 });
    native.success({ direction: 'up', steps: 1, level: 0.5, delta: 5, timestamp: 2 });
    assert.strictEqual(got, 1);
    assert.strictEqual(countCalls('stop'), 1);
});

test('on() rejects unknown events and non-function callbacks', () => {
    const vb = mock.loadPlugin();
    assert.throws(() => vb.on('press', () => {}), /unknown event/);
    assert.throws(() => vb.on('volume', 42), /must be a function/);
    assert.strictEqual(mock.calls.length, 0, 'nothing armed');
});

test('configure() applies live while running and merges/clamps otherwise', () => {
    const vb = mock.loadPlugin();
    vb.on('volume', () => {});

    const result = vb.configure({ baseline: 2, suppressIndicator: false });
    assert.strictEqual(result.baseline, 1, 'baseline clamped to 0..1');
    assert.strictEqual(result.suppressIndicator, false);
    assert.strictEqual(countCalls('configure'), 1);
    assert.deepStrictEqual(mock.lastCall('configure').args, [{
        suppressIndicator: false,
        keepAtBaseline: true,
        baseline: 1,
        background: true,
        sound: 'silence',
        soundVolume: 0.3,
        holdMs: 500
    }]);

    // Not running: remembered only, no exec traffic, applied to the next start.
    vb.off('volume');
    const before = mock.calls.length;
    vb.configure({ background: false });
    assert.strictEqual(mock.calls.length, before, 'no exec while disarmed');
    vb.on('volume', () => {});
    assert.strictEqual(mock.lastCall('start').args[0].background, false);
    assert.strictEqual(mock.lastCall('start').args[0].baseline, 1);
});

test('configure() carries the ambient sound and clamps soundVolume', () => {
    const vb = mock.loadPlugin();
    vb.on('volume', () => {});
    const result = vb.configure({ sound: 'rain', soundVolume: 5 });
    assert.strictEqual(result.sound, 'rain');
    assert.strictEqual(result.soundVolume, 1);
    assert.strictEqual(mock.lastCall('configure').args[0].sound, 'rain');
    assert.strictEqual(mock.lastCall('configure').args[0].soundVolume, 1);

    // Unknown sounds are ignored.
    vb.configure({ sound: 'thunder' });
    assert.strictEqual(vb.getOptions().sound, 'rain');
    assert.deepStrictEqual(vb.sounds, ['silence', 'whitenoise', 'rain']);
});

test('holdMs tunes both the gesture layer and the native option', () => {
    const vb = mock.loadPlugin();
    vb.on('volume', () => {});
    vb.configure({ holdMs: 800 });
    assert.strictEqual(vb.getOptions().holdMs, 800);
    assert.strictEqual(mock.lastCall('configure').args[0].holdMs, 800);
});

test('native precise hold gestures are routed to hold/holdend', () => {
    const vb = mock.loadPlugin();
    const holds = [];
    const ends = [];
    vb.on('hold', (e) => holds.push(e));
    vb.on('holdend', (e) => ends.push(e));

    const native = mock.lastCall('start');
    native.success({ gesture: 'holdstart', direction: 'up', duration: 0, timestamp: 1 });
    native.success({ gesture: 'holdend', direction: 'up', duration: 900, timestamp: 2 });

    assert.strictEqual(holds.length, 1);
    assert.strictEqual(holds[0].source, 'native');
    assert.strictEqual(ends.length, 1);
    assert.strictEqual(ends[0].duration, 900);
});

test('getVolume resolves the native value', async () => {
    const vb = mock.loadPlugin();
    const promise = vb.getVolume();
    mock.lastCall('getVolume').success(0.42);
    assert.strictEqual(await promise, 0.42);
});

test('setVolume clamps and resolves once applied', async () => {
    const vb = mock.loadPlugin();
    const promise = vb.setVolume(1.7);
    assert.deepStrictEqual(mock.lastCall('setVolume').args, [1]);
    mock.lastCall('setVolume').success();
    await promise;
});

test('native errors are dispatched to error listeners', () => {
    const vb = mock.loadPlugin();
    const errors = [];
    vb.on('error', (e) => errors.push(e));
    vb.on('volume', () => {});
    mock.lastCall('start').error({ code: 2, message: 'boom' });
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 2);
    assert.strictEqual(errors[0].message, 'boom');
});

test('isRunning reflects the armed state', () => {
    const vb = mock.loadPlugin();
    assert.strictEqual(vb.isRunning(), false);
    const off = vb.on('volume', () => {});
    assert.strictEqual(vb.isRunning(), true);
    off();
    assert.strictEqual(vb.isRunning(), false);
});

test('a throwing listener does not break the others', () => {
    const vb = mock.loadPlugin();
    const seen = [];
    vb.on('volume', () => { throw new Error('boom'); });
    vb.on('volume', (e) => seen.push(e));
    mock.lastCall('start').success({ direction: 'up', steps: 1, level: 0.5, delta: 0, timestamp: 1 });
    assert.strictEqual(seen.length, 1);
});

test('events list and getOptions expose stable copies', () => {
    const vb = mock.loadPlugin();
    assert.ok(Array.isArray(vb.events));
    for (const required of ['volume', 'up', 'down', 'double', 'doubleup', 'doubledown',
        'hold', 'holdend', 'error']) {
        assert.ok(vb.events.includes(required), required);
    }
    assert.deepStrictEqual(vb.getOptions(), FULL_OPTIONS);
    vb.getOptions().baseline = 0; // mutating the copy must not leak
    assert.strictEqual(vb.getOptions().baseline, 0.5);
});
