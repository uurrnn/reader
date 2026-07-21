export type EngineState =
  | "idle"
  | "armed"
  | "playing"
  | "fading"
  | "ambient"
  | "stopped";

export type LineupEntry = {
  trackId: number;
  title: string;
  audioUrl: string;
  artworkUrl: string | null;
  kind: "story" | "song" | "ambient";
  durationSec: number | null;
  loopCount: number | null;
};

export type PlayPosition = { index: number; loopsDone: number };

function startDateFor(now: Date, startTime: string): Date {
  const [h, m] = startTime.split(":").map(Number);
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  return start;
}

export function msUntilStart(now: Date, startTime: string): number {
  const start = startDateFor(now, startTime);
  if (start.getTime() <= now.getTime()) {
    start.setDate(start.getDate() + 1);
  }
  return start.getTime() - now.getTime();
}

export function isWithinCatchUp(
  now: Date,
  startTime: string,
  graceMinutes = 90,
): boolean {
  const start = startDateFor(now, startTime);
  if (start.getTime() > now.getTime()) {
    // The most recent occurrence may have been yesterday (late start,
    // reopened after midnight).
    start.setDate(start.getDate() - 1);
  }
  const elapsedMs = now.getTime() - start.getTime();
  return elapsedMs > 0 && elapsedMs <= graceMinutes * 60 * 1000;
}

export function nextPosition(
  pos: PlayPosition,
  lineup: { loopCount: number | null }[],
  lineupLoop: boolean,
): PlayPosition | "end" {
  const current = lineup[pos.index];
  if (current) {
    const target = current.loopCount ?? 1;
    if (target === -1 || pos.loopsDone < target) {
      return { index: pos.index, loopsDone: pos.loopsDone };
    }
  }
  const next = pos.index + 1;
  if (next < lineup.length) return { index: next, loopsDone: 0 };
  if (lineupLoop && lineup.length > 0) return { index: 0, loopsDone: 0 };
  return "end";
}

export function fadeCurve(from: number, to: number, steps = 64): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const eased = (1 - Math.cos(Math.PI * t)) / 2;
    curve[i] = from + (to - from) * eased;
  }
  return curve;
}

export function shouldPersistResume(
  kind: string,
  durationSec: number | null,
): boolean {
  return kind === "story" && durationSec !== null && durationSec >= 600;
}

export function resumeStartPosition(
  savedSec: number | null | undefined,
  durationSec: number | null,
): number {
  if (savedSec == null || savedSec <= 30) return 0;
  if (durationSec !== null && savedSec >= durationSec - 30) return 0;
  return savedSec;
}
