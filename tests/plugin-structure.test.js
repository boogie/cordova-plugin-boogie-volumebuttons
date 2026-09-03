// Consistency checks between plugin.xml, package.json, the JS bridge, index.d.ts,
// and the native sources — the things that silently break a Cordova plugin when
// they drift apart.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pluginXml = fs.readFileSync(path.join(root, 'plugin.xml'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bridgeJs = fs.readFileSync(path.join(root, 'www', 'volumebuttons.js'), 'utf8');

const pluginTag = pluginXml.match(/<plugin\b([^>]*)>/)[1];
const pluginId = pluginTag.match(/\bid="([^"]+)"/)[1];
const pluginVersion = pluginTag.match(/\bversion="([^"]+)"/)[1];

test('plugin id matches package.json name and cordova id', () => {
    assert.equal(pluginId, pkg.name);
    assert.equal(pluginId, pkg.cordova.id);
});

test('plugin.xml and package.json versions match', () => {
    assert.equal(pluginVersion, pkg.version);
});

test('the id and version literals in the bridge and every native half match plugin.xml', () => {
    const java = fs.readFileSync(path.join(root, 'src', 'android', 'VolumeButtonsPlugin.java'), 'utf8');
    const objc = fs.readFileSync(path.join(root, 'src', 'ios', 'VolumeButtonsPlugin.m'), 'utf8');
    const browser = fs.readFileSync(path.join(root, 'src', 'browser', 'volumebuttons.js'), 'utf8');

    assert.equal(bridgeJs.match(/var VERSION = '([^']+)'/)[1], pluginVersion, 'www/volumebuttons.js VERSION');
    assert.equal(browser.match(/var VERSION = '([^']+)'/)[1], pluginVersion, 'src/browser VERSION');
    assert.equal(java.match(/String VERSION = "([^"]+)"/)[1], pluginVersion, 'Android VERSION');
    assert.equal(objc.match(/kPluginVersion = @"([^"]+)"/)[1], pluginVersion, 'iOS kPluginVersion');

    assert.equal(bridgeJs.match(/var ID = '([^']+)'/)[1], pluginId, 'www/volumebuttons.js ID');
    assert.equal(browser.match(/var ID = '([^']+)'/)[1], pluginId, 'src/browser ID');
    assert.equal(java.match(/String PLUGIN_ID = "([^"]+)"/)[1], pluginId, 'Android PLUGIN_ID');
    assert.equal(objc.match(/kPluginId = @"([^"]+)"/)[1], pluginId, 'iOS kPluginId');
});

