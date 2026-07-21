"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PARENT_COOKIE, parentToken } from "@/lib/auth";

export async function pinAction(formData: FormData) {
  const pin = String(formData.get("pin") ?? "");
  if (pin !== process.env.PARENT_PIN) {
    redirect("/parent/pin?error=1");
  }
  const cookieStore = await cookies();
  cookieStore.set(PARENT_COOKIE, await parentToken(pin), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60,
    path: "/",
  });
  redirect("/parent");
}
