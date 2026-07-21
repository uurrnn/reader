import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { tracks } from "@/lib/db/schema";
import { TrackCard } from "./_components/track-card";
import { UploadForm } from "./_components/upload-form";

export const dynamic = "force-dynamic";

export default async function ParentPage() {
  const library = await db.select().from(tracks).orderBy(desc(tracks.createdAt));
  return (
    <main className="mx-auto min-h-dvh max-w-2xl space-y-6 bg-slate-950 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Library</h1>
        <a href="/parent/schedule" className="text-sm text-slate-400 underline">
          Schedule →
        </a>
      </div>
      <UploadForm />
      <div className="space-y-2">
        {library.length === 0 && (
          <p className="text-slate-500">No tracks yet — add your first story above.</p>
        )}
        {library.map((track) => (
          <TrackCard key={track.id} track={track} />
        ))}
      </div>
    </main>
  );
}
