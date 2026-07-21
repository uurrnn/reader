"use client";

import Image from "next/image";
import { useCallback, useRef, useState, useTransition } from "react";
import { addToTonight, clearResume, clearTonight, removeTonightItem, saveResume } from "@/app/actions";
import { BedtimeEngine, type EngineSnapshot } from "@/lib/audio/engine";
import { isWithinCatchUp } from "@/lib/audio/logic";
import { TONIGHT_MAX_ITEMS, toLineupEntry } from "@/lib/lineup";
import type { TonightItem } from "@/lib/playlists";
import type { schedule, tracks } from "@/lib/db/schema";
import { Player } from "./player";

type Track = typeof tracks.$inferSelect;
type ScheduleRow = typeof schedule.$inferSelect;

export type ShelfProps = {
  tracks: Track[];
  lineup: { playlist: { id: number; loop: boolean }; items: TonightItem[] };
  schedule: ScheduleRow | null;
  ambient: Track | null;
  resume: Record<number, number>;
};

function Cover({ track, sizes }: { track: Pick<Track, "artworkUrl" | "title">; sizes: string }) {
  return track.artworkUrl ? (
    <Image
      src={track.artworkUrl}
      alt=""
      fill
      sizes={sizes}
      className="object-cover"
    />
  ) : (
    <span className="flex h-full w-full items-center justify-center bg-indigo-800 text-4xl">
      🎧
    </span>
  );
}

export function Shelf({ tracks, lineup, schedule, ambient, resume }: ShelfProps) {
  const [, startTransition] = useTransition();
  const engineRef = useRef<BedtimeEngine | null>(null);
  // Mirrors engineRef for render-time reads: React's rules of hooks forbid
  // reading ref.current during render, but the ref itself is still needed so
  // ensureLoadedEngine's creation guard is synchronous and idempotent even
  // across rapid taps within the same tick (before a re-render lands).
  const [engine, setEngine] = useState<BedtimeEngine | null>(null);
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);

  const closePlayer = useCallback(() => {
    setPlayerOpen(false);
    setSnap(null);
  }, []);

  // Must run synchronously inside a tap handler (autoplay policy).
  function ensureLoadedEngine(): BedtimeEngine {
    if (!engineRef.current) {
      engineRef.current = new BedtimeEngine({
        onSnapshot: setSnap,
        onResumeTick: (trackId, positionSec) =>
          void saveResume(trackId, positionSec).catch(() => {}),
        onTrackDone: (trackId) => void clearResume(trackId).catch(() => {}),
      });
      setEngine(engineRef.current);
    }
    engineRef.current.load({
      lineup: lineup.items.map((i) => toLineupEntry(i.track, i.loopCount)),
      lineupLoop: lineup.playlist.loop,
      fadeSeconds: schedule?.fadeSeconds ?? 30,
      ambient: ambient ? toLineupEntry(ambient, -1) : null,
      resume,
    });
    return engineRef.current;
  }

  function handlePlayNow() {
    ensureLoadedEngine().startNow(schedule?.hardStopTime ?? null);
    setPlayerOpen(true);
  }

  function handleArm() {
    if (!schedule?.enabled) return;
    ensureLoadedEngine().arm(schedule.startTime, schedule.hardStopTime);
    setPlayerOpen(true);
  }

  const catchUp =
    !!schedule?.enabled &&
    lineup.items.length > 0 &&
    isWithinCatchUp(new Date(), schedule.startTime);

  const full = lineup.items.length >= TONIGHT_MAX_ITEMS;

  return (
    <main className="min-h-dvh bg-indigo-950 pb-44">
      <header className="flex items-center justify-between px-5 pt-6 pb-2">
        <h1 className="text-2xl font-bold text-amber-100">🌙 Tonight&apos;s stories</h1>
      </header>

      <div data-testid="shelf-grid" className="grid grid-cols-2 gap-4 px-5">
        {tracks.map((track) => (
          <button
            key={track.id}
            data-testid="shelf-tile"
            disabled={full}
            onClick={() => startTransition(() => addToTonight(track.id))}
            className="group text-left transition-transform active:scale-90 disabled:opacity-40"
          >
            <span className="relative block aspect-square overflow-hidden rounded-3xl shadow-lg shadow-indigo-950/60">
              <Cover track={track} sizes="(max-width: 640px) 50vw, 300px" />
            </span>
            <span className="mt-2 block truncate px-1 text-base font-semibold text-indigo-100">
              {track.title}
            </span>
          </button>
        ))}
        {tracks.length === 0 && (
          <p className="col-span-2 mt-16 text-center text-indigo-300">
            No stories yet — ask a grown-up to add some.
          </p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-indigo-800 bg-indigo-900/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex min-h-16 flex-1 items-center gap-2 overflow-x-auto">
            {lineup.items.length === 0 && (
              <p className="text-sm text-indigo-300">
                Tap a cover to pick tonight&apos;s stories
              </p>
            )}
            {lineup.items.map((item) => (
              <button
                key={item.itemId}
                data-testid="lineup-item"
                onClick={() => startTransition(() => removeTonightItem(item.itemId))}
                aria-label={`Remove ${item.track.title} from tonight`}
                className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl ring-2 ring-amber-300/70 transition-transform active:scale-90"
              >
                <Cover track={item.track} sizes="56px" />
              </button>
            ))}
            {lineup.items.length > 1 && (
              <button
                onClick={() => startTransition(() => clearTonight())}
                className="shrink-0 px-2 text-xs text-indigo-300"
              >
                start over
              </button>
            )}
          </div>
          <button
            data-testid="play-button"
            disabled={lineup.items.length === 0}
            onClick={handlePlayNow}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-amber-300 text-3xl text-indigo-950 shadow-lg transition-transform active:scale-90 disabled:opacity-40"
            aria-label="Play tonight's stories"
          >
            ▶
          </button>
        </div>
        {catchUp && (
          <button
            data-testid="catch-up-banner"
            onClick={handlePlayNow}
            className="mt-2 w-full rounded-xl bg-amber-300/20 py-2 text-center text-sm font-semibold text-amber-200"
          >
            It&apos;s past {schedule?.startTime} — start tonight&apos;s stories now
          </button>
        )}
        {schedule?.enabled && lineup.items.length > 0 && !catchUp && (
          <button
            data-testid="arm-button"
            onClick={handleArm}
            className="mt-2 w-full py-1 text-center text-sm text-amber-200/80"
          >
            🕗 Get ready for tonight at {schedule.startTime}
          </button>
        )}
      </div>

      {playerOpen && snap && engine && (
        <Player
          engine={engine}
          snap={snap}
          schedule={schedule}
          covers={lineup.items.map((i) => ({
            itemId: i.itemId,
            title: i.track.title,
            artworkUrl: i.track.artworkUrl,
          }))}
          onExit={closePlayer}
        />
      )}
    </main>
  );
}
