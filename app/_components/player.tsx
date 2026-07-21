"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { BedtimeEngine, EngineSnapshot } from "@/lib/audio/engine";
import type { schedule } from "@/lib/db/schema";

type ScheduleRow = typeof schedule.$inferSelect;

type PlayerProps = {
  engine: BedtimeEngine;
  snap: EngineSnapshot;
  schedule: ScheduleRow | null;
  covers: { itemId: number; title: string; artworkUrl: string | null }[];
  onExit: () => void;
};

function formatCountdown(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function Player({ engine, snap, schedule, covers, onExit }: PlayerProps) {
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      );
    tick();
    const interval = setInterval(tick, 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (snap.entry) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: snap.entry.title,
        artist: "Bedtime Reader",
        artwork: snap.entry.artworkUrl ? [{ src: snap.entry.artworkUrl }] : [],
      });
    }
    navigator.mediaSession.setActionHandler("play", () => engine.togglePause());
    navigator.mediaSession.setActionHandler("pause", () => engine.togglePause());
    navigator.mediaSession.setActionHandler("nexttrack", () => engine.skip());
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    };
  }, [snap.entry, engine]);

  useEffect(() => {
    if (snap.state !== "stopped") return;
    const timer = setTimeout(onExit, 1600);
    return () => clearTimeout(timer);
  }, [snap.state, onExit]);

  if (snap.state === "armed") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-indigo-950 p-6">
        <p className="text-lg text-indigo-300">
          Tonight at {schedule?.startTime ?? "…"}
        </p>
        <p data-testid="countdown" className="font-mono text-6xl font-bold text-amber-100">
          {formatCountdown(snap.secondsToStart ?? 0)}
        </p>
        <div className="flex gap-3">
          {covers.map((c) => (
            <span
              key={c.itemId}
              className="relative h-16 w-16 overflow-hidden rounded-xl ring-2 ring-amber-300/60"
            >
              {c.artworkUrl ? (
                <Image src={c.artworkUrl} alt={c.title} fill sizes="64px" className="object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-indigo-800 text-2xl">🎧</span>
              )}
            </span>
          ))}
        </div>
        <button
          data-testid="start-now"
          onClick={() => engine.startNow(schedule?.hardStopTime ?? null)}
          className="rounded-full bg-amber-300 px-8 py-4 text-lg font-semibold text-indigo-950 active:scale-95"
        >
          Start now
        </button>
        <button
          onClick={() => {
            engine.disarm();
            onExit();
          }}
          className="text-sm text-indigo-400"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (snap.state === "stopped") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950">
        <p className="text-3xl text-amber-100/70">Good night 🌙</p>
      </div>
    );
  }

  // playing | fading | ambient → night screen
  return (
    <div
      data-testid="night-screen"
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-stone-950 p-8"
    >
      <p className="pt-2 font-mono text-sm text-amber-100/40">{clock}</p>

      <div className="flex flex-col items-center gap-4">
        <span className="relative h-48 w-48 overflow-hidden rounded-3xl opacity-30">
          {snap.entry?.artworkUrl ? (
            <Image
              src={snap.entry.artworkUrl}
              alt=""
              fill
              sizes="192px"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-stone-900 text-6xl">
              🌙
            </span>
          )}
        </span>
        <p className="max-w-64 truncate text-center text-amber-100/50">
          {snap.state === "ambient" ? "Sleepy sounds" : snap.entry?.title}
        </p>
        {snap.state === "fading" && (
          <p className="text-sm text-amber-100/30">fading out…</p>
        )}
      </div>

      <div className="flex w-full items-center justify-center gap-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          data-testid="all-done"
          onClick={() => engine.stop({ fade: false })}
          className="text-sm text-amber-100/40"
        >
          all done
        </button>
        <button
          data-testid="pause-button"
          onClick={() => engine.togglePause()}
          aria-label={snap.paused ? "Play" : "Pause"}
          className="flex h-24 w-24 items-center justify-center rounded-full bg-amber-100/10 text-5xl text-amber-100/80 active:scale-95"
        >
          {snap.paused ? "▶" : "⏸"}
        </button>
        {snap.state !== "ambient" ? (
          <button
            data-testid="skip-button"
            onClick={() => engine.skip()}
            aria-label="Next story"
            className="text-3xl text-amber-100/40 active:scale-95"
          >
            ⏭
          </button>
        ) : (
          <span className="w-8" />
        )}
      </div>
    </div>
  );
}
