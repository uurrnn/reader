const encoder = new TextEncoder();

export const FAMILY_COOKIE = "family_session";
export const PARENT_COOKIE = "parent_session";

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function familyToken(password: string): Promise<string> {
  return hmacHex(password, "family-v1");
}

export function parentToken(pin: string): Promise<string> {
  return hmacHex(pin, "parent-v1");
}

export async function isValidFamilyToken(
  token: string | undefined,
  password: string,
): Promise<boolean> {
  return !!token && token === (await familyToken(password));
}

export async function isValidParentToken(
  token: string | undefined,
  pin: string,
): Promise<boolean> {
  return !!token && token === (await parentToken(pin));
}
