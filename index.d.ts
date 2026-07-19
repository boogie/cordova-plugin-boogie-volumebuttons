// TypeScript definitions for cordova-plugin-boogie-volumebuttons.
// The plugin clobbers a `boogieVolumeButtons` global.

interface BoogieVolumeButtonsEvent {
    /** Which button was pressed. */
    direction: 'up' | 'down';
    /** How many volume increments the press represented (>=1; usually 1). */
    steps: number;
    /** Output volume the press reached, 0..1 (before any baseline snap-back). */
    level: number;
    /** Milliseconds since the previous volume event (0 for the first). */
    delta: number;
    /** ms since epoch. */
    timestamp: number;
}

interface BoogieVolumeButtonsDoubleEvent {
    direction: 'up' | 'down';
    timestamp: number;
}

interface BoogieVolumeButtonsHoldEvent {
    direction: 'up' | 'down';
    /** ms held so far (hold) or in total (holdend). `hold` is 0 for native start. */
    duration: number;
    /** 'native' = precise (Android foreground key up/down); 'inferred' = from auto-repeat. */
    source?: 'native' | 'inferred';
    timestamp: number;
}

interface BoogieVolumeButtonsErrorEvent {
    code: number;
    message: string;
}

interface BoogieVolumeButtonsEventMap {
    volume: BoogieVolumeButtonsEvent;
    up: BoogieVolumeButtonsEvent;
    down: BoogieVolumeButtonsEvent;
    double: BoogieVolumeButtonsDoubleEvent;
    doubleup: BoogieVolumeButtonsDoubleEvent;
    doubledown: BoogieVolumeButtonsDoubleEvent;
    hold: BoogieVolumeButtonsHoldEvent;
    holdend: BoogieVolumeButtonsHoldEvent;
    error: BoogieVolumeButtonsErrorEvent;
}

type BoogieVolumeButtonsSound = 'silence' | 'whitenoise' | 'rain';

interface BoogieVolumeButtonsOptions {
    /**
     * Hide the system volume HUD. iOS: a hidden MPVolumeView swallows the
     * overlay; Android (foreground): the key event is consumed. Default true.
     */
    suppressIndicator?: boolean;
    /**
     * Snap the volume back to `baseline` after each press, so presses keep
     * firing at the 0/max edges and the real volume does not drift. Default true.
     */
    keepAtBaseline?: boolean;
    /** Level to snap back to when keepAtBaseline is on, 0..1. Default 0.5. */
    baseline?: number;
    /**
     * Keep detecting while backgrounded or the screen is locked. On iOS this
     * needs the host app to enable the Audio background mode — see the README.
     * Default true.
     */
    background?: boolean;
    /**
     * The ambient sound looped to keep the app alive in the background. An
     * audible sound ('whitenoise'/'rain') makes the iOS Audio background mode
     * App-Store-defensible; 'silence' is inaudible but riskier to justify.
     * Default 'silence'.
     */
    sound?: BoogieVolumeButtonsSound;
    /** Volume of the ambient sound, 0..1 (ignored for 'silence'). Default 0.3. */
    soundVolume?: number;
    /** Max ms between the two taps of a `double`. Default 350. */
    doublePressWindow?: number;
    /** Min ms a press must be sustained to count as a `hold`. Default 500. */
    holdMs?: number;
    /** Max ms between presses to treat them as one hold/auto-repeat run. Default 300. */
    repeatGap?: number;
}

interface BoogieVolumeButtons {
    /**
     * Subscribes to an event; the first button/gesture subscriber arms detection.
     * Returns an unsubscribe function for this exact subscription.
     */
    on<K extends keyof BoogieVolumeButtonsEventMap>(
        type: K,
        callback: (event: BoogieVolumeButtonsEventMap[K]) => void
    ): () => void;

    /** Subscribes for a single event, then auto-unsubscribes. */
    once<K extends keyof BoogieVolumeButtonsEventMap>(
        type: K,
        callback: (event: BoogieVolumeButtonsEventMap[K]) => void
    ): () => void;

    /**
     * Removes a subscription (or, without a callback, every listener of the
     * type). The last removal disarms detection.
     */
    off<K extends keyof BoogieVolumeButtonsEventMap>(
        type: K,
        callback?: (event: BoogieVolumeButtonsEventMap[K]) => void
    ): void;

    /** Merges options over the current ones; detection options apply live while running. */
    configure(options: BoogieVolumeButtonsOptions): Required<BoogieVolumeButtonsOptions>;

    /** Returns a copy of the current options. */
    getOptions(): Required<BoogieVolumeButtonsOptions>;

    /** The ambient sounds available for the background keep-alive. */
    sounds: BoogieVolumeButtonsSound[];

    /** Resolves the current output volume, 0..1. */
    getVolume(): Promise<number>;

    /** Sets the output volume (0..1). */
    setVolume(level: number): Promise<void>;

    /** Whether detection is currently armed. */
    isRunning(): boolean;

    /** Event names accepted by on/once/off. */
    events: Array<keyof BoogieVolumeButtonsEventMap>;
}

declare var boogieVolumeButtons: BoogieVolumeButtons;
