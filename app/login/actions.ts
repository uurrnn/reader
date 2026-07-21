"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FAMILY_COOKIE, familyToken } from "@/lib/auth";
import { requiredEnv } from "@/lib/env";

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password !== requiredEnv("FAMILY_PASSWORD")) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    redirect("/login?error=1");
  }
  const cookieStore = await cookies();
  cookieStore.set(FAMILY_COOKIE, await familyToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  redirect("/");
}
