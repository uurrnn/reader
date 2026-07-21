import { asc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { playbackState, schedule, tracks } from "@/lib/db/schema";
import { getTonightLineup } from "@/lib/playlists";
import { Shelf } from "./_components/shelf";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [shelfTracks, lineup, scheduleRows, resumeRows] = await Promise.all([
    db
      .select()
      .from(tracks)
      .where(ne(tracks.kind, "ambient"))
      .orderBy(asc(tracks.title)),
    getTonightLineup(),
    db.select().from(schedule),
    db.select().from(playbackState),
  ]);
  const scheduleRow = scheduleRows[0] ?? null;
  const ambient = scheduleRow?.ambientTrackId
    ? ((
        await db
          .select()
          .from(tracks)
          .where(eq(tracks.id, scheduleRow.ambientTrackId))
      )[0] ?? null)
    : null;
  const resume = Object.fromEntries(
    resumeRows.map((r) => [r.trackId, r.positionSec]),
  ) as Record<number, number>;
  return (
    <Shelf
      tracks={shelfTracks}
      lineup={lineup}
      schedule={scheduleRow}
      ambient={ambient}
      resume={resume}
    />
  );
}
