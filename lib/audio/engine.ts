import {
  fadeCurve,
  msUntilStart,
  nextPosition,
  resumeStartPosition,
  shouldPersistResume,
  type EngineState,
  type LineupEntry,
  type PlayPosition,
} from "./logic";

export type EngineSnapshot = {
  state: EngineState;
  index: number;
  entry: LineupEntry | null;
  secondsToStart: number | null;
  paused: boolean;
};

export type EngineCallbacks = {
  onSnapshot: (snap: EngineSnapshot) => void;
  onResumeTick: (trackId: number, positionSec: number) => void;
  onTrackDone: (trackId: number) => void;
};

const AMBIENT_GAIN = 0.35;
const PAUSE_FADE_SEC = 0.4;
const AMBIENT_FADE_SEC = 4;
const RESUME_TICK_MS = 10_000;

type LoadOptions = {
  lineup: LineupEntry[];
  lineupLoop: boolean;
  fadeSeconds: number;
  ambient: LineupEntry | null;
  resume: Record<number, number>;
};

export class BedtimeEngine {
  private cb: EngineCallbacks;
  private audio: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;

  private opts: LoadOptions = {
    lineup: [],
    lineupLoop: false,
    fadeSeconds: 30,
    ambient: null,
    resume: {},
  };

  private state: EngineState = "idle";
  private pos: PlayPosition = { index: 0, loopsDone: 0 };
  private secondsToStart: number | null = null;
  private inAmbient = false;

  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private startTimeout: ReturnType<typeof setTimeout> | null = null;
  private hardStopTimeout: ReturnType<typeof setTimeout> | null = null;
  private resumeInterval: ReturnType<typeof setInterval> | null = null;
  private fadeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(cb: EngineCallbacks) {
    this.cb = cb;
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";
    // Not in the DOM; exposed for the e2e harness and console debugging.
    (window as unknown as { __bedtimeAudio?: HTMLAudioElement }).__bedtimeAudio =
      this.audio;
    this.audio.addEventListener("ended", () => this.handleEnded());
    this.audio.addEventListener("error", () => this.advance(true));
  }

  load(opts: LoadOptions): void {
    this.opts = opts;
  }

  get paused(): boolean {
    return this.audio.paused;
  }

  private emit(): void {
    const entry = this.inAmbient
      ? this.opts.ambient
      : (this.opts.lineup[this.pos.index] ?? null);
    this.cb.onSnapshot({
      state: this.state,
      index: this.pos.index,
      entry,
      secondsToStart: this.secondsToStart,
      paused: this.audio.paused,
    });
  }

  private setState(state: EngineState): void {
    this.state = state;
    this.emit();
  }

  private ensureContext(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctx();
    const source = this.ctx.createMediaElementSource(this.audio);
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    source.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    void this.ctx.resume();
  }

  private fadeTo(target: number, seconds: number, done?: () => void): void {
    if (!this.ctx || !this.gain) return;
    if (this.fadeTimeout) clearTimeout(this.fadeTimeout);
    const g = this.gain.gain;
    const current = g.value;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(current, this.ctx.currentTime);
    const secs = Math.max(seconds, 0.05);
    g.setValueCurveAtTime(fadeCurve(current, target), this.ctx.currentTime, secs);
    if (done) this.fadeTimeout = setTimeout(done, secs * 1000);
  }

  private playEntry(entry: LineupEntry, fadeInSec: number, targetGain: number): void {
    const startAt = shouldPersistResume(entry.kind, entry.durationSec)
      ? resumeStartPosition(this.opts.resume[entry.trackId], entry.durationSec)
      : 0;
    this.audio.loop = this.inAmbient;
    this.audio.src = entry.audioUrl;
    if (startAt > 0) {
      this.audio.addEventListener(
        "loadedmetadata",
        () => {
          this.audio.currentTime = startAt;
        },
        { once: true },
      );
    }
    void this.audio
      .play()
      .then(() => this.fadeTo(targetGain, fadeInSec))
      .catch(() => {});
  }

  private startResumeTicks(): void {
    if (this.resumeInterval) return;
    this.resumeInterval = setInterval(() => {
      const entry = this.opts.lineup[this.pos.index];
      if (
        this.state === "playing" &&
        !this.inAmbient &&
        entry &&
        !this.audio.paused &&
        shouldPersistResume(entry.kind, entry.durationSec)
      ) {
        this.cb.onResumeTick(entry.trackId, Math.floor(this.audio.currentTime));
      }
    }, RESUME_TICK_MS);
  }

