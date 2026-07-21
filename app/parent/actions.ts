"use server";

import { del, put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { parseWebStream } from "music-metadata";
import { db } from "@/lib/db";
import { tracks } from "@/lib/db/schema";
import { toTrackMeta, type AudioMetaLike } from "@/lib/tracks/metadata";
import { requireParent } from "@/lib/auth-server";

function assertBlobUrl(url: string) {
  const host = new URL(url).hostname;
  if (!host.endsWith(".public.blob.vercel-storage.com")) {
    throw new Error("Not a blob URL");
  }
}

export async function finalizeTrack(input: {
  url: string;
  filename: string;
  clientDurationSec: number | null;
}): Promise<void> {
  await requireParent();
  assertBlobUrl(input.url);

  let meta: AudioMetaLike | null = null;
  try {
    const res = await fetch(input.url);
    if (res.ok && res.body) {
      meta = await parseWebStream(res.body, {
        mimeType: res.headers.get("content-type") ?? undefined,
      });
    }
  } catch {
    meta = null;
  }

  const extracted = toTrackMeta(meta, input.filename);

  let artworkUrl: string | null = null;
  try {
    if (extracted.picture) {
      const ext = extracted.picture.mime.split("/")[1] ?? "jpg";
      const blob = await put(
        `artwork/${crypto.randomUUID()}.${ext}`,
        Buffer.from(extracted.picture.data),
        { access: "public", contentType: extracted.picture.mime },
      );
      artworkUrl = blob.url;
    }

    await db.insert(tracks).values({
      title: extracted.title,
      audioUrl: input.url,
      artworkUrl,
      durationSec: extracted.durationSec ?? input.clientDurationSec,
    });
  } catch (error) {
    try {
      if (artworkUrl) await del(artworkUrl);
      await del(input.url);
    } catch {}
    throw error;
  }
  revalidatePath("/parent");
}

export async function updateTrack(
  id: number,
  fields: { title?: string; kind?: "story" | "song" | "ambient" },
): Promise<void> {
  await requireParent();
  await db.update(tracks).set(fields).where(eq(tracks.id, id));
  revalidatePath("/parent");
}

export async function deleteTrack(id: number): Promise<void> {
  await requireParent();
  const [row] = await db.select().from(tracks).where(eq(tracks.id, id));
  if (!row) return;
  await db.delete(tracks).where(eq(tracks.id, id));
  try {
    await del(row.audioUrl);
    if (row.artworkUrl) await del(row.artworkUrl);
  } catch {}
  revalidatePath("/parent");
}

export async function replaceArtwork(id: number, formData: FormData): Promise<void> {
  await requireParent();
  const file = formData.get("artwork");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return;
  const [row] = await db.select().from(tracks).where(eq(tracks.id, id));
  if (!row) return;
  const ext = file.type.split("/")[1] ?? "jpg";
  const blob = await put(`artwork/${crypto.randomUUID()}.${ext}`, file, {
    access: "public",
    contentType: file.type,
  });
  await db.update(tracks).set({ artworkUrl: blob.url }).where(eq(tracks.id, id));
  if (row.artworkUrl) {
    try {
      await del(row.artworkUrl);
    } catch {}
  }
  revalidatePath("/parent");
}
