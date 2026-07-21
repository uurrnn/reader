import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { playlistItems, playlists, tracks } from "@/lib/db/schema";

export const TONIGHT_NAME = "tonight";
export const TONIGHT_MAX_ITEMS = 6;

export type TonightItem = {
  itemId: number;
  sortOrder: number;
  loopCount: number | null;
  track: typeof tracks.$inferSelect;
};

export async function getOrCreateTonight() {
  const [existing] = await db
    .select()
    .from(playlists)
    .where(eq(playlists.name, TONIGHT_NAME));
  if (existing) return existing;
  const [created] = await db
    .insert(playlists)
    .values({ name: TONIGHT_NAME })
    .returning();
  return created;
}

export async function getTonightLineup(): Promise<{
  playlist: { id: number; loop: boolean };
  items: TonightItem[];
}> {
  const playlist = await getOrCreateTonight();
  const rows = await db
    .select({
      itemId: playlistItems.id,
      sortOrder: playlistItems.sortOrder,
      loopCount: playlistItems.loopCount,
      track: tracks,
    })
    .from(playlistItems)
    .innerJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .where(eq(playlistItems.playlistId, playlist.id))
    .orderBy(asc(playlistItems.sortOrder));
  return { playlist: { id: playlist.id, loop: playlist.loop }, items: rows };
}
