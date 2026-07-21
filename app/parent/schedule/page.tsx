import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { schedule, tracks } from "@/lib/db/schema";
import { getOrCreateTonight } from "@/lib/playlists";
import { saveSchedule } from "./actions";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ error?: string; saved?: string }> };

export default async function SchedulePage({ searchParams }: Props) {
  const { error, saved } = await searchParams;
  const [rows, ambientTracks, tonight] = await Promise.all([
    db.select().from(schedule),
    db.select().from(tracks).where(eq(tracks.kind, "ambient")),
    getOrCreateTonight(),
  ]);
  const row = rows[0] ?? null;

  const field = "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100";
  const label = "block text-sm text-slate-400";

  return (
    <main className="mx-auto min-h-dvh max-w-2xl space-y-6 bg-slate-950 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Bedtime schedule</h1>
        <a href="/parent" className="text-sm text-slate-400 underline">
          ← Library
        </a>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-300">
          Couldn&apos;t save — check the times and try again.
        </p>
      )}
      {saved && <p className="text-sm text-emerald-300">Saved.</p>}

      <form action={saveSchedule} className="space-y-4">
        <label className="flex items-center gap-2 text-slate-100">
          <input type="checkbox" name="enabled" defaultChecked={row?.enabled ?? false} />
          Start stories automatically
        </label>

        <div>
          <label htmlFor="startTime" className={label}>
            Start time
          </label>
          <input
            id="startTime"
            name="startTime"
            type="time"
            required
            defaultValue={row?.startTime ?? "20:30"}
            className={field}
          />
        </div>

        <div>
          <label htmlFor="fadeSeconds" className={label}>
            Fade-out length (seconds)
          </label>
          <input
            id="fadeSeconds"
            name="fadeSeconds"
            type="number"
            min={0}
            max={300}
            required
            defaultValue={row?.fadeSeconds ?? 30}
            className={field}
          />
        </div>

        <div>
          <label htmlFor="hardStopTime" className={label}>
            Hard stop (optional — everything silent by this time)
          </label>
          <input
            id="hardStopTime"
            name="hardStopTime"
            type="time"
            defaultValue={row?.hardStopTime ?? ""}
            className={field}
          />
        </div>

        <div>
          <label htmlFor="ambientTrackId" className={label}>
            After the stories, play
          </label>
          <select
            id="ambientTrackId"
            name="ambientTrackId"
            defaultValue={row?.ambientTrackId ?? ""}
            className={field}
          >
            <option value="">Nothing — just stop</option>
            {ambientTracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          {ambientTracks.length === 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Upload a track and set its kind to &quot;ambient&quot; to enable this.
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-slate-100">
          <input type="checkbox" name="tonightLoop" defaultChecked={tonight.loop} />
          Repeat tonight&apos;s lineup until stopped
        </label>

        <button
          type="submit"
          className="w-full rounded-xl bg-slate-200 px-4 py-3 font-semibold text-slate-900 active:bg-white"
        >
          Save
        </button>
      </form>
    </main>
  );
}
