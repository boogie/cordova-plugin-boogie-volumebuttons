#import "VolumeButtonsPlugin.h"
#import <MediaPlayer/MediaPlayer.h>
#import <AVFoundation/AVFoundation.h>

// iOS has no public "volume button pressed" API. The proven technique:
//   - observe AVAudioSession.outputVolume via KVO — it changes on each press;
//   - keep a hidden MPVolumeView in the view hierarchy so the system volume HUD
//     is swallowed (suppressIndicator);
//   - after each press, snap the level back to a mid baseline (keepAtBaseline)
//     so presses still register at the 0/max edges and the real volume doesn't
//     drift.
// A looping ambient player (silence, white noise, or rain) keeps the audio
// session active so events keep arriving while backgrounded or the screen is
// locked — which additionally requires the host app to enable the Audio
// background mode (see README).
//
// Cold start: an active .playback session is what routes the hardware buttons to
// the *media* volume (so outputVolume KVO fires) rather than the ringer. If that
// activation loses the race at launch, presses adjust the ringer and nothing is
// detected until an app-active cycle re-activates — the classic "works only
// after a lock/unlock" bug. We defeat it by re-activating once shortly after
// start (the JPSVolumeButtonHandler trick).
//
// Note: MPVolumeView-based volume changes do not work on the iOS Simulator —
// test on a device.

static const float kVolumeStep = 1.0f / 16.0f; // a typical hardware increment
static const float kEpsilon = 0.0005f;
static const NSTimeInterval kColdStartRekickDelay = 0.4; // seconds

// Bridge contract v1 identity; the version must match plugin.xml (the structure test checks).
static NSString* const kPluginId = @"cordova-plugin-boogie-volumebuttons";
static NSString* const kPluginVersion = @"1.1.0";

@interface VolumeButtonsPlugin ()
@property (nonatomic, strong) MPVolumeView* volumeView;
@property (nonatomic, strong) AVAudioPlayer* ambientPlayer;
@property (nonatomic, copy) NSString* currentSound; // the sound the player is loaded with
@property (nonatomic, copy) NSString* callbackId;
@property (nonatomic, assign) BOOL running;
@property (nonatomic, assign) BOOL volumeViewAttached;
@property (nonatomic, assign) BOOL observing;

@property (nonatomic, assign) BOOL suppressIndicator;
@property (nonatomic, assign) BOOL keepAtBaseline;
@property (nonatomic, assign) BOOL background;
@property (nonatomic, assign) float baseline;
@property (nonatomic, copy) NSString* soundName;
@property (nonatomic, assign) float soundVolume;

@property (nonatomic, assign) float lastVolume;
@property (nonatomic, assign) float initialVolume;
@property (nonatomic, assign) NSTimeInterval lastEventTime; // ms since epoch, -1 if none
@end

@implementation VolumeButtonsPlugin

#pragma mark - Lifecycle

- (void)pluginInitialize
{
    [super pluginInitialize];

    // Off-screen 1×1 view; added to / removed from the hierarchy on demand.
    self.volumeView = [[MPVolumeView alloc] initWithFrame:CGRectMake(-4000, -4000, 1, 1)];
    self.suppressIndicator = YES;
    self.keepAtBaseline = YES;
    self.background = YES;
    self.baseline = 0.5f;
    self.soundName = @"silence";
    self.soundVolume = 0.3f;
    self.lastEventTime = -1;

    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(onInterruption:)
                                                 name:AVAudioSessionInterruptionNotification
                                               object:[AVAudioSession sharedInstance]];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(onAppDidBecomeActive:)
                                                 name:UIApplicationDidBecomeActiveNotification
                                               object:nil];
}

- (void)onReset
{
    // Page navigation destroyed the JS consumers; tear everything down.
    [self teardown];
}

