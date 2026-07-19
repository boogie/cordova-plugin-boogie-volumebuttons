// after_plugin_install (iOS): opt-in enabler for locked-screen detection.
//
// Locked-screen volume detection needs the host app to run in the background,
// which on iOS means declaring the Audio background mode
// (UIBackgroundModes → audio) in Info.plist. That is off by default because
// declaring background audio for *silent* audio is an App Store 2.5.4 rejection
// risk — so it is only applied when the plugin is installed with
// `--variable ENABLE_LOCKSCREEN=true` (ideally alongside an audible sound).
//
// This hook never throws: a failure just leaves the app foreground-only.

'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
    try {
        if (!isEnabled(context)) {
            return;
        }
        const plistPath = findInfoPlist();
        if (!plistPath) {
            console.warn('[boogie-volumebuttons] ENABLE_LOCKSCREEN set but no iOS Info.plist found yet.');
            return;
        }
        if (addAudioBackgroundMode(plistPath)) {
            console.log('[boogie-volumebuttons] Enabled the Audio background mode for locked-screen detection.');
        }
    } catch (e) {
        console.warn('[boogie-volumebuttons] Could not enable locked-screen mode: ' + (e && e.message));
    }
};

// Reads ENABLE_LOCKSCREEN from every place Cordova might surface it.
function isEnabled(context) {
    const truthy = (v) => String(v).toLowerCase() === 'true';

    if (process.env.ENABLE_LOCKSCREEN && truthy(process.env.ENABLE_LOCKSCREEN)) return true;

    const opts = (context && context.opts) || {};
    const plugin = opts.plugin || {};
    const varBags = [plugin.vars, plugin.variables, opts.cli_variables, opts.variables];
    for (const bag of varBags) {
        if (bag && bag.ENABLE_LOCKSCREEN != null && truthy(bag.ENABLE_LOCKSCREEN)) return true;
    }

    // Fall back to the value Cordova records in the project config.xml.
    try {
        const cfg = fs.readFileSync(path.join(process.cwd(), 'config.xml'), 'utf8');
        const m = cfg.match(/name=["']ENABLE_LOCKSCREEN["']\s+value=["']([^"']+)["']/i);
        if (m && truthy(m[1])) return true;
    } catch (e) { /* no config.xml — ignore */ }

    return false;
}

// platforms/ios/<AppName>/<AppName>-Info.plist
function findInfoPlist() {
    const iosDir = path.join(process.cwd(), 'platforms', 'ios');
    if (!fs.existsSync(iosDir)) return null;
    for (const entry of fs.readdirSync(iosDir)) {
        const dir = path.join(iosDir, entry);
        if (!fs.statSync(dir).isDirectory()) continue;
        const candidate = path.join(dir, entry + '-Info.plist');
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

// Adds "audio" to UIBackgroundModes, using the `plist` module when available
// (a cordova-ios dependency) and a minimal text insert otherwise. Idempotent.
function addAudioBackgroundMode(plistPath) {
    let plist = null;
    try { plist = require('plist'); } catch (e) { /* fall through to text mode */ }

    const raw = fs.readFileSync(plistPath, 'utf8');

    if (plist) {
        const data = plist.parse(raw) || {};
        const modes = Array.isArray(data.UIBackgroundModes) ? data.UIBackgroundModes : [];
        if (modes.indexOf('audio') !== -1) return false;
        modes.push('audio');
        data.UIBackgroundModes = modes;
        fs.writeFileSync(plistPath, plist.build(data), 'utf8');
        return true;
    }

    // Text fallback.
    if (/<key>UIBackgroundModes<\/key>/.test(raw)) {
        if (/<string>audio<\/string>/.test(raw)) return false;
        const patched = raw.replace(
            /(<key>UIBackgroundModes<\/key>\s*<array>)/,
            '$1\n\t\t<string>audio</string>'
        );
        fs.writeFileSync(plistPath, patched, 'utf8');
        return true;
    }
    const patched = raw.replace(
        /(<\/dict>\s*<\/plist>)/,
        '\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>audio</string>\n\t</array>\n$1'
    );
    fs.writeFileSync(plistPath, patched, 'utf8');
    return true;
}
