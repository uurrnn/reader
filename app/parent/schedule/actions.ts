"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireParent } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { playlists, schedule } from "@/lib/db/schema";
import { getOrCreateTonight } from "@/lib/playlists";
import { parseScheduleForm } from "@/lib/schedule";

export async function saveSchedule(formData: FormData): Promise<void> {
  await requireParent();
  const input = parseScheduleForm(formData);
  if (!input) redirect("/parent/schedule?error=1");
  const fields = {
    enabled: input.enabled,
    startTime: input.startTime,
    fadeSeconds: input.fadeSeconds,
    hardStopTime: input.hardStopTime,
    ambientTrackId: input.ambientTrackId,
  };
  await db
    .insert(schedule)
    .values({ id: 1, ...fields })
    .onConflictDoUpdate({ target: schedule.id, set: fields });
  const tonight = await getOrCreateTonight();
  await db
    .update(playlists)
    .set({ loop: input.tonightLoop })
    .where(eq(playlists.id, tonight.id));
  revalidatePath("/");
  revalidatePath("/parent/schedule");
  redirect("/parent/schedule?saved=1");
}
