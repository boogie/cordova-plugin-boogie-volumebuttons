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

interface BoogieVolumeButtonsErrorEvent {
    code: number;
    message: string;
}

interface BoogieVolumeButtonsEventMap {
    volume: BoogieVolumeButtonsEvent;
    up: BoogieVolumeButtonsEvent;
    down: BoogieVolumeButtonsEvent;
    error: BoogieVolumeButtonsErrorEvent;
}

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
     * Keep detecting while backgrounded or the screen is locked (silent audio
     * session/track). Costs a little battery. Default true.
     */
    background?: boolean;
}

interface BoogieVolumeButtons {
    /**
     * Subscribes to an event; the first button-event subscriber arms detection.
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

    /** Merges options over the current ones; applied live while running. */
    configure(options: BoogieVolumeButtonsOptions): Required<BoogieVolumeButtonsOptions>;

    /** Returns a copy of the current detection options. */
    getOptions(): Required<BoogieVolumeButtonsOptions>;

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
