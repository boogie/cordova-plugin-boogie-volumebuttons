package hu.barthazi.volumebuttons;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.view.KeyEvent;
import android.view.View;

/**
 * Detects hardware volume Up/Down presses and streams them to JavaScript.
 *
 * Foreground: a key listener on the WebView reads the real KEYCODE_VOLUME_*
 * events; consuming them (suppressIndicator) both detects the press and stops
 * the volume from changing / the HUD from showing.
 *
 * Background / locked: key events don't reach a backgrounded activity, so a
 * VOLUME_CHANGED broadcast receiver takes over, kept alive by a silent
 * AudioTrack. The receiver ignores changes while foregrounded so a press is
 * never reported twice.
 *
 * No special permissions are required.
 */
public class VolumeButtonsPlugin extends CordovaPlugin {

    private static final String ACTION_VOLUME_CHANGED = "android.media.VOLUME_CHANGED_ACTION";
    private static final String EXTRA_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE";
    private static final String EXTRA_VOLUME_VALUE = "android.media.EXTRA_VOLUME_STREAM_VALUE";

    private AudioManager audioManager;
    private CallbackContext callback;
    private boolean running = false;
    private boolean inForeground = true;

    // Options.
    private boolean suppressIndicator = true;
    private boolean keepAtBaseline = true;
    private boolean background = true;
    private float baseline = 0.5f;

    private int baselineIndex;
    private int lastIndex;
    private long lastEventTime = -1;

    private AudioTrack silentTrack;
    private boolean receiverRegistered = false;
    private View keyView;