- (void)dealloc
{
    [self teardown];
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

#pragma mark - Actions

- (void)start:(CDVInvokedUrlCommand*)command
{
    [self applyOptions:[command argumentAtIndex:0 withDefault:@{}]];

    self.callbackId = command.callbackId;
    self.running = YES;
    self.initialVolume = [[AVAudioSession sharedInstance] outputVolume];
    self.lastVolume = self.initialVolume;
    self.lastEventTime = -1;

    [self activateSession];
    if (self.background) {
        [self startAmbientPlayer];
    }
    [self refreshVolumeView];
    [self startObserving];
    if (self.keepAtBaseline) {
        [self applyVolume:self.baseline];
    }

    // Cold-start repair: re-activate once shortly after launch so the buttons
    // are pointed at the media volume even if the first activation lost the race.
    __weak VolumeButtonsPlugin* weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kColdStartRekickDelay * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        VolumeButtonsPlugin* strongSelf = weakSelf;
        if (!strongSelf || !strongSelf.running) return;
        [strongSelf activateSession];
        if (strongSelf.background) [strongSelf startAmbientPlayer];
        [strongSelf refreshVolumeView];
        if (strongSelf.keepAtBaseline) [strongSelf applyVolume:strongSelf.baseline];
    });

    // Keep the callback open for the event stream.
    CDVPluginResult* keep = [CDVPluginResult resultWithStatus:CDVCommandStatus_NO_RESULT];
    [keep setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:keep callbackId:command.callbackId];
}

- (void)stop:(CDVInvokedUrlCommand*)command
{
    [self teardown];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK]
                                callbackId:command.callbackId];
}

- (void)configure:(CDVInvokedUrlCommand*)command
{
    BOOL wasKeeping = self.keepAtBaseline;
    [self applyOptions:[command argumentAtIndex:0 withDefault:@{}]];

    if (self.running) {
        if (self.background) {
            [self startAmbientPlayer]; // reloads if the sound/volume changed
        } else {
            [self stopAmbientPlayer];
        }
        [self refreshVolumeView];
        if (self.keepAtBaseline && !wasKeeping) {
            [self applyVolume:self.baseline];
        }
    }

    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK]
                                callbackId:command.callbackId];
}

- (void)getVolume:(CDVInvokedUrlCommand*)command
{
    float volume = [[AVAudioSession sharedInstance] outputVolume];
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDouble:volume];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)setVolume:(CDVInvokedUrlCommand*)command
{
    float value = [[command argumentAtIndex:0 withDefault:@(0.5)] floatValue];
    [self applyVolume:value];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK]
                                callbackId:command.callbackId];
}

// Bridge contract v1: what this native half is and can do, from static facts
// only — no session, no player, no I/O; never fails. `actions` lists every
// selector Cordova can dispatch here, sorted. `lockedScreen` reflects whether
// the host app declared the Audio background mode (ENABLE_LOCKSCREEN); the
// Info.plist dictionary is already in memory by the time a plugin runs.
- (void)describe:(CDVInvokedUrlCommand*)command
{
    NSArray* modes = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"UIBackgroundModes"];
    BOOL lockedScreen = [modes isKindOfClass:[NSArray class]] && [modes containsObject:@"audio"];
    NSDictionary* envelope = @{
        @"id": kPluginId,
        @"version": kPluginVersion,
        @"platform": @"ios",
        @"api": @1,
        @"actions": @[@"configure", @"describe", @"getVolume", @"setVolume", @"start", @"stop"],
        @"features": @{
            @"background": @YES,     // the ambient AVAudioPlayer keeps the session alive
            @"lockedScreen": @(lockedScreen),
            @"gestures": @YES,
            @"preciseHold": @NO,     // holds are inferred from the auto-repeat burst
            @"hudSuppression": @YES, // the hidden MPVolumeView
            @"baseline": @YES,
            @"ambientSounds": @[@"silence", @"whitenoise", @"rain"]
        }
    };
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:envelope];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

#pragma mark - KVO

