// Unit tests for the gesture engine: double-press detection, inferred holds
// (from an auto-repeat burst), and native precise holds.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

function loadEngine () {
    const p = path.join(__dirname, '..', 'www', 'gestures.js');
    delete require.cache[require.resolve(p)];
    return require(p);
}

function collector () {
    const events = [];
    return {
        dispatch: (type, ev) => events.push({ type, ev }),
        types: () => events.map((e) => e.type),
        find: (type) => (events.find((e) => e.type === type) || {}).ev
    };
}

function delay (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

test('a sustained auto-repeat run is reported as an inferred hold', () => {
    const g = loadEngine();
    const c = collector();
    const engine = g.create(c.dispatch, { holdMs: 100, repeatGap: 1000, doublePressWindow: 350 });

    engine.push({ direction: 'up', timestamp: 0 });
    engine.push({ direction: 'up', timestamp: 50 });
    engine.push({ direction: 'up', timestamp: 120 }); // 3rd press, span >= holdMs

    assert.ok(c.types().includes('hold'));
    assert.strictEqual(c.find('hold').source, 'inferred');
    assert.strictEqual(c.find('hold').direction, 'up');
    engine.reset(); // clear the pending finalize timer
});

test('native precise hold start/end pass straight through', () => {
    const g = loadEngine();
    const c = collector();
    const engine = g.create(c.dispatch, {});

    engine.holdStart({ direction: 'down', timestamp: 5 });
    engine.holdEnd({ direction: 'down', duration: 800, timestamp: 810 });

    assert.strictEqual(c.find('hold').source, 'native');
    assert.strictEqual(c.find('hold').direction, 'down');
    assert.strictEqual(c.find('holdend').duration, 800);
});

test('exactly two taps in the window fire double + doubleDirection', async () => {
    const g = loadEngine();
    const c = collector();
    const engine = g.create(c.dispatch, { holdMs: 500, repeatGap: 60, doublePressWindow: 350 });

    engine.push({ direction: 'up', timestamp: 0 });
    engine.push({ direction: 'up', timestamp: 40 });
    await delay(100); // let the run finalize

    assert.ok(c.types().includes('double'));
    assert.ok(c.types().includes('doubleup'));
    assert.strictEqual(c.find('double').direction, 'up');
});

test('a single tap fires no double', async () => {
    const g = loadEngine();
    const c = collector();
    const engine = g.create(c.dispatch, { holdMs: 500, repeatGap: 60, doublePressWindow: 350 });

    engine.push({ direction: 'up', timestamp: 0 });
    await delay(100);
    assert.ok(!c.types().includes('double'));
});

test('three rapid presses are a hold, not a double', async () => {
    const g = loadEngine();
    const c = collector();
    const engine = g.create(c.dispatch, { holdMs: 50, repeatGap: 60, doublePressWindow: 350 });

    engine.push({ direction: 'up', timestamp: 0 });
    engine.push({ direction: 'up', timestamp: 30 });
    engine.push({ direction: 'up', timestamp: 60 });
    await delay(100);

    assert.ok(c.types().includes('hold'));
    assert.ok(!c.types().includes('double'));
    assert.ok(c.types().includes('holdend'), 'the inferred hold ends when the run goes quiet');
});

test('reset() cancels a pending double so it never fires', async () => {
    const g = loadEngine();
    const c = collector();
    const engine = g.create(c.dispatch, { holdMs: 500, repeatGap: 60, doublePressWindow: 350 });

    engine.push({ direction: 'down', timestamp: 0 });
    engine.push({ direction: 'down', timestamp: 40 });
    engine.reset();
    await delay(100);
    assert.strictEqual(c.types().length, 0);
});
