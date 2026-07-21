"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { deleteTrack, replaceArtwork, updateTrack } from "@/app/parent/actions";
import type { tracks } from "@/lib/db/schema";

type Track = typeof tracks.$inferSelect;

const KINDS = ["story", "song", "ambient"] as const;

function formatDuration(sec: number | null) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TrackCard({ track }: { track: Track }) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(track.title);
  const [error, setError] = useState<string | null>(null);

  const run = (label: string, fn: () => Promise<void>) =>
    startTransition(async () => {
      setError(null);
      try {
        await fn();
      } catch {
        setError(`Couldn't ${label} — try again.`);
      }
    });

  return (
    <div className="flex items-center gap-4 rounded-xl bg-slate-900 p-3">
      <label className="relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-slate-800">
        {track.artworkUrl ? (
          <Image src={track.artworkUrl} alt="" fill className="object-cover" sizes="64px" />
        ) : (
          <span className="flex h-full items-center justify-center text-2xl">🎧</span>
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const formData = new FormData();
            formData.set("artwork", file);
            run("replace the artwork", () => replaceArtwork(track.id, formData));
          }}
        />
      </label>
      <div className="min-w-0 flex-1 space-y-1">
        <input
          value={title}
          aria-label="Track title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== track.title) {
              run("rename the track", () => updateTrack(track.id, { title: title.trim() }));
            }
          }}
          className="w-full rounded bg-transparent text-slate-100 outline-none focus:bg-slate-800 px-1"
        />
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <select
            value={track.kind}
            aria-label="Track kind"
            onChange={(e) =>
              run("change the kind", () =>
                updateTrack(track.id, { kind: e.target.value as Track["kind"] }),
              )
            }
            className="rounded bg-slate-800 px-1 py-0.5"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <span>{formatDuration(track.durationSec)}</span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>
      <button
        disabled={pending}
        onClick={() => {
          if (confirm(`Delete "${track.title}"?`)) {
            run("delete the track", () => deleteTrack(track.id));
          }
        }}
        className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-800 hover:text-rose-300 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}
