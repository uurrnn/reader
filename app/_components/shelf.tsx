"use client";

import Image from "next/image";
import { useTransition } from "react";
import { addToTonight, clearTonight, removeTonightItem } from "@/app/actions";
import { TONIGHT_MAX_ITEMS } from "@/lib/lineup";
import type { TonightItem } from "@/lib/playlists";
import type { schedule, tracks } from "@/lib/db/schema";

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

export function Shelf({ tracks, lineup, schedule }: ShelfProps) {
  const [, startTransition] = useTransition();
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
            onClick={() => {}}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-amber-300 text-3xl text-indigo-950 shadow-lg transition-transform active:scale-90 disabled:opacity-40"
            aria-label="Play tonight's stories"
          >
            ▶
          </button>
        </div>
        {schedule?.enabled && lineup.items.length > 0 && (
          <p className="mt-2 text-center text-sm text-amber-200/80">
            Tonight at {schedule.startTime}
          </p>
        )}
      </div>
    </main>
  );
}
