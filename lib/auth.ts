const encoder = new TextEncoder();

export const PARENT_COOKIE = "parent_session";
export const PARENT_TTL_SECONDS = 60 * 60;

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

export function parentToken(pin: string, expiresAtSec: number): Promise<string> {
  return hmacHex(pin, `parent-v1.${expiresAtSec}`).then(
    (mac) => `${expiresAtSec}.${mac}`,
  );
}

export async function isValidParentToken(
  token: string | undefined,
  pin: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const expiresAtSec = Number(token.slice(0, dot));
  if (!Number.isInteger(expiresAtSec) || expiresAtSec <= nowSec) return false;
  return token === (await parentToken(pin, expiresAtSec));
}