  private clearTimers(): void {
    for (const t of [this.countdownInterval, this.resumeInterval]) {
      if (t) clearInterval(t);
    }
    for (const t of [this.startTimeout, this.hardStopTimeout, this.fadeTimeout]) {
      if (t) clearTimeout(t);
    }
    this.countdownInterval = null;
    this.resumeInterval = null;
    this.startTimeout = null;
    this.hardStopTimeout = null;
    this.fadeTimeout = null;
  }

  arm(startTime: string, hardStopTime: string | null): void {
    this.ensureContext();
    this.clearTimers();
    this.audio.pause();
    this.inAmbient = false;
    this.pos = { index: 0, loopsDone: 0 };
    const tick = () => {
      this.secondsToStart = Math.round(msUntilStart(new Date(), startTime) / 1000);
      this.emit();
    };
    this.countdownInterval = setInterval(tick, 1000);
    this.startTimeout = setTimeout(
      () => this.startNow(hardStopTime),
      msUntilStart(new Date(), startTime),
    );
    this.state = "armed";
    tick();
  }

  disarm(): void {
    this.clearTimers();
    this.secondsToStart = null;
    this.setState("idle");
  }

  startNow(hardStopTime: string | null = null): void {
    if (this.opts.lineup.length === 0) return;
    this.ensureContext();
    this.clearTimers();
    this.secondsToStart = null;
    this.inAmbient = false;
    this.pos = { index: 0, loopsDone: 0 };
    if (hardStopTime) {
      this.hardStopTimeout = setTimeout(
        () => this.stop({ fade: true }),
        msUntilStart(new Date(), hardStopTime),
      );
    }
    this.startResumeTicks();
    this.setState("playing");
    this.playEntry(this.opts.lineup[0], Math.min(this.opts.fadeSeconds, 10), 1);
  }

  private handleEnded(): void {
    if (this.state === "fading" || this.state === "stopped") return;
    if (this.inAmbient) return; // ambient loops via audio.loop
    const entry = this.opts.lineup[this.pos.index];
    this.pos = { ...this.pos, loopsDone: this.pos.loopsDone + 1 };
    const next = nextPosition(this.pos, this.opts.lineup, this.opts.lineupLoop);
    const finishedItem = next === "end" || next.index !== this.pos.index;
    if (entry && finishedItem) this.cb.onTrackDone(entry.trackId);
    this.applyNext(next);
  }

  private advance(force: boolean): void {
    if (this.state === "fading" || this.state === "stopped") return;
    if (this.inAmbient) {
      this.stop({ fade: false });
      return;
    }
    const next = force
      ? this.pos.index + 1 < this.opts.lineup.length
        ? { index: this.pos.index + 1, loopsDone: 0 }
        : this.opts.lineupLoop && this.opts.lineup.length > 0
          ? { index: 0, loopsDone: 0 }
          : ("end" as const)
      : nextPosition(this.pos, this.opts.lineup, this.opts.lineupLoop);
    this.applyNext(next);
  }

  private applyNext(next: PlayPosition | "end"): void {
    if (next === "end") {
      if (this.opts.ambient) {
        this.inAmbient = true;
        this.setState("ambient");
        this.playEntry(this.opts.ambient, AMBIENT_FADE_SEC, AMBIENT_GAIN);
      } else {
        this.stop({ fade: false });
      }
      return;
    }
    this.pos = next;
    this.setState("playing");
    this.playEntry(this.opts.lineup[next.index], 0.5, 1);
  }

  skip(): void {
    this.advance(true);
  }

  togglePause(): void {
    if (this.audio.paused) {
      this.ensureContext();
      void this.audio
        .play()
        .then(() =>
          this.fadeTo(this.inAmbient ? AMBIENT_GAIN : 1, PAUSE_FADE_SEC),
        )
        .catch(() => {});
      this.emit();
    } else {
      this.fadeTo(0, PAUSE_FADE_SEC, () => {
        this.audio.pause();
        this.emit();
      });
    }
  }

  stop(opts: { fade?: boolean } = {}): void {
    const finish = () => {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.inAmbient = false;
      this.clearTimers();
      this.secondsToStart = null;
      this.setState("stopped");
    };
    if (opts.fade && (this.state === "playing" || this.state === "ambient")) {
      this.setState("fading");
      this.fadeTo(0, this.opts.fadeSeconds, finish);
    } else {
      finish();
    }
  }

  destroy(): void {
    this.clearTimers();
    this.audio.pause();
    this.audio.removeAttribute("src");
    const w = window as unknown as { __bedtimeAudio?: HTMLAudioElement };
    if (w.__bedtimeAudio === this.audio) delete w.__bedtimeAudio;
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.gain = null;
  }
}