- (void)observeValueForKeyPath:(NSString*)keyPath
                      ofObject:(id)object
                        change:(NSDictionary*)change
                       context:(void*)context
{
    if (![keyPath isEqualToString:@"outputVolume"]) {
        [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
        return;
    }
    if (!self.running || !self.callbackId) {
        return;
    }

    float newVolume = [change[NSKeyValueChangeNewKey] floatValue];

    // Our own snap-back (and the initial set) land on the baseline; ignore them.
    if (self.keepAtBaseline && fabsf(newVolume - self.baseline) < kEpsilon) {
        self.lastVolume = self.baseline;
        return;
    }

    NSString* direction = (newVolume > self.lastVolume) ? @"up" : @"down";
    int steps = (int)lroundf(fabsf(newVolume - self.lastVolume) / kVolumeStep);
    if (steps < 1) steps = 1;

    NSTimeInterval now = [[NSDate date] timeIntervalSince1970] * 1000.0;
    NSTimeInterval delta = (self.lastEventTime < 0) ? 0 : (now - self.lastEventTime);
    self.lastVolume = newVolume;
    self.lastEventTime = now;

    NSDictionary* payload = @{
        @"direction": direction,
        @"steps": @(steps),
        @"level": @(newVolume),
        @"delta": @(delta),
        @"timestamp": @(now)
    };
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:payload];
    [result setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:result callbackId:self.callbackId];

    if (self.keepAtBaseline) {
        [self applyVolume:self.baseline];
    }
}

#pragma mark - Options

- (void)applyOptions:(NSDictionary*)options
{
    if (options[@"suppressIndicator"]) self.suppressIndicator = [options[@"suppressIndicator"] boolValue];
    if (options[@"keepAtBaseline"]) self.keepAtBaseline = [options[@"keepAtBaseline"] boolValue];
    if (options[@"background"]) self.background = [options[@"background"] boolValue];
    if (options[@"baseline"] != nil) {
        self.baseline = fmaxf(0.0f, fminf(1.0f, [options[@"baseline"] floatValue]));
    }
    if ([options[@"sound"] isKindOfClass:[NSString class]]) {
        self.soundName = options[@"sound"];
    }
    if (options[@"soundVolume"] != nil) {
        self.soundVolume = fmaxf(0.0f, fminf(1.0f, [options[@"soundVolume"] floatValue]));
    }
}

#pragma mark - Audio session

- (void)activateSession
{
    AVAudioSession* session = [AVAudioSession sharedInstance];
    NSError* error = nil;
    [session setCategory:AVAudioSessionCategoryPlayback
             withOptions:AVAudioSessionCategoryOptionMixWithOthers
                   error:&error];
    [session setActive:YES error:&error];
    if (error) {
        NSLog(@"VolumeButtonsPlugin: session activation failed: %@", error.localizedDescription);
    }
}

// Loads and loops the selected ambient sound. Silence plays at volume 0; audible
// sounds make the Audio background mode App-Store-defensible. Reloads when the
// selected sound changes; only adjusts volume/resumes otherwise.
- (void)startAmbientPlayer
{
    NSString* desired = self.soundName.length ? self.soundName : @"silence";
    float volume = [desired isEqualToString:@"silence"] ? 0.0f : self.soundVolume;

    if (self.ambientPlayer && [self.currentSound isEqualToString:desired]) {
        self.ambientPlayer.volume = volume;
        if (!self.ambientPlayer.isPlaying) [self.ambientPlayer play];
        return;
    }

    [self.ambientPlayer stop];
    self.ambientPlayer = nil;

    NSString* path = [[NSBundle mainBundle] pathForResource:desired ofType:@"mp3"];
    if (!path) {
        NSLog(@"VolumeButtonsPlugin: %@.mp3 not found; background detection may pause when suspended", desired);
        return;
    }
    NSError* error = nil;
    self.ambientPlayer = [[AVAudioPlayer alloc] initWithContentsOfURL:[NSURL fileURLWithPath:path] error:&error];
    if (error) {
        NSLog(@"VolumeButtonsPlugin: ambient player init failed: %@", error.localizedDescription);
        self.ambientPlayer = nil;
        return;
    }
    self.ambientPlayer.numberOfLoops = -1;
    self.ambientPlayer.volume = volume;
    [self.ambientPlayer play];
    self.currentSound = desired;
}