    private final BroadcastReceiver volumeReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!running || callback == null) return;
            if (!ACTION_VOLUME_CHANGED.equals(intent.getAction())) return;
            // The foreground key listener owns presses while we're on screen;
            // acting here too would report each press twice.
            if (inForeground) return;

            int streamType = intent.getIntExtra(EXTRA_STREAM_TYPE, -1);
            if (streamType != AudioManager.STREAM_MUSIC) return;

            int newVol = intent.getIntExtra(EXTRA_VOLUME_VALUE, -1);
            if (newVol < 0) return;

            // Ignore the broadcast our own snap-back triggers.
            if (keepAtBaseline && newVol == baselineIndex) {
                lastIndex = baselineIndex;
                return;
            }

            int diff = newVol - lastIndex;
            lastIndex = newVol;
            if (diff == 0) return;

            fireEvent(diff > 0 ? "up" : "down", Math.abs(diff), levelOf(newVol));

            if (keepAtBaseline) {
                resetToBaseline();
            }
        }
    };

    private final View.OnKeyListener keyListener = new View.OnKeyListener() {
        @Override
        public boolean onKey(View v, int keyCode, KeyEvent event) {
            if (!running || event.getAction() != KeyEvent.ACTION_DOWN) return false;
            if (keyCode != KeyEvent.KEYCODE_VOLUME_UP && keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) {
                return false;
            }

            boolean up = keyCode == KeyEvent.KEYCODE_VOLUME_UP;
            int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int current = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
            int projected = Math.max(0, Math.min(max, current + (up ? 1 : -1)));
            fireEvent(up ? "up" : "down", 1, (float) projected / max);

            // Consuming the event suppresses both the volume change and the HUD.
            return suppressIndicator;
        }
    };

    @Override
    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        Context context = cordova.getActivity().getApplicationContext();
        audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        switch (action) {
            case "start":
                start(args.optJSONObject(0), callbackContext);
                return true;
            case "stop":
                stop();
                callbackContext.success();
                return true;
            case "configure":
                configure(args.optJSONObject(0));
                callbackContext.success();
                return true;
            case "getVolume": {
                int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                int current = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, (float) current / max));
                return true;
            }
            case "setVolume":
                setVolume((float) args.optDouble(0, 0.5));
                callbackContext.success();
                return true;
            default:
                return false;
        }
    }

    private void start(JSONObject options, CallbackContext callbackContext) {
        applyOptions(options);
        callback = callbackContext;
        running = true;
        lastEventTime = -1;

        int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        baselineIndex = Math.round(baseline * max);
        lastIndex = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);

        cordova.getActivity().runOnUiThread(() -> {
            attachKeyListener();
            if (background) {
                registerReceiver();
                startSilentTrack();
            }
        });

        PluginResult keep = new PluginResult(PluginResult.Status.NO_RESULT);
        keep.setKeepCallback(true);
        callbackContext.sendPluginResult(keep);
    }

    private void stop() {
        running = false;
        cordova.getActivity().runOnUiThread(() -> {
            detachKeyListener();
            unregisterReceiver();
            stopSilentTrack();
        });
        callback = null;
        lastEventTime = -1;
    }

    private void configure(JSONObject options) {
        applyOptions(options);
        int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        baselineIndex = Math.round(baseline * max);
        if (!running) return;

        cordova.getActivity().runOnUiThread(() -> {
            if (background) {
                registerReceiver();
                startSilentTrack();
            } else {
                unregisterReceiver();
                stopSilentTrack();
            }
        });
    }

    private void applyOptions(JSONObject options) {
        if (options == null) return;
        suppressIndicator = options.optBoolean("suppressIndicator", suppressIndicator);
        keepAtBaseline = options.optBoolean("keepAtBaseline", keepAtBaseline);
        background = options.optBoolean("background", background);
        baseline = Math.max(0f, Math.min(1f, (float) options.optDouble("baseline", baseline)));
    }

    private void setVolume(float level) {
        int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int index = Math.max(0, Math.min(max, Math.round(level * max)));
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, index, 0);
        baselineIndex = index;
        lastIndex = index;
    }

    private float levelOf(int index) {
        int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        return max > 0 ? (float) index / max : 0f;
    }

    private void resetToBaseline() {
        try {
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, baselineIndex, 0);
            lastIndex = baselineIndex;
        } catch (SecurityException ignored) {
        }
    }

    // --- Key listener ---

    private void attachKeyListener() {
        if (keyView != null) return;
        keyView = webView.getView();
        keyView.setFocusableInTouchMode(true);
        keyView.requestFocus();
        keyView.setOnKeyListener(keyListener);
    }

    private void detachKeyListener() {
        if (keyView != null) {
            keyView.setOnKeyListener(null);
            keyView = null;
        }
    }

    // --- Broadcast receiver ---

    private void registerReceiver() {
        if (receiverRegistered) return;
        Context context = cordova.getActivity().getApplicationContext();
        IntentFilter filter = new IntentFilter(ACTION_VOLUME_CHANGED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(volumeReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            context.registerReceiver(volumeReceiver, filter);
        }
        receiverRegistered = true;
    }

    private void unregisterReceiver() {
        if (!receiverRegistered) return;
        try {
            cordova.getActivity().getApplicationContext().unregisterReceiver(volumeReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        receiverRegistered = false;
    }

    // --- Silent audio track (keeps the process receiving events in background) ---

    private void startSilentTrack() {
        if (silentTrack != null) return;
        try {
            int sampleRate = 44100;
            int bufferSize = AudioTrack.getMinBufferSize(sampleRate,
                    AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            AudioAttributes attributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();
            AudioFormat format = new AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build();
            silentTrack = new AudioTrack(attributes, format, bufferSize,
                    AudioTrack.MODE_STATIC, AudioManager.AUDIO_SESSION_ID_GENERATE);
            byte[] silence = new byte[bufferSize];
            silentTrack.write(silence, 0, silence.length);
            silentTrack.setLoopPoints(0, silence.length / 2, -1);
            silentTrack.play();
        } catch (Exception e) {
            silentTrack = null;
        }
    }

    private void stopSilentTrack() {
        if (silentTrack == null) return;
        try {
            silentTrack.stop();
            silentTrack.release();
        } catch (Exception ignored) {
        }
        silentTrack = null;
    }

    // --- Event dispatch ---

    private void fireEvent(String direction, int steps, float level) {
        if (callback == null) return;
        long now = System.currentTimeMillis();
        long delta = (lastEventTime < 0) ? 0 : (now - lastEventTime);
        lastEventTime = now;

        JSONObject payload = new JSONObject();
        try {
            payload.put("direction", direction);
            payload.put("steps", steps);
            payload.put("level", level);
            payload.put("delta", delta);
            payload.put("timestamp", now);
        } catch (JSONException e) {
            return;
        }
        PluginResult result = new PluginResult(PluginResult.Status.OK, payload);
        result.setKeepCallback(true);
        callback.sendPluginResult(result);
    }

    // --- Lifecycle ---

    @Override
    public void onPause(boolean multitasking) {
        inForeground = false;
    }

    @Override
    public void onResume(boolean multitasking) {
        inForeground = true;
        if (running) {
            // Re-sync so a change made while we were away isn't read as a giant jump.
            lastIndex = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        }
    }

    @Override
    public void onReset() {
        stop();
    }

    @Override
    public void onDestroy() {
        stop();
    }
}
