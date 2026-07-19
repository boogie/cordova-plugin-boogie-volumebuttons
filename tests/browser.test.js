// Unit tests for the browser proxy against a faked window: keyboard-simulated
// volume presses, the volume getter/setter, and configurable keys.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const mock = require('./cordova-mock');

function makeWindow () {
    const handlers = {};
    global.window = {
        addEventListener (name, fn) {
            (handlers[name] = handlers[name] || []).push(fn);
        },
        removeEventListener (name, fn) {
            const list = handlers[name] || [];
            const idx = list.indexOf(fn);
            if (idx > -1) list.splice(idx, 1);
        }
    };
    return {
        press (key) {
            let prevented = false;
            const event = { key, preventDefault () { prevented = true; } };
            (handlers.keydown || []).slice(0).forEach((fn) => fn(event));
            return prevented;
        },
        count (name) {
            return (handlers[name] || []).length;
        }
    };
}

function cleanup () {
    delete global.window;
}

test('ArrowUp/ArrowDown emit direction events and move the simulated level', () => {
    const win = makeWindow();
    const proxy = mock.loadBrowserProxy();
    const events = [];
    proxy.start((e) => events.push(e), () => assert.fail('no error expected'), [{}]);

    assert.ok(win.press('ArrowUp'), 'the key is consumed');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].direction, 'up');
    assert.strictEqual(events[0].steps, 1);
    assert.ok(events[0].level > 0.5, 'level rose');

    win.press('ArrowDown');
    assert.strictEqual(events[1].direction, 'down');
    assert.ok(Math.abs(events[1].level - 0.5) < 1e-9, 'level back to baseline');

    // Unmapped keys are ignored.
    win.press('Enter');
    assert.strictEqual(events.length, 2);

    proxy.stop();
    assert.strictEqual(win.count('keydown'), 0, 'listener removed on stop');
    cleanup();
});

test('getVolume/setVolume round-trip the simulated level', () => {
    makeWindow();
    const proxy = mock.loadBrowserProxy();
    let level = null;
    proxy.getVolume((v) => { level = v; });
    assert.strictEqual(level, 0.5, 'default baseline');

    proxy.setVolume(() => {}, () => {}, [0.3]);
    proxy.getVolume((v) => { level = v; });
    assert.ok(Math.abs(level - 0.3) < 1e-9);
    cleanup();
});

test('configure() can remap the keys', () => {
    const win = makeWindow();
    const proxy = mock.loadBrowserProxy();
    const events = [];
    proxy.start((e) => events.push(e), () => {}, [{}]);
    proxy.configure(() => {}, () => {}, [{ keys: { up: ['w'], down: ['s'] } }]);

    win.press('w');
    win.press('ArrowUp'); // no longer mapped
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].direction, 'up');
    cleanup();
});

test('start reports the absence of a window', () => {
    cleanup(); // ensure no window
    const proxy = mock.loadBrowserProxy();
    let error = null;
    proxy.start(() => {}, (e) => { error = e; }, [{}]);
    assert.ok(error);
    assert.strictEqual(error.code, 1);
});

test('the proxy registers under the VolumeButtonsPlugin service', () => {
    makeWindow();
    mock.loadBrowserProxy();
    assert.strictEqual(mock.proxyRegistrations.length, 1);
    assert.strictEqual(mock.proxyRegistrations[0].service, 'VolumeButtonsPlugin');
    for (const action of ['start', 'stop', 'configure', 'getVolume', 'setVolume']) {
        assert.strictEqual(typeof mock.proxyRegistrations[0].impl[action], 'function', action);
    }
    cleanup();
});