- (void)stopAmbientPlayer
{
    [self.ambientPlayer stop];
    self.ambientPlayer = nil;
    self.currentSound = nil;
}

#pragma mark - Volume view

// Whether the hidden MPVolumeView should be in the hierarchy: it suppresses the
// HUD and is also required to set the slider value for the baseline snap-back.
- (BOOL)shouldAttachVolumeView
{
    return self.running && (self.suppressIndicator || self.keepAtBaseline);
}

- (void)refreshVolumeView
{
    if ([self shouldAttachVolumeView]) {
        [self attachVolumeView];
    } else {
        [self detachVolumeView];
    }
}

- (void)attachVolumeView
{
    if (self.volumeViewAttached) return;
    UIWindow* window = [self mainWindow];
    UIView* parent = window.rootViewController.view ?: window;
    if (parent) {
        self.volumeView.alpha = 0.01f;
        [parent addSubview:self.volumeView];
        self.volumeViewAttached = YES;
    }
}

- (void)detachVolumeView
{
    if (!self.volumeViewAttached) return;
    [self.volumeView removeFromSuperview];
    self.volumeViewAttached = NO;
}

- (void)applyVolume:(float)value
{
    value = fmaxf(0.0f, fminf(1.0f, value));
    BOOL adHoc = !self.volumeViewAttached;
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!self.volumeViewAttached) {
            [self attachVolumeView];
        }
        for (UIView* view in self.volumeView.subviews) {
            if ([view isKindOfClass:[UISlider class]]) {
                UISlider* slider = (UISlider*)view;
                [slider setValue:value animated:NO];
                [slider sendActionsForControlEvents:UIControlEventTouchUpInside];
                break;
            }
        }
        // If we attached it only to set the value, take it back down shortly.
        if (adHoc && ![self shouldAttachVolumeView]) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)),
                           dispatch_get_main_queue(), ^{
                if (![self shouldAttachVolumeView]) [self detachVolumeView];
            });
        }
    });
}

#pragma mark - Observers / teardown

- (void)startObserving
{
    if (self.observing) return;
    [[AVAudioSession sharedInstance] addObserver:self
                                      forKeyPath:@"outputVolume"
                                         options:NSKeyValueObservingOptionNew
                                         context:NULL];
    self.observing = YES;
}

- (void)stopObserving
{
    if (!self.observing) return;
    @try {
        [[AVAudioSession sharedInstance] removeObserver:self forKeyPath:@"outputVolume"];
    } @catch (__unused NSException* e) {}
    self.observing = NO;
}

- (void)teardown
{
    if (!self.running && !self.observing) return;
    self.running = NO;
    [self stopObserving];
    // Restore the volume we borrowed for the baseline snap-back.
    if (self.keepAtBaseline) {
        [self applyVolume:self.initialVolume];
    }
    [self detachVolumeView];
    [self stopAmbientPlayer];
    self.callbackId = nil;
    self.lastEventTime = -1;
}

- (void)onInterruption:(NSNotification*)notification
{
    NSUInteger type = [notification.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue];
    if (type == AVAudioSessionInterruptionTypeEnded && self.running) {
        [self activateSession];
        if (self.background) [self startAmbientPlayer];
    }
}

- (void)onAppDidBecomeActive:(NSNotification*)notification
{
    if (!self.running) return;
    [self activateSession];
    if (self.background) [self startAmbientPlayer];
    [self refreshVolumeView];
}

#pragma mark - Helpers

- (UIWindow*)mainWindow
{
    if (@available(iOS 13.0, *)) {
        for (UIScene* scene in [UIApplication sharedApplication].connectedScenes) {
            if (scene.activationState == UISceneActivationStateForegroundActive &&
                [scene isKindOfClass:[UIWindowScene class]]) {
                UIWindowScene* windowScene = (UIWindowScene*)scene;
                if (windowScene.windows.count) return windowScene.windows.firstObject;
            }
        }
    }
    UIWindow* keyWindow = [UIApplication sharedApplication].keyWindow;
    return keyWindow ?: [UIApplication sharedApplication].windows.firstObject;
}

@end