test('plugin.xml platforms match package.json cordova platforms', () => {
    const platforms = [...pluginXml.matchAll(/<platform name="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(platforms.sort(), [...pkg.cordova.platforms].sort());
});

test('every file referenced by plugin.xml exists', () => {
    const refs = [...pluginXml.matchAll(/<(?:js-module|source-file|header-file|resource-file)\s[^>]*src="([^"]+)"/g)]
        .map((m) => m[1]);
    assert.ok(refs.length >= 5, `expected at least 5 file references, got ${refs.length}`);
    for (const ref of refs) {
        assert.ok(fs.existsSync(path.join(root, ref)), `missing file referenced by plugin.xml: ${ref}`);
    }
});

test('native feature names match the SERVICE used by the JS bridge', () => {
    const service = bridgeJs.match(/var SERVICE = '([^']+)'/)[1];
    const features = [...pluginXml.matchAll(/<feature name="([^"]+)">/g)].map((m) => m[1]);
    assert.equal(features.length, 2, 'expected one <feature> per native platform');
    for (const feature of features) {
        assert.equal(feature, service);
    }
});

test('the browser proxy registers under the same SERVICE name', () => {
    const service = bridgeJs.match(/var SERVICE = '([^']+)'/)[1];
    const browserJs = fs.readFileSync(path.join(root, 'src', 'browser', 'volumebuttons.js'), 'utf8');
    assert.equal(browserJs.match(/proxy'\)\.add\('([^']+)'/)[1], service);
});

test('the JS module clobbers the boogieVolumeButtons global', () => {
    assert.equal(pluginXml.match(/<clobbers target="([^"]+)"/)[1], 'boogieVolumeButtons');
});

test('every platform implements the actions the JS bridge calls', () => {
    const java = fs.readFileSync(path.join(root, 'src', 'android', 'VolumeButtonsPlugin.java'), 'utf8');
    const objc = fs.readFileSync(path.join(root, 'src', 'ios', 'VolumeButtonsPlugin.m'), 'utf8');
    const browser = fs.readFileSync(path.join(root, 'src', 'browser', 'volumebuttons.js'), 'utf8');

    // Actions the bridge names literally — through exec(..., SERVICE, 'x', ...)
    // or execRaw('x', ...). The public exec() passthrough forwards an arbitrary
    // action name and is deliberately outside this closed set.
    const actions = new Set([...bridgeJs.matchAll(/(?:SERVICE, |execRaw\()'(\w+)'/g)].map((m) => m[1]));
    for (const expected of ['start', 'stop', 'configure', 'getVolume', 'setVolume', 'describe']) {
        assert.ok(actions.has(expected), `sanity: bridge should call ${expected}`);
    }

    for (const action of actions) {
        assert.ok(java.includes(`case "${action}"`), `Android is missing action: ${action}`);
        assert.ok(objc.includes(`- (void)${action}:`), `iOS is missing action: ${action}`);
        assert.ok(browser.includes(`${action}: function`), `browser proxy is missing action: ${action}`);
    }
});

test('describe is dispatched everywhere and each reported action list is complete and sorted', () => {
    const java = fs.readFileSync(path.join(root, 'src', 'android', 'VolumeButtonsPlugin.java'), 'utf8');
    const objc = fs.readFileSync(path.join(root, 'src', 'ios', 'VolumeButtonsPlugin.m'), 'utf8');
    const header = fs.readFileSync(path.join(root, 'src', 'ios', 'VolumeButtonsPlugin.h'), 'utf8');
    const browser = fs.readFileSync(path.join(root, 'src', 'browser', 'volumebuttons.js'), 'utf8');
    const unquote = (s) => s.replace(/[@'"]/g, '');

    // Android: the switch in execute() vs the ACTIONS constant describe reports.
    const javaCases = [...java.matchAll(/case "(\w+)":/g)].map((m) => m[1]);
    const javaActions = java.match(/String\[\] ACTIONS = \{([^}]+)\}/)[1].match(/"\w+"/g).map(unquote);
    assert.ok(javaCases.includes('describe'), 'Android must dispatch describe');
    assert.deepEqual(javaActions, [...javaCases].sort(), 'Android ACTIONS must list every case, sorted');

    // iOS: the command selectors the class implements vs the literal describe reports.
    const objcMethods = [...objc.matchAll(/^- \(void\)(\w+):\(CDVInvokedUrlCommand\*\)command/gm)].map((m) => m[1]);
    const objcActions = objc.match(/@"actions": @\[([^\]]+)\]/)[1].match(/@"\w+"/g).map(unquote);
    assert.ok(objcMethods.includes('describe'), 'iOS must dispatch describe');
    assert.deepEqual(objcActions, [...objcMethods].sort(), 'iOS actions must list every selector, sorted');
    for (const action of objcMethods) {
        assert.ok(header.includes(`- (void)${action}:`), `iOS header is missing: ${action}`);
    }

    // Browser: the proxy's methods vs the literal its describe reports.
    const browserMethods = [...browser.matchAll(/^\s{4}(\w+): function/gm)].map((m) => m[1]);
    const browserActions = browser.match(/actions: \[([^\]]+)\]/)[1].match(/'\w+'/g).map(unquote);
    assert.ok(browserMethods.includes('describe'), 'browser proxy must dispatch describe');
    assert.deepEqual(browserActions, [...browserMethods].sort(), 'browser actions must list every method, sorted');
});

test('index.d.ts declares every public bridge method and the global', () => {
    const dts = fs.readFileSync(path.join(root, 'index.d.ts'), 'utf8');
    const methods = [...bridgeJs.matchAll(/^\s{2,}(\w+): function/gm)].map((m) => m[1]);
    assert.ok(methods.length >= 8, `sanity: expected the full public API, got ${methods.length}`);
    for (const method of methods) {
        // Methods may be declared generic (on<K>(...)) or plain (getVolume(...)).
        const declared = dts.includes(`${method}(`) || dts.includes(`${method}<`);
        assert.ok(declared, `index.d.ts is missing: ${method}`);
    }
    assert.ok(dts.includes('declare var boogieVolumeButtons'), 'index.d.ts must declare the global');
    for (const constant of ['ID', 'VERSION', 'SERVICE']) {
        assert.ok(dts.includes(`readonly ${constant}: string`), `index.d.ts is missing the ${constant} constant`);
    }
});

test('every ambient sound the bridge exposes is bundled for both platforms and exists', () => {
    const sounds = [...bridgeJs.matchAll(/'(silence|whitenoise|rain)'/g)].map((m) => m[1]);
    const set = new Set(sounds);
    for (const sound of ['silence', 'whitenoise', 'rain']) {
        assert.ok(set.has(sound), `bridge should know the ${sound} sound`);
        assert.ok(fs.existsSync(path.join(root, 'src', 'audio', sound + '.mp3')), `${sound}.mp3 missing`);
        assert.ok(pluginXml.includes(`res/raw/${sound}.mp3`), `${sound}.mp3 not bundled for Android`);
        assert.ok(pluginXml.includes(`target="${sound}.mp3"`), `${sound}.mp3 not bundled for iOS`);
    }
});

test('the gesture module is shipped as a js-module', () => {
    assert.ok(pluginXml.includes('www/gestures.js'), 'gestures.js not declared in plugin.xml');
    assert.ok(fs.existsSync(path.join(root, 'www', 'gestures.js')), 'gestures.js missing');
});
