import { cookies } from "next/headers";
import { PARENT_COOKIE, isValidParentToken } from "./auth";

export async function requireParent(): Promise<void> {
  const cookieStore = await cookies();
  const ok = await isValidParentToken(
    cookieStore.get(PARENT_COOKIE)?.value,
    process.env.PARENT_PIN!,
  );
  if (!ok) throw new Error("Not authorized");
}
