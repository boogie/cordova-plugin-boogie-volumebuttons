// Derives higher-level gestures from the raw volume-press stream:
//   - 'double' (+ 'doubleup' / 'doubledown') — two same-direction taps within a
//     short window.
//   - 'hold' / 'holdend' — a sustained press. On Android (foreground) the native
//     side reports precise start/end from real key down/up; everywhere else it
//     is inferred from the auto-repeat burst the OS emits while a button is held.
//
// Same-direction presses that arrive within `repeatGap` are batched into a
// "run": 1 press is a tap, exactly 2 is a double, 3+ is a hold (auto-repeat).
// A run is finalized once it goes quiet for `repeatGap`, which is what lets a
// double be told apart from the start of a hold.

'use strict';

function create (dispatch, options) {
    var opts = {
        doublePressWindow: 350, // max ms between the two taps of a double
        holdMs: 500,            // min ms a run must span to count as a hold
        repeatGap: 300          // max ms between presses to stay in one run
    };

    var run = null;   // { direction, startTs, lastTs, count, held }
    var timer = null; // fires when the current run goes quiet

    function setOptions (o) {
        if (!o) return;
        if (typeof o.doublePressWindow === 'number') opts.doublePressWindow = o.doublePressWindow;
        if (typeof o.holdMs === 'number') opts.holdMs = o.holdMs;
        if (typeof o.repeatGap === 'number') opts.repeatGap = o.repeatGap;
    }
    setOptions(options);

    function clearTimer () {
        if (timer) { clearTimeout(timer); timer = null; }
    }

    // A run ended: emit its trailing gesture (holdend for a finished inferred
    // hold, or double for exactly two taps in the window).
    function finalize () {
        clearTimer();
        if (!run) return;
        var r = run;
        run = null;
        if (r.held) {
            dispatch('holdend', {
                direction: r.direction,
                duration: r.lastTs - r.startTs,
                timestamp: r.lastTs
            });
        } else if (r.count === 2 && (r.lastTs - r.startTs) <= opts.doublePressWindow) {
            var payload = { direction: r.direction, timestamp: r.lastTs };
            dispatch('double', payload);
            dispatch('double' + r.direction, payload);
        }
    }

    function armTimer () {
        clearTimer();
        timer = setTimeout(finalize, opts.repeatGap);
    }

    return {
        // Feed a raw press event: { direction, ..., timestamp }.
        push: function (event) {
            var ts = event.timestamp;
            if (run && run.direction === event.direction && (ts - run.lastTs) <= opts.repeatGap) {
                run.count += 1;
                run.lastTs = ts;
            } else {
                finalize();
                run = { direction: event.direction, startTs: ts, lastTs: ts, count: 1, held: false };
            }
            // Inferred hold onset: a sustained run of auto-repeats.
            if (!run.held && run.count >= 3 && (ts - run.startTs) >= opts.holdMs) {
                run.held = true;
                dispatch('hold', {
                    direction: run.direction,
                    duration: ts - run.startTs,
                    source: 'inferred',
                    timestamp: ts
                });
            }
            armTimer();
        },

        // Native (Android foreground) precise hold onset.
        holdStart: function (event) {
            finalize();
            run = {
                direction: event.direction,
                startTs: event.timestamp,
                lastTs: event.timestamp,
                count: 3,
                held: true
            };
            clearTimer();
            dispatch('hold', {
                direction: event.direction,
                duration: 0,
                source: 'native',
                timestamp: event.timestamp
            });
        },

        // Native (Android foreground) precise hold end, with exact duration.
        holdEnd: function (event) {
            clearTimer();
            if (run && run.held) {
                run = null;
                dispatch('holdend', {
                    direction: event.direction,
                    duration: event.duration,
                    timestamp: event.timestamp
                });
            }
        },

        reset: function () {
            clearTimer();
            run = null;
        },

        setOptions: setOptions
    };
}

module.exports = { create: create };
