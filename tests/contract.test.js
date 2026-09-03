// Unit tests for the bridge contract: describe() resolves the native envelope,
// the raw exec() escape hatch resolves / rejects / streams as specified, and
// the identity constants are exposed read-only.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const mock = require('./cordova-mock');
const pkg = require('../package.json');

// What a native half answers; the shape is what matters here.
const ENVELOPE = {
    id: 'cordova-plugin-boogie-volumebuttons',
    version: '1.1.0',
    platform: 'android',
    api: 1,
    actions: ['configure', 'describe', 'getVolume', 'setVolume', 'start', 'stop'],
    features: {
        background: true,
        lockedScreen: true,
        gestures: true,
        preciseHold: true,
        hudSuppression: true,
        baseline: true,
        ambientSounds: ['silence', 'whitenoise', 'rain']
    }
};

test('describe() calls the native describe with no arguments and resolves the envelope', async () => {
    const vb = mock.loadPlugin();
    const promise = vb.describe();

    const call = mock.lastCall('describe');
    assert.ok(call, 'exec was called');
    assert.strictEqual(call.service, 'VolumeButtonsPlugin');
    assert.deepStrictEqual(call.args, []);

    call.success(ENVELOPE);
    const info = await promise;
    assert.deepStrictEqual(info, ENVELOPE);
    for (const key of ['id', 'version', 'platform', 'api', 'actions', 'features']) {
        assert.ok(key in info, key);
    }
    assert.ok(info.actions.includes('describe'));
});

test('describe() neither arms detection nor counts as a listener', () => {
    const vb = mock.loadPlugin();
    vb.describe();
    assert.strictEqual(mock.lastCall('start'), null, 'nothing armed');
    assert.strictEqual(vb.isRunning(), false);
});

test('exec() passes the action and arguments straight through and resolves the first result', async () => {
    const vb = mock.loadPlugin();
    const args = [1, 'two', { three: 3 }];
    const promise = vb.exec('futureAction', args);

    const call = mock.lastCall('futureAction');
    assert.ok(call, 'exec was called');
    assert.strictEqual(call.service, vb.SERVICE);
    assert.strictEqual(call.args, args, 'arguments are forwarded as given, not copied or normalised');

    call.success('first');
    call.success('second');
    assert.strictEqual(await promise, 'first');
});

test('exec() defaults missing arguments to an empty array', () => {
    const vb = mock.loadPlugin();
    vb.exec('ping');
    assert.deepStrictEqual(mock.lastCall('ping').args, []);
});

test('exec() rejects with an Error carrying the native payload', async () => {
    const vb = mock.loadPlugin();

    let promise = vb.exec('boom');
    mock.lastCall('boom').error('plain string');
    await assert.rejects(promise, (e) => {
        assert.ok(e instanceof Error);
        assert.strictEqual(e.message, 'plain string');
        assert.strictEqual(e.native, 'plain string');
        return true;
    });

    promise = vb.exec('boom');
    const payload = { code: 7, message: 'with message' };
    mock.lastCall('boom').error(payload);
    await assert.rejects(promise, (e) => {
        assert.strictEqual(e.message, 'with message');
        assert.strictEqual(e.native, payload, 'the raw payload is kept by reference');
        return true;
    });

    promise = vb.exec('boom');
    mock.lastCall('boom').error({ code: 9 });
    await assert.rejects(promise, (e) => {
        assert.strictEqual(e.message, '{"code":9}', 'no message field: the JSON');
        assert.strictEqual(e.native.code, 9);
        return true;
    });
});

test('exec() streams every result to onProgress and settles with the first', async () => {
    const vb = mock.loadPlugin();
    const seen = [];
    const promise = vb.exec('stream', [], (r) => seen.push(r));

    const call = mock.lastCall('stream');
    call.success(1);
    call.success(2);
    call.success(3);

    assert.strictEqual(await promise, 1);
    assert.deepStrictEqual(seen, [1, 2, 3]);
});

test('a non-function onProgress is ignored', async () => {
    const vb = mock.loadPlugin();
    const promise = vb.exec('once', [], 'not a function');
    mock.lastCall('once').success('ok');
    assert.strictEqual(await promise, 'ok');
});

test('ID, VERSION and SERVICE are exposed read-only and agree with the manifest', () => {
    const vb = mock.loadPlugin();
    assert.strictEqual(vb.ID, pkg.name);
    assert.strictEqual(vb.VERSION, pkg.version);
    assert.strictEqual(vb.SERVICE, 'VolumeButtonsPlugin');

    assert.throws(() => { vb.ID = 'other'; }, TypeError);
    assert.throws(() => { vb.VERSION = '0.0.0'; }, TypeError);
    assert.throws(() => { vb.SERVICE = 'Other'; }, TypeError);
    assert.strictEqual(vb.ID, pkg.name, 'unchanged');
});
