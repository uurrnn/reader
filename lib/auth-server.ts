import { cookies } from "next/headers";
import {
  FAMILY_COOKIE,
  PARENT_COOKIE,
  isValidFamilyToken,
  isValidParentToken,
} from "./auth";
import { requiredEnv } from "./env";

export async function requireParent(): Promise<void> {
  const cookieStore = await cookies();
  const ok = await isValidParentToken(
    cookieStore.get(PARENT_COOKIE)?.value,
    requiredEnv("PARENT_PIN"),
  );
  if (!ok) throw new Error("Not authorized");
}

export async function requireFamily(): Promise<void> {
  const cookieStore = await cookies();
  const ok = await isValidFamilyToken(
    cookieStore.get(FAMILY_COOKIE)?.value,
    requiredEnv("FAMILY_PASSWORD"),
  );
  if (!ok) throw new Error("Not authorized");
}
