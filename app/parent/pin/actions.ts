"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PARENT_COOKIE, PARENT_TTL_SECONDS, parentToken } from "@/lib/auth";
import { requiredEnv } from "@/lib/env";

export async function pinAction(formData: FormData) {
  const pin = String(formData.get("pin") ?? "");
  if (pin !== requiredEnv("PARENT_PIN")) {
    redirect("/parent/pin?error=1");
  }
  const expiresAtSec = Math.floor(Date.now() / 1000) + PARENT_TTL_SECONDS;
  const cookieStore = await cookies();
  cookieStore.set(PARENT_COOKIE, await parentToken(pin, expiresAtSec), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PARENT_TTL_SECONDS,
    path: "/",
  });
  redirect("/parent");
}
