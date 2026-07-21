# Bedtime Reader — Plan 2: Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The kid-facing player: artwork shelf + tonight's lineup, a GainNode-based playback engine with armed scheduling, sleep features (fade-out, ambient rollover, night screen, resume), and PWA installability — plus the security/UX carry-over fixes from the Plan 1 review.

**Architecture:** Kid pages stay behind the family gate only (no PIN). A pure decision module (`lib/audio/logic.ts`, fully unit-tested) feeds a thin DOM engine class (`lib/audio/engine.ts`) that owns one `<audio>` element routed through a Web Audio GainNode (iOS: `audio.volume` is read-only — ALL fades via the gain node). Kid mutations are server actions gated by a new `requireFamily()`; parent schedule settings stay behind `requireParent()`. The reserved playlist named `tonight` is the kid lineup.

**Tech Stack:** Next.js 16.2, React 19, Tailwind v4, drizzle-orm + @neondatabase/serverless (neon-http), @vercel/blob, Web Audio API, Screen Wake Lock, Media Session API, vitest, playwright-core e2e.

**Spec:** `docs/superpowers/specs/2026-07-21-bedtime-reader-design.md`
**Handoff (carry-over list):** `docs/superpowers/plans/2026-07-21-plan-2-handoff.md`

## Global Constraints

- Next.js **16**: gate file is `proxy.ts` exporting `function proxy()` and a matcher const that MUST be named `config`. `cookies()`/`searchParams` are async — always `await`.
- iOS Safari: `audio.volume` is read-only. Never set it; all fades go through the GainNode.
- `lib/db` uses the **neon-http** driver: `db.transaction()` is NOT supported. Do not add transactions; single statements + `onConflictDoUpdate` only. (Decided: v1 has no drag-reorder, so no transaction is needed.)
- Auth conventions: every parent-area mutating action starts with `await requireParent()`; every kid-facing mutating action starts with `await requireFamily()` (added in Task 4).
- `lib/auth.ts` must stay runtime-agnostic (no `next/headers` imports) — it is imported by vitest and by `proxy.ts`. Server-only helpers live in `lib/auth-server.ts`.
- Tailwind **v4**: no config file; theme in `app/globals.css`. No component library.
- TypeScript strict; alias `@/*` → repo root.
- Kid-facing screens: no alerts/error dialogs ever — on audio error, skip silently. Artwork-first, short labels, dusk-toned warm palette (indigo/amber).
- Track kinds are exactly `"story" | "song" | "ambient"`.
- User-adjudicated (do NOT change): duration 0 stays "unknown"; client-side orphan blobs accepted for v1.
- Shell is Windows PowerShell 5.1: no `&&` chaining; use `;` or separate commands. `curl.exe` for HTTP checks.
- End every git commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Verification commands: `npm test` (vitest), `npx tsc --noEmit`, `npm run lint`, `npm run e2e` (needs `npm run dev` running, Chrome, ffmpeg at `C:\Users\uurrn\AppData\Local\ffmpeg\bin\ffmpeg.exe`; must leave the library empty).
- Work happens on branch `feature/player`.

---

### Task 1: Branch + expiring parent token + env-var assertions

**Files:**
- Create: `lib/env.ts`
- Test: `lib/env.test.ts`
- Modify: `lib/auth.ts` (parent token gains an embedded expiry)
- Modify: `lib/auth.test.ts` (parent-token cases)
- Modify: `app/parent/pin/actions.ts` (issue timestamped token)
- Modify: `lib/db/index.ts`, `lib/auth-server.ts`, `app/login/actions.ts`, `app/api/upload/route.ts`, `proxy.ts` (use `requiredEnv`)

**Interfaces:**
- Consumes: existing `hmacHex`-based helpers in `lib/auth.ts`.
- Produces (used by every later task):
  - `requiredEnv(name: string): string` from `@/lib/env` — throws `Missing required env var: <name>` when unset/empty.
  - `PARENT_TTL_SECONDS = 60 * 60` from `@/lib/auth`.
  - `parentToken(pin: string, expiresAtSec: number): Promise<string>` — format `<expiresAtSec>.<hmacHex>`; HMAC message includes the expiry so it cannot be tampered.
  - `isValidParentToken(token: string | undefined, pin: string, nowSec?: number): Promise<boolean>` — the third param defaults to the current time; existing call sites in `proxy.ts` / `lib/auth-server.ts` keep their two-arg form unchanged.

- [ ] **Step 1: Branch and commit this plan**

```powershell
git checkout -b feature/player
git add docs
git commit -m "docs: add player implementation plan"
```

- [ ] **Step 2: Write the failing tests**

Create `lib/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { requiredEnv } from "@/lib/env";

describe("requiredEnv", () => {
  it("returns the value when set", () => {
    process.env.TEST_REQUIRED_ENV = "abc";
    expect(requiredEnv("TEST_REQUIRED_ENV")).toBe("abc");
  });

  it("throws a descriptive error when missing", () => {
    delete process.env.TEST_MISSING_ENV;
    expect(() => requiredEnv("TEST_MISSING_ENV")).toThrow(
      "Missing required env var: TEST_MISSING_ENV",
    );
  });

  it("throws when the value is an empty string", () => {
    process.env.TEST_EMPTY_ENV = "";
    expect(() => requiredEnv("TEST_EMPTY_ENV")).toThrow("TEST_EMPTY_ENV");
  });
});
```

In `lib/auth.test.ts`, replace the two existing parent-token tests (`"family and parent tokens differ for the same secret"` and `"parent token round-trips"`) with:

```ts
describe("parent tokens (expiring)", () => {
  const EXPIRES = 1_800_000_000; // fixed epoch seconds for determinism

  it("round-trips before expiry", async () => {
    const token = await parentToken("1234", EXPIRES);
    expect(await isValidParentToken(token, "1234", EXPIRES - 10)).toBe(true);
  });

  it("rejects at and after expiry", async () => {
    const token = await parentToken("1234", EXPIRES);
    expect(await isValidParentToken(token, "1234", EXPIRES)).toBe(false);
    expect(await isValidParentToken(token, "1234", EXPIRES + 1)).toBe(false);
  });

  it("rejects a tampered expiry timestamp", async () => {
    const token = await parentToken("1234", EXPIRES);
    const [, mac] = token.split(".");
    const forged = `${EXPIRES + 9999}.${mac}`;
    expect(await isValidParentToken(forged, "1234", EXPIRES - 10)).toBe(false);
  });

  it("rejects the wrong pin", async () => {
    const token = await parentToken("1234", EXPIRES);
    expect(await isValidParentToken(token, "9999", EXPIRES - 10)).toBe(false);
  });

  it("rejects undefined and malformed tokens", async () => {
    expect(await isValidParentToken(undefined, "1234", EXPIRES - 10)).toBe(false);
    expect(await isValidParentToken("no-dot-here", "1234", EXPIRES - 10)).toBe(false);
    expect(await isValidParentToken(".abc", "1234", EXPIRES - 10)).toBe(false);
  });

  it("family and parent tokens differ for the same secret", async () => {
    const parent = await parentToken("1234", EXPIRES);
    expect(await familyToken("1234")).not.toBe(parent);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/env'` and parent-token signature/behavior failures.

- [ ] **Step 4: Implement**

Create `lib/env.ts`:

```ts
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
```

In `lib/auth.ts`, replace `parentToken` and `isValidParentToken` (leave family helpers and `hmacHex` untouched) and add the TTL const:

```ts
export const PARENT_TTL_SECONDS = 60 * 60;

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
```

In `app/parent/pin/actions.ts`, issue the timestamped token (imports gain `PARENT_TTL_SECONDS` and `requiredEnv`):

```ts
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
```

Swap `process.env.X!` for `requiredEnv("X")` in the remaining call sites:
- `lib/db/index.ts`: `export const db = drizzle(neon(requiredEnv("DATABASE_URL")), { schema });` (import `requiredEnv` from `./env` → use `@/lib/env`).
- `lib/auth-server.ts`: `requiredEnv("PARENT_PIN")` inside `requireParent()`.
- `app/login/actions.ts`: `requiredEnv("FAMILY_PASSWORD")` for the comparison.
- `app/api/upload/route.ts`: `requiredEnv("FAMILY_PASSWORD")` inside `onBeforeGenerateToken`.
- `proxy.ts`: `requiredEnv("FAMILY_PASSWORD")` and `requiredEnv("PARENT_PIN")`.

- [ ] **Step 5: Run tests and type-check**

Run: `npm test` → PASS (env + auth + metadata suites). Run: `npx tsc --noEmit` → clean.

- [ ] **Step 6: Manual gate re-check**

With `npm run dev` running: log in, enter PIN `1234` → `/parent` loads. (The new cookie format round-trips through `proxy.ts`.)

- [ ] **Step 7: Commit**

```powershell
git add lib/env.ts lib/env.test.ts lib/auth.ts lib/auth.test.ts app/parent/pin/actions.ts lib/db/index.ts lib/auth-server.ts app/login/actions.ts app/api/upload/route.ts proxy.ts
git commit -m "feat: expiring parent token and required-env assertions"
```

---

### Task 2: Login/PIN failure delay + a11y labels

**Files:**
- Modify: `app/login/actions.ts`, `app/parent/pin/actions.ts` (fixed delay on failure)
- Modify: `app/login/page.tsx`, `app/parent/pin/page.tsx` (labeled inputs)

**Interfaces:**
- Consumes: Task 1's action files.
- Produces: brute-force mitigation (1.5s fixed delay per failed attempt — appropriate for a family app on serverless where per-IP counters don't persist) and screen-reader labels. No signature changes.

- [ ] **Step 1: Add the failure delay to both actions**

In `app/login/actions.ts`, replace the failure branch:

```ts
  if (password !== requiredEnv("FAMILY_PASSWORD")) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    redirect("/login?error=1");
  }
```

In `app/parent/pin/actions.ts`, replace the failure branch the same way:

```ts
  if (pin !== requiredEnv("PARENT_PIN")) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    redirect("/parent/pin?error=1");
  }
```

- [ ] **Step 2: Label the inputs**

In `app/login/page.tsx`, give the input `id="password"` and insert directly above it:

```tsx
        <label htmlFor="password" className="sr-only">
          Family password
        </label>
```

In `app/parent/pin/page.tsx`, give the input `id="pin"` and insert directly above it:

```tsx
        <label htmlFor="pin" className="sr-only">
          Parent PIN
        </label>
```

- [ ] **Step 3: Verify**

With `npm run dev` running: wrong password on `/login` → response takes ≥1.5s and shows the error; right password still instant. Same on `/parent/pin`. Run: `npx tsc --noEmit` → clean. Run: `npm run lint` → clean.

- [ ] **Step 4: Commit**

```powershell
git add app/login app/parent/pin
git commit -m "fix: throttle failed login/PIN attempts and label auth inputs"
```

---

### Task 3: Upload allowlist (.m4b), measureDuration timeout, mutation error surfacing

**Files:**
- Modify: `app/api/upload/route.ts` (m4b content types)
- Modify: `app/parent/_components/upload-form.tsx` (timeout + accept + error text)
- Modify: `app/parent/_components/track-card.tsx` (surface action failures)

**Interfaces:**
- Consumes: existing server actions from `@/app/parent/actions` (unchanged).
- Produces: parent mutations that fail now show inline `role="alert"` text instead of silently doing nothing. This is the "do EARLY" carry-over — it is what made the 413 bug invisible.

- [ ] **Step 1: Extend the upload allowlist**

In `app/api/upload/route.ts`, add to `allowedContentTypes` (audiobook `.m4b` files report one of these depending on OS):

```ts
            "audio/x-m4b",
            "audio/m4b",
```

- [ ] **Step 2: Timeout in `measureDuration` + `.m4b` in the file picker**

Replace `measureDuration` in `app/parent/_components/upload-form.tsx`:

```ts
function measureDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;
    const settle = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => settle(null), 10_000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      settle(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    audio.onerror = () => settle(null);
    audio.src = url;
  });
}
```

Change the file input's accept attribute (some OS pickers don't classify `.m4b` under `audio/*`):

```tsx
          accept="audio/*,.m4b"
```

- [ ] **Step 3: Surface errors in `track-card.tsx`**

Replace the whole component body of `TrackCard` — same layout, but every transition catches failures into an `error` state rendered as `role="alert"` text, and the artwork/title/kind/delete handlers become async:

```tsx
export function TrackCard({ track }: { track: Track }) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(track.title);
  const [error, setError] = useState<string | null>(null);

  const run = (label: string, fn: () => Promise<void>) =>
    startTransition(async () => {
      setError(null);
      try {
        await fn();
      } catch {
        setError(`Couldn't ${label} — try again.`);
      }
    });

  return (
    <div className="flex items-center gap-4 rounded-xl bg-slate-900 p-3">
      <label className="relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-slate-800">
        {track.artworkUrl ? (
          <Image src={track.artworkUrl} alt="" fill className="object-cover" sizes="64px" />
        ) : (
          <span className="flex h-full items-center justify-center text-2xl">🎧</span>
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const formData = new FormData();
            formData.set("artwork", file);
            run("replace the artwork", () => replaceArtwork(track.id, formData));
          }}
        />
      </label>
      <div className="min-w-0 flex-1 space-y-1">
        <input
          value={title}
          aria-label="Track title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== track.title) {
              run("rename the track", () => updateTrack(track.id, { title: title.trim() }));
            }
          }}
          className="w-full rounded bg-transparent text-slate-100 outline-none focus:bg-slate-800 px-1"
        />
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <select
            value={track.kind}
            aria-label="Track kind"
            onChange={(e) =>
              run("change the kind", () =>
                updateTrack(track.id, { kind: e.target.value as Track["kind"] }),
              )
            }
            className="rounded bg-slate-800 px-1 py-0.5"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <span>{formatDuration(track.durationSec)}</span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>
      <button
        disabled={pending}
        onClick={() => {
          if (confirm(`Delete "${track.title}"?`)) {
            run("delete the track", () => deleteTrack(track.id));
          }
        }}
        className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-800 hover:text-rose-300 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Surface upload-phase errors distinctly**

In `upload-form.tsx`, split the single `"error"` state so the user can tell which phase failed. Change the `FileStatus` type and catch block:

```ts
type FileStatus = {
  id: number;
  name: string;
  state: "uploading" | "saving" | "done" | "upload-error" | "save-error";
  pct: number;
};
```

In `handleFiles`, wrap the two phases separately:

```ts
      try {
        const clientDurationSec = await measureDuration(file);
        const blob = await upload(`audio/${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          onUploadProgress: ({ percentage }) => update({ pct: Math.round(percentage) }),
        });
        update({ state: "saving", pct: 100 });
        try {
          await finalizeTrack({ url: blob.url, filename: file.name, clientDurationSec });
        } catch {
          update({ state: "save-error" });
          continue;
        }
        update({ state: "done" });
        router.refresh();
      } catch {
        update({ state: "upload-error" });
      }
```

And render the two failure states in the status list (replace the final ternary arm):

```tsx
              : s.state === "done"
                ? "✓ added"
                : s.state === "save-error"
                  ? "✗ uploaded but couldn't save — try again"
                  : "✗ upload failed"}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → clean. Run: `npm run lint` → clean. With `npm run dev` running: stop the dev DB (or temporarily rename `DATABASE_URL` in `.env.local` and restart) → rename a track → red `Couldn't rename the track — try again.` appears. Restore `.env.local`.

- [ ] **Step 6: Commit**

```powershell
git add app/api/upload/route.ts app/parent/_components
git commit -m "fix: m4b uploads, duration-probe timeout, surfaced mutation errors"
```

---

### Task 4: `requireFamily()` + tonight-playlist and resume server actions

**Files:**
- Modify: `lib/auth-server.ts` (add `requireFamily`)
- Create: `lib/playlists.ts`
- Create: `app/actions.ts` (kid-facing server actions)

**Interfaces:**
- Consumes: `db`, schema tables, `FAMILY_COOKIE`/`isValidFamilyToken`, `requiredEnv`.
- Produces (used by Tasks 7–9):
  - `requireFamily(): Promise<void>` from `@/lib/auth-server` — throws `Not authorized` without a valid family cookie.
  - `TONIGHT_NAME = "tonight"`, `TONIGHT_MAX_ITEMS = 6` from `@/lib/playlists`.
  - `getOrCreateTonight(): Promise<{ id: number; name: string; loop: boolean }>` — race-safe via `onConflictDoNothing`; `playlists.name` now has a unique index `playlists_name_unique`.
  - `getTonightLineup(): Promise<{ playlist: { id: number; loop: boolean }; items: TonightItem[] }>` where `TonightItem = { itemId: number; sortOrder: number; loopCount: number | null; track: typeof tracks.$inferSelect }`
  - Server actions from `@/app/actions`: `addToTonight(trackId: number): Promise<void>`, `removeTonightItem(itemId: number): Promise<void>`, `clearTonight(): Promise<void>`, `saveResume(trackId: number, positionSec: number): Promise<void>`, `clearResume(trackId: number): Promise<void>`.

- [ ] **Step 1: Add `requireFamily` to `lib/auth-server.ts`**

```ts
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
```

- [ ] **Step 2: Create `lib/playlists.ts`** (server-side data access; no `next/headers` so it stays importable anywhere on the server)

```ts
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { playlistItems, playlists, tracks } from "@/lib/db/schema";

export const TONIGHT_NAME = "tonight";
export const TONIGHT_MAX_ITEMS = 6;

export type TonightItem = {
  itemId: number;
  sortOrder: number;
  loopCount: number | null;
  track: typeof tracks.$inferSelect;
};

export async function getOrCreateTonight() {
  const [existing] = await db
    .select()
    .from(playlists)
    .where(eq(playlists.name, TONIGHT_NAME));
  if (existing) return existing;
  const [created] = await db
    .insert(playlists)
    .values({ name: TONIGHT_NAME })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db
    .select()
    .from(playlists)
    .where(eq(playlists.name, TONIGHT_NAME));
  // Invariant: the insert only reaches onConflictDoNothing when a concurrent
  // insert won the race, so a row with this name must now exist.
  return row!;
}

export async function getTonightLineup(): Promise<{
  playlist: { id: number; loop: boolean };
  items: TonightItem[];
}> {
  const playlist = await getOrCreateTonight();
  const rows = await db
    .select({
      itemId: playlistItems.id,
      sortOrder: playlistItems.sortOrder,
      loopCount: playlistItems.loopCount,
      track: tracks,
    })
    .from(playlistItems)
    .innerJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .where(eq(playlistItems.playlistId, playlist.id))
    .orderBy(asc(playlistItems.sortOrder));
  return { playlist: { id: playlist.id, loop: playlist.loop }, items: rows };
}
```

- [ ] **Step 3: Create `app/actions.ts`**

```ts
"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { playbackState, playlistItems, tracks } from "@/lib/db/schema";
import { getOrCreateTonight, TONIGHT_MAX_ITEMS } from "@/lib/playlists";

export async function addToTonight(trackId: number): Promise<void> {
  await requireFamily();
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track) return;
  const tonight = await getOrCreateTonight();
  const [{ count, maxSort }] = await db
    .select({
      count: sql<number>`count(*)::int`,
      maxSort: sql<number>`coalesce(max(${playlistItems.sortOrder}), 0)::int`,
    })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, tonight.id));
  if (count >= TONIGHT_MAX_ITEMS) return;
  await db.insert(playlistItems).values({
    playlistId: tonight.id,
    trackId,
    sortOrder: maxSort + 1,
  });
  revalidatePath("/");
}

export async function removeTonightItem(itemId: number): Promise<void> {
  await requireFamily();
  const tonight = await getOrCreateTonight();
  await db
    .delete(playlistItems)
    .where(
      and(eq(playlistItems.id, itemId), eq(playlistItems.playlistId, tonight.id)),
    );
  revalidatePath("/");
}

export async function clearTonight(): Promise<void> {
  await requireFamily();
  const tonight = await getOrCreateTonight();
  await db.delete(playlistItems).where(eq(playlistItems.playlistId, tonight.id));
  revalidatePath("/");
}

export async function saveResume(trackId: number, positionSec: number): Promise<void> {
  await requireFamily();
  if (!Number.isFinite(positionSec) || positionSec < 0) return;
  await db
    .insert(playbackState)
    .values({ trackId, positionSec, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: playbackState.trackId,
      set: { positionSec, updatedAt: new Date() },
    });
}

export async function clearResume(trackId: number): Promise<void> {
  await requireFamily();
  await db.delete(playbackState).where(eq(playbackState.trackId, trackId));
}
```

(`saveResume`/`clearResume` deliberately skip `revalidatePath` — they fire every ~10s during playback and must not churn the page cache.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → clean. Run: `npm run lint` → clean. Run: `npm test` → still passing (no new unit tests here — these are DB-bound and covered by the Task 11 e2e).

- [ ] **Step 5: Commit**

```powershell
git add lib/auth-server.ts lib/playlists.ts app/actions.ts
git commit -m "feat: family-gated tonight-playlist and resume server actions"
```

---

### Task 5: Pure playback logic (`lib/audio/logic.ts`, TDD)

**Files:**
- Create: `lib/audio/logic.ts`
- Test: `lib/audio/logic.test.ts`

**Interfaces:**
- Consumes: nothing (pure module — no DOM, no DB).
- Produces (used by Tasks 6, 7, 9):
  - `type EngineState = "idle" | "armed" | "playing" | "fading" | "ambient" | "stopped"`
  - `type LineupEntry = { trackId: number; title: string; audioUrl: string; artworkUrl: string | null; kind: "story" | "song" | "ambient"; durationSec: number | null; loopCount: number | null }`
  - `type PlayPosition = { index: number; loopsDone: number }`
  - `msUntilStart(now: Date, startTime: string): number` — ms to the next occurrence of `"HH:MM"` local (tomorrow if already past; `0` is never returned — a passed time maps to tomorrow).
  - `isWithinCatchUp(now: Date, startTime: string, graceMinutes?: number): boolean` — true if `startTime` occurred within the last `graceMinutes` (default 90).
  - `nextPosition(pos: PlayPosition, lineup: { loopCount: number | null }[], lineupLoop: boolean): PlayPosition | "end"` — decides what happens when the current item's audio ends. `loopCount` null → play once; `-1` → repeat forever; `n > 0` → play n times total.
  - `fadeCurve(from: number, to: number, steps?: number): Float32Array` — cosine-eased gain curve for `setValueCurveAtTime` (default 64 steps).
  - `shouldPersistResume(kind: string, durationSec: number | null): boolean` — only `story` ≥ 600s.
  - `resumeStartPosition(savedSec: number | null | undefined, durationSec: number | null): number` — where to start a resumable track: `0` unless the saved position is >30s in and (duration unknown or) >30s from the end.

- [ ] **Step 1: Write the failing tests**

Create `lib/audio/logic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  fadeCurve,
  isWithinCatchUp,
  msUntilStart,
  nextPosition,
  resumeStartPosition,
  shouldPersistResume,
} from "@/lib/audio/logic";

const at = (h: number, m: number, s = 0) => new Date(2026, 6, 21, h, m, s);

describe("msUntilStart", () => {
  it("counts down to a start later today", () => {
    expect(msUntilStart(at(20, 0), "20:30")).toBe(30 * 60 * 1000);
  });

  it("rolls to tomorrow when the time has passed", () => {
    expect(msUntilStart(at(21, 0), "20:30")).toBe(23.5 * 60 * 60 * 1000);
  });

  it("rolls to tomorrow at the exact start minute", () => {
    expect(msUntilStart(at(20, 30), "20:30")).toBe(24 * 60 * 60 * 1000);
  });
});

describe("isWithinCatchUp", () => {
  it("is false before the start time", () => {
    expect(isWithinCatchUp(at(20, 0), "20:30")).toBe(false);
  });

  it("is true shortly after the start time", () => {
    expect(isWithinCatchUp(at(20, 45), "20:30")).toBe(true);
  });

  it("is false once the grace window has passed", () => {
    expect(isWithinCatchUp(at(22, 1), "20:30", 90)).toBe(false);
  });
});

describe("nextPosition", () => {
  const once = { loopCount: null };
  const twice = { loopCount: 2 };
  const forever = { loopCount: -1 };

  it("advances to the next item after a play-once item", () => {
    expect(nextPosition({ index: 0, loopsDone: 1 }, [once, once], false)).toEqual({
      index: 1,
      loopsDone: 0,
    });
  });

  it("repeats an item until its loop count is used up", () => {
    expect(nextPosition({ index: 0, loopsDone: 1 }, [twice, once], false)).toEqual({
      index: 0,
      loopsDone: 1,
    });
    expect(nextPosition({ index: 0, loopsDone: 2 }, [twice, once], false)).toEqual({
      index: 1,
      loopsDone: 0,
    });
  });

  it("repeats forever on loopCount -1", () => {
    expect(nextPosition({ index: 0, loopsDone: 99 }, [forever], false)).toEqual({
      index: 0,
      loopsDone: 99,
    });
  });

  it("ends after the last item without lineup loop", () => {
    expect(nextPosition({ index: 1, loopsDone: 1 }, [once, once], false)).toBe("end");
  });

  it("wraps to the first item with lineup loop", () => {
    expect(nextPosition({ index: 1, loopsDone: 1 }, [once, once], true)).toEqual({
      index: 0,
      loopsDone: 0,
    });
  });
});

describe("fadeCurve", () => {
  it("starts and ends at the endpoints", () => {
    const curve = fadeCurve(0, 1);
    expect(curve[0]).toBeCloseTo(0, 5);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 5);
  });

  it("is monotonic downward for a fade-out", () => {
    const curve = fadeCurve(1, 0, 32);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeLessThanOrEqual(curve[i - 1]);
    }
  });
});

describe("shouldPersistResume", () => {
  it("persists only long stories", () => {
    expect(shouldPersistResume("story", 1200)).toBe(true);
    expect(shouldPersistResume("story", 300)).toBe(false);
    expect(shouldPersistResume("story", null)).toBe(false);
    expect(shouldPersistResume("song", 1200)).toBe(false);
  });
});

describe("resumeStartPosition", () => {
  it("resumes mid-story", () => {
    expect(resumeStartPosition(500, 1200)).toBe(500);
  });

  it("restarts when there is no saved position", () => {
    expect(resumeStartPosition(null, 1200)).toBe(0);
    expect(resumeStartPosition(undefined, 1200)).toBe(0);
  });

  it("restarts near the beginning or the end", () => {
    expect(resumeStartPosition(10, 1200)).toBe(0);
    expect(resumeStartPosition(1190, 1200)).toBe(0);
  });

  it("resumes when duration is unknown but position is meaningful", () => {
    expect(resumeStartPosition(500, null)).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/audio/logic'`.

- [ ] **Step 3: Implement `lib/audio/logic.ts`**

```ts
export type EngineState =
  | "idle"
  | "armed"
  | "playing"
  | "fading"
  | "ambient"
  | "stopped";

export type LineupEntry = {
  trackId: number;
  title: string;
  audioUrl: string;
  artworkUrl: string | null;
  kind: "story" | "song" | "ambient";
  durationSec: number | null;
  loopCount: number | null;
};

export type PlayPosition = { index: number; loopsDone: number };

function startDateFor(now: Date, startTime: string): Date {
  const [h, m] = startTime.split(":").map(Number);
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  return start;
}

export function msUntilStart(now: Date, startTime: string): number {
  const start = startDateFor(now, startTime);
  if (start.getTime() <= now.getTime()) {
    start.setDate(start.getDate() + 1);
  }
  return start.getTime() - now.getTime();
}

export function isWithinCatchUp(
  now: Date,
  startTime: string,
  graceMinutes = 90,
): boolean {
  const start = startDateFor(now, startTime);
  const elapsedMs = now.getTime() - start.getTime();
  return elapsedMs > 0 && elapsedMs <= graceMinutes * 60 * 1000;
}

export function nextPosition(
  pos: PlayPosition,
  lineup: { loopCount: number | null }[],
  lineupLoop: boolean,
): PlayPosition | "end" {
  const current = lineup[pos.index];
  if (current) {
    const target = current.loopCount ?? 1;
    if (target === -1 || pos.loopsDone < target) {
      return { index: pos.index, loopsDone: pos.loopsDone };
    }
  }
  const next = pos.index + 1;
  if (next < lineup.length) return { index: next, loopsDone: 0 };
  if (lineupLoop && lineup.length > 0) return { index: 0, loopsDone: 0 };
  return "end";
}

export function fadeCurve(from: number, to: number, steps = 64): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const eased = (1 - Math.cos(Math.PI * t)) / 2;
    curve[i] = from + (to - from) * eased;
  }
  return curve;
}

export function shouldPersistResume(
  kind: string,
  durationSec: number | null,
): boolean {
  return kind === "story" && durationSec !== null && durationSec >= 600;
}

export function resumeStartPosition(
  savedSec: number | null | undefined,
  durationSec: number | null,
): number {
  if (savedSec == null || savedSec <= 30) return 0;
  if (durationSec !== null && savedSec >= durationSec - 30) return 0;
  return savedSec;
}
```

Note on `nextPosition` semantics: the engine calls it with `loopsDone` already incremented for the play that just finished. `loopsDone < target` means "play it again"; the returned position being identical to the input means "replay current item".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all suites.

- [ ] **Step 5: Commit**

```powershell
git add lib/audio
git commit -m "feat: pure playback scheduling, loop, fade, and resume logic"
```

---

### Task 6: Playback engine (`lib/audio/engine.ts`)

**Files:**
- Create: `lib/audio/engine.ts`

**Interfaces:**
- Consumes: everything from `./logic` (Task 5).
- Produces (used by Tasks 7 and 9):
  - `type EngineSnapshot = { state: EngineState; index: number; entry: LineupEntry | null; secondsToStart: number | null; paused: boolean }`
  - `type EngineCallbacks = { onSnapshot: (snap: EngineSnapshot) => void; onResumeTick: (trackId: number, positionSec: number) => void; onTrackDone: (trackId: number) => void }`
  - `class BedtimeEngine` with: `constructor(cb: EngineCallbacks)`, `load(opts: { lineup: LineupEntry[]; lineupLoop: boolean; fadeSeconds: number; ambient: LineupEntry | null; resume: Record<number, number> })`, `arm(startTime: string, hardStopTime: string | null): void`, `startNow(): void`, `disarm(): void`, `togglePause(): void`, `skip(): void`, `stop(opts?: { fade?: boolean }): void`, `destroy(): void`, `get paused(): boolean`.
- Client-only module (touches `Audio`/`AudioContext`); it is only ever constructed inside client components. No unit tests — the pure decisions live in `logic.ts`; the DOM wiring is covered by the Task 11 e2e and real-device checks.

Key implementation constraints baked into the code below:
- **All volume changes via GainNode** (`setValueCurveAtTime` with `fadeCurve`) — never `audio.volume` (read-only on iOS).
- **`audio.crossOrigin = "anonymous"`** is REQUIRED: the blob store is a different origin, and a `MediaElementAudioSourceNode` over non-CORS media plays silence.
- The `AudioContext` is created lazily inside `arm()`/`startNow()` (both are called from a tap) so the autoplay policy is satisfied, and `ctx.resume()` is always awaited.
- Audio `error` events skip to the next item silently (bedtime rule: no alerts).

- [ ] **Step 1: Create `lib/audio/engine.ts`**

```ts
import {
  fadeCurve,
  msUntilStart,
  nextPosition,
  resumeStartPosition,
  shouldPersistResume,
  type EngineState,
  type LineupEntry,
  type PlayPosition,
} from "./logic";

export type EngineSnapshot = {
  state: EngineState;
  index: number;
  entry: LineupEntry | null;
  secondsToStart: number | null;
  paused: boolean;
};

export type EngineCallbacks = {
  onSnapshot: (snap: EngineSnapshot) => void;
  onResumeTick: (trackId: number, positionSec: number) => void;
  onTrackDone: (trackId: number) => void;
};

const AMBIENT_GAIN = 0.35;
const PAUSE_FADE_SEC = 0.4;
const AMBIENT_FADE_SEC = 4;
const RESUME_TICK_MS = 10_000;

type LoadOptions = {
  lineup: LineupEntry[];
  lineupLoop: boolean;
  fadeSeconds: number;
  ambient: LineupEntry | null;
  resume: Record<number, number>;
};

export class BedtimeEngine {
  private cb: EngineCallbacks;
  private audio: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;

  private opts: LoadOptions = {
    lineup: [],
    lineupLoop: false,
    fadeSeconds: 30,
    ambient: null,
    resume: {},
  };

  private state: EngineState = "idle";
  private pos: PlayPosition = { index: 0, loopsDone: 0 };
  private secondsToStart: number | null = null;
  private inAmbient = false;

  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private startTimeout: ReturnType<typeof setTimeout> | null = null;
  private hardStopTimeout: ReturnType<typeof setTimeout> | null = null;
  private resumeInterval: ReturnType<typeof setInterval> | null = null;
  private fadeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(cb: EngineCallbacks) {
    this.cb = cb;
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";
    // Not in the DOM; exposed for the e2e harness and console debugging.
    (window as unknown as { __bedtimeAudio?: HTMLAudioElement }).__bedtimeAudio =
      this.audio;
    this.audio.addEventListener("ended", () => this.handleEnded());
    this.audio.addEventListener("error", () => this.advance(true));
  }

  load(opts: LoadOptions): void {
    this.opts = opts;
  }

  get paused(): boolean {
    return this.audio.paused;
  }

  private emit(): void {
    const entry = this.inAmbient
      ? this.opts.ambient
      : (this.opts.lineup[this.pos.index] ?? null);
    this.cb.onSnapshot({
      state: this.state,
      index: this.pos.index,
      entry,
      secondsToStart: this.secondsToStart,
      paused: this.audio.paused,
    });
  }

  private setState(state: EngineState): void {
    this.state = state;
    this.emit();
  }

  private ensureContext(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctx();
    const source = this.ctx.createMediaElementSource(this.audio);
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    source.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    void this.ctx.resume();
  }

  private fadeTo(target: number, seconds: number, done?: () => void): void {
    if (!this.ctx || !this.gain) return;
    if (this.fadeTimeout) clearTimeout(this.fadeTimeout);
    const g = this.gain.gain;
    const current = g.value;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(current, this.ctx.currentTime);
    const secs = Math.max(seconds, 0.05);
    g.setValueCurveAtTime(fadeCurve(current, target), this.ctx.currentTime, secs);
    if (done) this.fadeTimeout = setTimeout(done, secs * 1000);
  }

  private playEntry(entry: LineupEntry, fadeInSec: number, targetGain: number): void {
    const startAt = shouldPersistResume(entry.kind, entry.durationSec)
      ? resumeStartPosition(this.opts.resume[entry.trackId], entry.durationSec)
      : 0;
    this.audio.loop = this.inAmbient;
    this.audio.src = entry.audioUrl;
    if (startAt > 0) {
      this.audio.addEventListener(
        "loadedmetadata",
        () => {
          this.audio.currentTime = startAt;
        },
        { once: true },
      );
    }
    void this.audio.play().then(() => this.fadeTo(targetGain, fadeInSec));
  }

  private startResumeTicks(): void {
    if (this.resumeInterval) return;
    this.resumeInterval = setInterval(() => {
      const entry = this.opts.lineup[this.pos.index];
      if (
        this.state === "playing" &&
        !this.inAmbient &&
        entry &&
        !this.audio.paused &&
        shouldPersistResume(entry.kind, entry.durationSec)
      ) {
        this.cb.onResumeTick(entry.trackId, Math.floor(this.audio.currentTime));
      }
    }, RESUME_TICK_MS);
  }

  private clearTimers(): void {
    for (const t of [this.countdownInterval, this.resumeInterval]) {
      if (t) clearInterval(t);
    }
    for (const t of [this.startTimeout, this.hardStopTimeout, this.fadeTimeout]) {
      if (t) clearTimeout(t);
    }
    this.countdownInterval = null;
    this.resumeInterval = null;
    this.startTimeout = null;
    this.hardStopTimeout = null;
    this.fadeTimeout = null;
  }

  arm(startTime: string, hardStopTime: string | null): void {
    this.ensureContext();
    this.clearTimers();
    this.inAmbient = false;
    this.pos = { index: 0, loopsDone: 0 };
    const tick = () => {
      this.secondsToStart = Math.round(msUntilStart(new Date(), startTime) / 1000);
      this.emit();
    };
    this.countdownInterval = setInterval(tick, 1000);
    this.startTimeout = setTimeout(
      () => this.startNow(hardStopTime),
      msUntilStart(new Date(), startTime),
    );
    this.setState("armed");
    tick();
  }

  disarm(): void {
    this.clearTimers();
    this.secondsToStart = null;
    this.setState("idle");
  }

  startNow(hardStopTime: string | null = null): void {
    if (this.opts.lineup.length === 0) return;
    this.ensureContext();
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    if (this.startTimeout) clearTimeout(this.startTimeout);
    this.countdownInterval = null;
    this.startTimeout = null;
    this.secondsToStart = null;
    this.inAmbient = false;
    this.pos = { index: 0, loopsDone: 0 };
    if (hardStopTime) {
      this.hardStopTimeout = setTimeout(
        () => this.stop({ fade: true }),
        msUntilStart(new Date(), hardStopTime),
      );
    }
    this.startResumeTicks();
    this.setState("playing");
    this.playEntry(this.opts.lineup[0], Math.min(this.opts.fadeSeconds, 10), 1);
  }

  private handleEnded(): void {
    if (this.state === "fading" || this.state === "stopped") return;
    if (this.inAmbient) return; // ambient loops via audio.loop
    const entry = this.opts.lineup[this.pos.index];
    this.pos = { ...this.pos, loopsDone: this.pos.loopsDone + 1 };
    const next = nextPosition(this.pos, this.opts.lineup, this.opts.lineupLoop);
    const finishedItem = next === "end" || next.index !== this.pos.index;
    if (entry && finishedItem) this.cb.onTrackDone(entry.trackId);
    this.applyNext(next);
  }

  private advance(force: boolean): void {
    if (this.state === "fading" || this.state === "stopped") return;
    if (this.inAmbient) {
      this.stop({ fade: false });
      return;
    }
    const next = force
      ? this.pos.index + 1 < this.opts.lineup.length
        ? { index: this.pos.index + 1, loopsDone: 0 }
        : this.opts.lineupLoop && this.opts.lineup.length > 0
          ? { index: 0, loopsDone: 0 }
          : ("end" as const)
      : nextPosition(this.pos, this.opts.lineup, this.opts.lineupLoop);
    this.applyNext(next);
  }

  private applyNext(next: PlayPosition | "end"): void {
    if (next === "end") {
      if (this.opts.ambient) {
        this.inAmbient = true;
        this.setState("ambient");
        this.playEntry(this.opts.ambient, AMBIENT_FADE_SEC, AMBIENT_GAIN);
      } else {
        this.stop({ fade: false });
      }
      return;
    }
    this.pos = next;
    this.setState("playing");
    this.playEntry(this.opts.lineup[next.index], 0.5, 1);
  }

  skip(): void {
    this.advance(true);
  }

  togglePause(): void {
    if (this.audio.paused) {
      this.ensureContext();
      void this.audio.play().then(() =>
        this.fadeTo(this.inAmbient ? AMBIENT_GAIN : 1, PAUSE_FADE_SEC),
      );
      this.emit();
    } else {
      this.fadeTo(0, PAUSE_FADE_SEC, () => {
        this.audio.pause();
        this.emit();
      });
    }
  }

  stop(opts: { fade?: boolean } = {}): void {
    const finish = () => {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.inAmbient = false;
      this.clearTimers();
      this.secondsToStart = null;
      this.setState("stopped");
    };
    if (opts.fade && this.state === "playing") {
      this.setState("fading");
      this.fadeTo(0, this.opts.fadeSeconds, finish);
    } else {
      finish();
    }
  }

  destroy(): void {
    this.clearTimers();
    this.audio.pause();
    this.audio.removeAttribute("src");
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.gain = null;
  }
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` → clean. Run: `npm run lint` → clean.

- [ ] **Step 3: Commit**

```powershell
git add lib/audio/engine.ts
git commit -m "feat: GainNode playback engine with arming, loops, ambient, hard stop"
```

---

### Task 7: Kid shelf + tonight's lineup UI

**Files:**
- Create: `lib/lineup.ts` (client-safe consts + mapper — **must not** import `lib/db`)
- Test: `lib/lineup.test.ts`
- Modify: `lib/playlists.ts` (consts move to `lib/lineup.ts`)
- Create: `app/_components/shelf.tsx`
- Modify: `app/page.tsx` (replace placeholder with data-loading server component)

**Interfaces:**
- Consumes: kid actions from `@/app/actions` (Task 4), `getTonightLineup` (Task 4), `LineupEntry` type (Task 5).
- Produces (used by Tasks 8–9, 11):
  - `TONIGHT_NAME`, `TONIGHT_MAX_ITEMS` re-homed to `@/lib/lineup` (client-safe; `lib/playlists.ts` re-exports them so `app/actions.ts` keeps compiling unchanged).
  - `toLineupEntry(track: { id: number; title: string; kind: "story" | "song" | "ambient"; audioUrl: string; artworkUrl: string | null; durationSec: number | null }, loopCount: number | null): LineupEntry`
  - `<Shelf tracks lineup schedule ambient resume />` client component rendered by `app/page.tsx`. The big Play button and "Tonight at H:MM" arm affordance render in this task but are inert (`onClick` stubs) — Task 8 wires them to the engine. Data test hooks for e2e: the grid has `data-testid="shelf-grid"`, tiles `data-testid="shelf-tile"`, lineup covers `data-testid="lineup-item"`, play button `data-testid="play-button"`.

**IMPORTANT bundle-boundary rule:** `shelf.tsx` is a client component. It may `import type` from `@/lib/playlists` / `@/lib/db/schema` (types are erased), but runtime imports must only come from `@/lib/lineup`, `@/lib/audio/*`, and `@/app/actions` — never from `@/lib/playlists` or `@/lib/db` (those pull the Neon driver and `requiredEnv("DATABASE_URL")` into the browser bundle, which crashes).

- [ ] **Step 1: Write the failing test for the mapper**

Create `lib/lineup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toLineupEntry, TONIGHT_MAX_ITEMS, TONIGHT_NAME } from "@/lib/lineup";

describe("lineup consts", () => {
  it("exposes the reserved playlist name and cap", () => {
    expect(TONIGHT_NAME).toBe("tonight");
    expect(TONIGHT_MAX_ITEMS).toBe(6);
  });
});

describe("toLineupEntry", () => {
  const track = {
    id: 7,
    title: "The Gruffalo",
    kind: "story" as const,
    audioUrl: "https://x.public.blob.vercel-storage.com/a.mp3",
    artworkUrl: null,
    durationSec: 754,
  };

  it("maps a track row plus loop count into a LineupEntry", () => {
    expect(toLineupEntry(track, 2)).toEqual({
      trackId: 7,
      title: "The Gruffalo",
      kind: "story",
      audioUrl: "https://x.public.blob.vercel-storage.com/a.mp3",
      artworkUrl: null,
      durationSec: 754,
      loopCount: 2,
    });
  });

  it("defaults loopCount to null", () => {
    expect(toLineupEntry(track, null).loopCount).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` → FAIL — `Cannot find module '@/lib/lineup'`.

- [ ] **Step 3: Create `lib/lineup.ts` and slim `lib/playlists.ts`**

`lib/lineup.ts`:

```ts
import type { LineupEntry } from "@/lib/audio/logic";

export const TONIGHT_NAME = "tonight";
export const TONIGHT_MAX_ITEMS = 6;

export function toLineupEntry(
  track: {
    id: number;
    title: string;
    kind: "story" | "song" | "ambient";
    audioUrl: string;
    artworkUrl: string | null;
    durationSec: number | null;
  },
  loopCount: number | null,
): LineupEntry {
  return {
    trackId: track.id,
    title: track.title,
    kind: track.kind,
    audioUrl: track.audioUrl,
    artworkUrl: track.artworkUrl,
    durationSec: track.durationSec,
    loopCount,
  };
}
```

In `lib/playlists.ts`, delete the two const declarations and add at the top:

```ts
import { TONIGHT_NAME } from "./lineup";

export { TONIGHT_MAX_ITEMS, TONIGHT_NAME } from "./lineup";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → PASS.

- [ ] **Step 5: Replace `app/page.tsx`**

```tsx
import { asc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { playbackState, schedule, tracks } from "@/lib/db/schema";
import { getTonightLineup } from "@/lib/playlists";
import { Shelf } from "./_components/shelf";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [shelfTracks, lineup, scheduleRows, resumeRows] = await Promise.all([
    db
      .select()
      .from(tracks)
      .where(ne(tracks.kind, "ambient"))
      .orderBy(asc(tracks.title)),
    getTonightLineup(),
    db.select().from(schedule),
    db.select().from(playbackState),
  ]);
  const scheduleRow = scheduleRows[0] ?? null;
  const ambient = scheduleRow?.ambientTrackId
    ? ((
        await db
          .select()
          .from(tracks)
          .where(eq(tracks.id, scheduleRow.ambientTrackId))
      )[0] ?? null)
    : null;
  const resume = Object.fromEntries(
    resumeRows.map((r) => [r.trackId, r.positionSec]),
  ) as Record<number, number>;
  return (
    <Shelf
      tracks={shelfTracks}
      lineup={lineup}
      schedule={scheduleRow}
      ambient={ambient}
      resume={resume}
    />
  );
}
```

- [ ] **Step 6: Create `app/_components/shelf.tsx`**

```tsx
"use client";

import Image from "next/image";
import { useTransition } from "react";
import { addToTonight, clearTonight, removeTonightItem } from "@/app/actions";
import { TONIGHT_MAX_ITEMS } from "@/lib/lineup";
import type { TonightItem } from "@/lib/playlists";
import type { schedule, tracks } from "@/lib/db/schema";

type Track = typeof tracks.$inferSelect;
type ScheduleRow = typeof schedule.$inferSelect;

export type ShelfProps = {
  tracks: Track[];
  lineup: { playlist: { id: number; loop: boolean }; items: TonightItem[] };
  schedule: ScheduleRow | null;
  ambient: Track | null;
  resume: Record<number, number>;
};

function Cover({ track, sizes }: { track: Pick<Track, "artworkUrl" | "title">; sizes: string }) {
  return track.artworkUrl ? (
    <Image
      src={track.artworkUrl}
      alt=""
      fill
      sizes={sizes}
      className="object-cover"
    />
  ) : (
    <span className="flex h-full w-full items-center justify-center bg-indigo-800 text-4xl">
      🎧
    </span>
  );
}

export function Shelf({ tracks, lineup, schedule }: ShelfProps) {
  const [, startTransition] = useTransition();
  const full = lineup.items.length >= TONIGHT_MAX_ITEMS;

  return (
    <main className="min-h-dvh bg-indigo-950 pb-44">
      <header className="flex items-center justify-between px-5 pt-6 pb-2">
        <h1 className="text-2xl font-bold text-amber-100">🌙 Tonight&apos;s stories</h1>
      </header>

      <div data-testid="shelf-grid" className="grid grid-cols-2 gap-4 px-5">
        {tracks.map((track) => (
          <button
            key={track.id}
            data-testid="shelf-tile"
            disabled={full}
            onClick={() => startTransition(() => addToTonight(track.id))}
            className="group text-left transition-transform active:scale-90 disabled:opacity-40"
          >
            <span className="relative block aspect-square overflow-hidden rounded-3xl shadow-lg shadow-indigo-950/60">
              <Cover track={track} sizes="(max-width: 640px) 50vw, 300px" />
            </span>
            <span className="mt-2 block truncate px-1 text-base font-semibold text-indigo-100">
              {track.title}
            </span>
          </button>
        ))}
        {tracks.length === 0 && (
          <p className="col-span-2 mt-16 text-center text-indigo-300">
            No stories yet — ask a grown-up to add some.
          </p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-indigo-800 bg-indigo-900/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex min-h-16 flex-1 items-center gap-2 overflow-x-auto">
            {lineup.items.length === 0 && (
              <p className="text-sm text-indigo-300">
                Tap a cover to pick tonight&apos;s stories
              </p>
            )}
            {lineup.items.map((item) => (
              <button
                key={item.itemId}
                data-testid="lineup-item"
                onClick={() => startTransition(() => removeTonightItem(item.itemId))}
                className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl ring-2 ring-amber-300/70 transition-transform active:scale-90"
              >
                <Cover track={item.track} sizes="56px" />
              </button>
            ))}
            {lineup.items.length > 1 && (
              <button
                onClick={() => startTransition(() => clearTonight())}
                className="shrink-0 px-2 text-xs text-indigo-300"
              >
                start over
              </button>
            )}
          </div>
          <button
            data-testid="play-button"
            disabled={lineup.items.length === 0}
            onClick={() => {}}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-amber-300 text-3xl text-indigo-950 shadow-lg transition-transform active:scale-90 disabled:opacity-40"
            aria-label="Play tonight's stories"
          >
            ▶
          </button>
        </div>
        {schedule?.enabled && lineup.items.length > 0 && (
          <p className="mt-2 text-center text-sm text-amber-200/80">
            Tonight at {schedule.startTime}
          </p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Verify in the browser**

Run: `npx tsc --noEmit` → clean. Run: `npm run lint` → clean. With `npm run dev` and at least two uploaded tracks: `/` shows the 2-col artwork grid; tapping a tile adds its cover to the bottom strip (with the press animation); tapping a lineup cover removes it; a 7th add is a no-op (cap 6, tiles disabled at cap); "start over" clears; play button enables with ≥1 item (does nothing yet — wired in Task 8). Confirm the browser console has NO errors about `DATABASE_URL` (bundle-boundary rule above).

- [ ] **Step 8: Commit**

```powershell
git add lib/lineup.ts lib/lineup.test.ts lib/playlists.ts app/page.tsx app/_components
git commit -m "feat: kid shelf with artwork grid and tonight lineup strip"
```

---

### Task 8: Player overlay — armed/countdown screen, night screen, wake lock, media session, resume wiring

**Files:**
- Create: `app/_components/player.tsx`
- Modify: `app/_components/shelf.tsx` (engine plumbing + wire play/arm/catch-up)

**Interfaces:**
- Consumes: `BedtimeEngine`/`EngineSnapshot` (Task 6), `isWithinCatchUp` + `LineupEntry` (Task 5), `toLineupEntry` (Task 7), `saveResume`/`clearResume` (Task 4).
- Produces: the full kid playback experience. E2E hooks: `data-testid` values `night-screen`, `pause-button`, `skip-button`, `all-done`, `countdown`, `start-now`, `catch-up-banner`.
- **Gesture rule:** the `AudioContext` only unlocks inside a real tap's call stack, so the engine is created and `startNow()`/`arm()` are called **synchronously in the Shelf's click handlers** — never from a `useEffect`. `Player` is a purely presentational overlay that receives the live engine + latest snapshot.

- [ ] **Step 1: Create `app/_components/player.tsx`**

```tsx
"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { BedtimeEngine, EngineSnapshot } from "@/lib/audio/engine";
import type { schedule } from "@/lib/db/schema";

type ScheduleRow = typeof schedule.$inferSelect;

type PlayerProps = {
  engine: BedtimeEngine;
  snap: EngineSnapshot;
  schedule: ScheduleRow | null;
  covers: { itemId: number; title: string; artworkUrl: string | null }[];
  onExit: () => void;
};

function formatCountdown(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function Player({ engine, snap, schedule, covers, onExit }: PlayerProps) {
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      );
    tick();
    const interval = setInterval(tick, 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (snap.entry) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: snap.entry.title,
        artist: "Bedtime Reader",
        artwork: snap.entry.artworkUrl ? [{ src: snap.entry.artworkUrl }] : [],
      });
    }
    navigator.mediaSession.setActionHandler("play", () => engine.togglePause());
    navigator.mediaSession.setActionHandler("pause", () => engine.togglePause());
    navigator.mediaSession.setActionHandler("nexttrack", () => engine.skip());
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    };
  }, [snap.entry, engine]);

  useEffect(() => {
    if (snap.state !== "stopped") return;
    const timer = setTimeout(onExit, 1600);
    return () => clearTimeout(timer);
  }, [snap.state, onExit]);

  if (snap.state === "armed") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-indigo-950 p-6">
        <p className="text-lg text-indigo-300">
          Tonight at {schedule?.startTime ?? "…"}
        </p>
        <p data-testid="countdown" className="font-mono text-6xl font-bold text-amber-100">
          {formatCountdown(snap.secondsToStart ?? 0)}
        </p>
        <div className="flex gap-3">
          {covers.map((c) => (
            <span
              key={c.itemId}
              className="relative h-16 w-16 overflow-hidden rounded-xl ring-2 ring-amber-300/60"
            >
              {c.artworkUrl ? (
                <Image src={c.artworkUrl} alt={c.title} fill sizes="64px" className="object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-indigo-800 text-2xl">🎧</span>
              )}
            </span>
          ))}
        </div>
        <button
          data-testid="start-now"
          onClick={() => engine.startNow(schedule?.hardStopTime ?? null)}
          className="rounded-full bg-amber-300 px-8 py-4 text-lg font-semibold text-indigo-950 active:scale-95"
        >
          Start now
        </button>
        <button
          onClick={() => {
            engine.disarm();
            onExit();
          }}
          className="text-sm text-indigo-400"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (snap.state === "stopped") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950">
        <p className="text-3xl text-amber-100/70">Good night 🌙</p>
      </div>
    );
  }

  // playing | fading | ambient → night screen
  return (
    <div
      data-testid="night-screen"
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-stone-950 p-8"
    >
      <p className="pt-2 font-mono text-sm text-amber-100/40">{clock}</p>

      <div className="flex flex-col items-center gap-4">
        <span className="relative h-48 w-48 overflow-hidden rounded-3xl opacity-30">
          {snap.entry?.artworkUrl ? (
            <Image
              src={snap.entry.artworkUrl}
              alt=""
              fill
              sizes="192px"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-stone-900 text-6xl">
              🌙
            </span>
          )}
        </span>
        <p className="max-w-64 truncate text-center text-amber-100/50">
          {snap.state === "ambient" ? "Sleepy sounds" : snap.entry?.title}
        </p>
        {snap.state === "fading" && (
          <p className="text-sm text-amber-100/30">fading out…</p>
        )}
      </div>

      <div className="flex w-full items-center justify-center gap-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          data-testid="all-done"
          onClick={() => engine.stop({ fade: false })}
          className="text-sm text-amber-100/40"
        >
          all done
        </button>
        <button
          data-testid="pause-button"
          onClick={() => engine.togglePause()}
          aria-label={snap.paused ? "Play" : "Pause"}
          className="flex h-24 w-24 items-center justify-center rounded-full bg-amber-100/10 text-5xl text-amber-100/80 active:scale-95"
        >
          {snap.paused ? "▶" : "⏸"}
        </button>
        {snap.state !== "ambient" ? (
          <button
            data-testid="skip-button"
            onClick={() => engine.skip()}
            aria-label="Next story"
            className="text-3xl text-amber-100/40 active:scale-95"
          >
            ⏭
          </button>
        ) : (
          <span className="w-8" />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the engine into `app/_components/shelf.tsx`**

Replace the imports block with:

```tsx
"use client";

import Image from "next/image";
import { useCallback, useRef, useState, useTransition } from "react";
import { addToTonight, clearResume, clearTonight, removeTonightItem, saveResume } from "@/app/actions";
import { BedtimeEngine, type EngineSnapshot } from "@/lib/audio/engine";
import { isWithinCatchUp } from "@/lib/audio/logic";
import { TONIGHT_MAX_ITEMS, toLineupEntry } from "@/lib/lineup";
import type { TonightItem } from "@/lib/playlists";
import type { schedule, tracks } from "@/lib/db/schema";
import { Player } from "./player";
```

Change the component signature to take all props and add the engine plumbing at the top of the function body (before the existing `const full = …` line):

```tsx
export function Shelf({ tracks, lineup, schedule, ambient, resume }: ShelfProps) {
  const [, startTransition] = useTransition();
  const engineRef = useRef<BedtimeEngine | null>(null);
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);

  const closePlayer = useCallback(() => {
    setPlayerOpen(false);
    setSnap(null);
  }, []);

  // Must run synchronously inside a tap handler (autoplay policy).
  function ensureLoadedEngine(): BedtimeEngine {
    if (!engineRef.current) {
      engineRef.current = new BedtimeEngine({
        onSnapshot: setSnap,
        onResumeTick: (trackId, positionSec) => void saveResume(trackId, positionSec),
        onTrackDone: (trackId) => void clearResume(trackId),
      });
    }
    engineRef.current.load({
      lineup: lineup.items.map((i) => toLineupEntry(i.track, i.loopCount)),
      lineupLoop: lineup.playlist.loop,
      fadeSeconds: schedule?.fadeSeconds ?? 30,
      ambient: ambient ? toLineupEntry(ambient, -1) : null,
      resume,
    });
    return engineRef.current;
  }

  function handlePlayNow() {
    ensureLoadedEngine().startNow(schedule?.hardStopTime ?? null);
    setPlayerOpen(true);
  }

  function handleArm() {
    if (!schedule?.enabled) return;
    ensureLoadedEngine().arm(schedule.startTime, schedule.hardStopTime);
    setPlayerOpen(true);
  }

  const catchUp =
    !!schedule?.enabled &&
    lineup.items.length > 0 &&
    isWithinCatchUp(new Date(), schedule.startTime);

  const full = lineup.items.length >= TONIGHT_MAX_ITEMS;
```

Wire the play button (replace its `onClick={() => {}}`):

```tsx
            onClick={handlePlayNow}
```

Replace the `Tonight at {schedule.startTime}` footer paragraph with an arm button plus catch-up banner:

```tsx
        {catchUp && (
          <button
            data-testid="catch-up-banner"
            onClick={handlePlayNow}
            className="mt-2 w-full rounded-xl bg-amber-300/20 py-2 text-center text-sm font-semibold text-amber-200"
          >
            It&apos;s past {schedule?.startTime} — start tonight&apos;s stories now
          </button>
        )}
        {schedule?.enabled && lineup.items.length > 0 && !catchUp && (
          <button
            data-testid="arm-button"
            onClick={handleArm}
            className="mt-2 w-full py-1 text-center text-sm text-amber-200/80"
          >
            🕗 Get ready for tonight at {schedule.startTime}
          </button>
        )}
```

And render the overlay at the end of the returned JSX, just before `</main>`:

```tsx
      {playerOpen && snap && engineRef.current && (
        <Player
          engine={engineRef.current}
          snap={snap}
          schedule={schedule}
          covers={lineup.items.map((i) => ({
            itemId: i.itemId,
            title: i.track.title,
            artworkUrl: i.track.artworkUrl,
          }))}
          onExit={closePlayer}
        />
      )}
```

- [ ] **Step 3: Verify in the browser**

Run: `npx tsc --noEmit` → clean. Run: `npm run lint` → clean. With `npm run dev` and 2 short tracks in the lineup: tap ▶ → night screen appears, audio fades in and plays; pause toggles (with a short fade, no click); ⏭ skips to track 2; when the last track ends with no ambient configured → "Good night 🌙" → back to the shelf; "all done" exits immediately. No console errors.

- [ ] **Step 4: Commit**

```powershell
git add app/_components
git commit -m "feat: player overlay with countdown, night screen, wake lock, media session"
```

---

### Task 9: Parent schedule settings (TDD on the form parser)

**Files:**
- Create: `lib/schedule.ts` (pure form parser)
- Test: `lib/schedule.test.ts`
- Create: `app/parent/schedule/actions.ts`
- Create: `app/parent/schedule/page.tsx`
- Modify: `app/parent/page.tsx` (nav link)

**Interfaces:**
- Consumes: `db`, `schedule`/`playlists`/`tracks` tables, `requireParent`, `getOrCreateTonight`.
- Produces (used by Tasks 8 flow and 11):
  - `type ScheduleInput = { enabled: boolean; startTime: string; fadeSeconds: number; hardStopTime: string | null; ambientTrackId: number | null; tonightLoop: boolean }`
  - `parseScheduleForm(form: { get(name: string): unknown }): ScheduleInput | null` from `@/lib/schedule` (client-safe, pure — accepts a `FormData`).
  - Server action `saveSchedule(formData: FormData): Promise<void>` — upserts the single `schedule` row (fixed `id: 1`, single statement `onConflictDoUpdate`, NO transaction) and sets the tonight playlist's `loop` flag.
  - The settings page at `/parent/schedule` (PIN-gated by the existing proxy rule).

- [ ] **Step 1: Write the failing tests**

Create `lib/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseScheduleForm } from "@/lib/schedule";

function form(entries: Record<string, string>) {
  return { get: (name: string) => entries[name] ?? null };
}

describe("parseScheduleForm", () => {
  it("parses a full valid form", () => {
    expect(
      parseScheduleForm(
        form({
          enabled: "on",
          startTime: "20:30",
          fadeSeconds: "45",
          hardStopTime: "21:15",
          ambientTrackId: "3",
          tonightLoop: "on",
        }),
      ),
    ).toEqual({
      enabled: true,
      startTime: "20:30",
      fadeSeconds: 45,
      hardStopTime: "21:15",
      ambientTrackId: 3,
      tonightLoop: true,
    });
  });

  it("treats missing checkboxes and empty optionals as off/null", () => {
    expect(
      parseScheduleForm(
        form({ startTime: "19:05", fadeSeconds: "30", hardStopTime: "", ambientTrackId: "" }),
      ),
    ).toEqual({
      enabled: false,
      startTime: "19:05",
      fadeSeconds: 30,
      hardStopTime: null,
      ambientTrackId: null,
      tonightLoop: false,
    });
  });

  it("rejects malformed times", () => {
    expect(parseScheduleForm(form({ startTime: "25:00", fadeSeconds: "30" }))).toBeNull();
    expect(parseScheduleForm(form({ startTime: "8pm", fadeSeconds: "30" }))).toBeNull();
    expect(
      parseScheduleForm(form({ startTime: "20:30", fadeSeconds: "30", hardStopTime: "9:5" })),
    ).toBeNull();
  });

  it("rejects out-of-range or non-integer fade seconds", () => {
    expect(parseScheduleForm(form({ startTime: "20:30", fadeSeconds: "-1" }))).toBeNull();
    expect(parseScheduleForm(form({ startTime: "20:30", fadeSeconds: "301" }))).toBeNull();
    expect(parseScheduleForm(form({ startTime: "20:30", fadeSeconds: "abc" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` → FAIL — `Cannot find module '@/lib/schedule'`.

- [ ] **Step 3: Implement `lib/schedule.ts`**

```ts
export type ScheduleInput = {
  enabled: boolean;
  startTime: string;
  fadeSeconds: number;
  hardStopTime: string | null;
  ambientTrackId: number | null;
  tonightLoop: boolean;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseScheduleForm(form: {
  get(name: string): unknown;
}): ScheduleInput | null {
  const str = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const startTime = str("startTime");
  if (!TIME_RE.test(startTime)) return null;
  const fadeSeconds = Number(str("fadeSeconds"));
  if (!Number.isInteger(fadeSeconds) || fadeSeconds < 0 || fadeSeconds > 300) {
    return null;
  }
  const hardStopRaw = str("hardStopTime");
  if (hardStopRaw && !TIME_RE.test(hardStopRaw)) return null;
  const ambientRaw = str("ambientTrackId");
  const ambientTrackId = ambientRaw ? Number(ambientRaw) : null;
  if (ambientTrackId !== null && !Number.isInteger(ambientTrackId)) return null;
  return {
    enabled: str("enabled") === "on",
    startTime,
    fadeSeconds,
    hardStopTime: hardStopRaw || null,
    ambientTrackId,
    tonightLoop: str("tonightLoop") === "on",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → PASS.

- [ ] **Step 5: Create `app/parent/schedule/actions.ts`**

```ts
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
```

- [ ] **Step 6: Create `app/parent/schedule/page.tsx`**

```tsx
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { schedule, tracks } from "@/lib/db/schema";
import { getOrCreateTonight } from "@/lib/playlists";
import { saveSchedule } from "./actions";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ error?: string; saved?: string }> };

export default async function SchedulePage({ searchParams }: Props) {
  const { error, saved } = await searchParams;
  const [rows, ambientTracks, tonight] = await Promise.all([
    db.select().from(schedule),
    db.select().from(tracks).where(eq(tracks.kind, "ambient")),
    getOrCreateTonight(),
  ]);
  const row = rows[0] ?? null;

  const field = "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100";
  const label = "block text-sm text-slate-400";

  return (
    <main className="mx-auto min-h-dvh max-w-2xl space-y-6 bg-slate-950 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Bedtime schedule</h1>
        <a href="/parent" className="text-sm text-slate-400 underline">
          ← Library
        </a>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-300">
          Couldn&apos;t save — check the times and try again.
        </p>
      )}
      {saved && <p className="text-sm text-emerald-300">Saved.</p>}

      <form action={saveSchedule} className="space-y-4">
        <label className="flex items-center gap-2 text-slate-100">
          <input type="checkbox" name="enabled" defaultChecked={row?.enabled ?? false} />
          Start stories automatically
        </label>

        <div>
          <label htmlFor="startTime" className={label}>
            Start time
          </label>
          <input
            id="startTime"
            name="startTime"
            type="time"
            required
            defaultValue={row?.startTime ?? "20:30"}
            className={field}
          />
        </div>

        <div>
          <label htmlFor="fadeSeconds" className={label}>
            Fade-out length (seconds)
          </label>
          <input
            id="fadeSeconds"
            name="fadeSeconds"
            type="number"
            min={0}
            max={300}
            required
            defaultValue={row?.fadeSeconds ?? 30}
            className={field}
          />
        </div>

        <div>
          <label htmlFor="hardStopTime" className={label}>
            Hard stop (optional — everything silent by this time)
          </label>
          <input
            id="hardStopTime"
            name="hardStopTime"
            type="time"
            defaultValue={row?.hardStopTime ?? ""}
            className={field}
          />
        </div>

        <div>
          <label htmlFor="ambientTrackId" className={label}>
            After the stories, play
          </label>
          <select
            id="ambientTrackId"
            name="ambientTrackId"
            defaultValue={row?.ambientTrackId ?? ""}
            className={field}
          >
            <option value="">Nothing — just stop</option>
            {ambientTracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          {ambientTracks.length === 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Upload a track and set its kind to &quot;ambient&quot; to enable this.
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-slate-100">
          <input type="checkbox" name="tonightLoop" defaultChecked={tonight.loop} />
          Repeat tonight&apos;s lineup until stopped
        </label>

        <button
          type="submit"
          className="w-full rounded-xl bg-slate-200 px-4 py-3 font-semibold text-slate-900 active:bg-white"
        >
          Save
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Link it from the library page**

In `app/parent/page.tsx`, replace the `<h1>` line with a header row:

```tsx
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Library</h1>
        <a href="/parent/schedule" className="text-sm text-slate-400 underline">
          Schedule →
        </a>
      </div>
```

- [ ] **Step 8: Verify**

Run: `npm test`, `npx tsc --noEmit`, `npm run lint` → all clean. In the browser: `/parent/schedule` → set enabled + a start time 2 minutes out + fade 5 + save → "Saved."; kid shelf now shows "🕗 Get ready for tonight at HH:MM"; tapping it shows the countdown screen, and at the start time playback fades in. Set an invalid state (clear the time field, submit) → error text.

- [ ] **Step 9: Commit**

```powershell
git add lib/schedule.ts lib/schedule.test.ts app/parent/schedule app/parent/page.tsx
git commit -m "feat: parent bedtime schedule settings"
```

---

### Task 10: PWA — manifest, icons, service worker, app metadata

**Files:**
- Create: `app/manifest.ts`
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/apple-touch-icon.png` (generated once with ffmpeg, committed)
- Create: `public/sw.js`
- Create: `app/_components/sw-register.tsx`
- Modify: `app/layout.tsx` (real metadata + viewport + SW registration)
- Modify: `proxy.ts` (exclude `sw.js` from the gate)

**Interfaces:**
- Consumes: nothing new.
- Produces: installable PWA. `app/manifest.ts` is the Next 16 convention and serves at `/manifest.webmanifest` — already excluded in the proxy matcher, as is `icons/`; only `sw.js` needs adding.

- [ ] **Step 1: Generate the icons (one-time)**

```powershell
New-Item -ItemType Directory -Force public\icons
& "C:\Users\uurrn\AppData\Local\ffmpeg\bin\ffmpeg.exe" -y -f lavfi -i "gradients=s=512x512:c0=#4338ca:c1=#151239:x0=64:y0=0:x1=448:y1=512" -frames:v 1 public\icons\icon-512.png
& "C:\Users\uurrn\AppData\Local\ffmpeg\bin\ffmpeg.exe" -y -i public\icons\icon-512.png -vf scale=192:192 public\icons\icon-192.png
& "C:\Users\uurrn\AppData\Local\ffmpeg\bin\ffmpeg.exe" -y -i public\icons\icon-512.png -vf scale=180:180 public\icons\apple-touch-icon.png
```

(If the `gradients` filter is unavailable in the installed ffmpeg, substitute `color=c=0x4338ca:s=512x512` for the `-i` value.) A dusk-gradient tile is the v1 icon; a designed icon can replace these files later without code changes.

- [ ] **Step 2: Create `app/manifest.ts`**

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bedtime Reader",
    short_name: "Bedtime",
    description: "Bedtime stories and songs for our family",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1e1b4b",
    theme_color: "#1e1b4b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

- [ ] **Step 3: Create `public/sw.js`**

```js
// v1: install/activate only — no offline caching. Audio streams from the
// blob store and every page needs the auth cookie, so caching the shell
// would serve stale/gated content. Offline lineup caching is a noted
// future enhancement in the spec.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
```

- [ ] **Step 4: Create `app/_components/sw-register.tsx`**

```tsx
"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .catch(() => {});
    }
  }, []);
  return null;
}
```

- [ ] **Step 5: Update `app/layout.tsx`**

Replace the metadata export and add a viewport export (import `Viewport` from `next`; import and render `SwRegister`):

```tsx
import type { Metadata, Viewport } from "next";
import { SwRegister } from "./_components/sw-register";

export const metadata: Metadata = {
  title: "Bedtime Reader",
  description: "Bedtime stories and songs for our family",
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Bedtime",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e1b4b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
```

And in the body:

```tsx
      <body className="min-h-full flex flex-col">
        <SwRegister />
        {children}
      </body>
```

- [ ] **Step 6: Exclude `sw.js` in `proxy.ts`**

Replace the matcher:

```ts
export const config = {
  matcher: [
    "/((?!login|api/upload|_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)",
  ],
};
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit`, `npm run lint` → clean. With `npm run dev`:

```powershell
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/manifest.webmanifest
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/sw.js
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/icons/icon-192.png
```

Expected: `200` for all three **without** any auth cookie. In the browser: tab title "Bedtime Reader"; DevTools → Application → Manifest shows name and icons; Service Worker registered and activated.

- [ ] **Step 8: Commit**

```powershell
git add app/manifest.ts app/layout.tsx app/_components/sw-register.tsx public/sw.js public/icons proxy.ts
git commit -m "feat: PWA manifest, icons, service worker, app metadata"
```

---

### Task 11: Extend the e2e harness with the player flow

**Files:**
- Modify: `scripts/e2e-smoke.mjs`

**Interfaces:**
- Consumes: the `data-testid` hooks from Tasks 7–8, `window.__bedtimeAudio` (Task 6), the schedule form (Task 9).
- Produces: one `npm run e2e` covering Plan 1 + Plan 2. It must still leave the library empty. Playwright's `page.clock` (mocks `Date`/timers; keeps ticking by default, `fastForward` jumps) drives the scheduled-start test without waiting for real bedtime.

- [ ] **Step 1: Add browser launch flags**

Replace the launch line:

```js
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
```

- [ ] **Step 2: Lengthen the untagged fixture to 30s**

In `buildFixtures`, change the untagged tone from `sine=frequency=220:duration=3` to `sine=frequency=220:duration=30`. "rain sounds" plays first in the player test below; a 3s track could end mid-pause-assertion and flake. No Plan 1 assertion checks its duration, so this is safe.

- [ ] **Step 3: Insert the player sections**

Insert the following between the existing delete-with-confirm section and the final full-cleanup section (renumber the old cleanup comment to `Step 14`). At this point the library holds three story tracks: "rain sounds" (with artwork) and two "The Gruffalo Test".

```js
    // --- Step 9: kid shelf + lineup ---
    await page.goto(BASE + "/");
    await page.waitForSelector('[data-testid="shelf-grid"]');
    const tileCount = await page.locator('[data-testid="shelf-tile"]').count();
    assert(tileCount === 3, `shelf shows a tile per library track (${tileCount})`);

    await page.locator('[data-testid="shelf-tile"]', { hasText: "rain sounds" }).first().click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="lineup-item"]').length === 1,
      { timeout: 10000 },
    );
    await page.locator('[data-testid="shelf-tile"]', { hasText: "The Gruffalo Test" }).first().click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="lineup-item"]').length === 2,
      { timeout: 10000 },
    );
    assert(true, "tapping tiles added two covers to the lineup strip");

    await page.locator('[data-testid="lineup-item"]').last().click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="lineup-item"]').length === 1,
      { timeout: 10000 },
    );
    assert(true, "tapping a lineup cover removes it");
    await page.locator('[data-testid="shelf-tile"]', { hasText: "The Gruffalo Test" }).first().click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="lineup-item"]').length === 2,
      { timeout: 10000 },
    );

    // --- Step 10: playback — night screen, pause, skip, natural end ---
    await page.locator('[data-testid="play-button"]').click();
    await page.waitForSelector('[data-testid="night-screen"]', { timeout: 10000 });
    assert(true, "night screen appears on play");
    await page.waitForFunction(
      () => {
        const a = window.__bedtimeAudio;
        return !!a && !a.paused && a.currentTime > 0.3;
      },
      { timeout: 10000 },
    );
    assert(true, "audio is playing (currentTime advancing)");
    const firstSrc = await page.evaluate(() => window.__bedtimeAudio.src);

    await page.locator('[data-testid="pause-button"]').click();
    await page.waitForFunction(() => window.__bedtimeAudio.paused, { timeout: 5000 });
    assert(true, "pause button pauses after the short fade");
    await page.locator('[data-testid="pause-button"]').click();
    await page.waitForFunction(() => !window.__bedtimeAudio.paused, { timeout: 5000 });
    assert(true, "pause button resumes playback");

    await page.locator('[data-testid="skip-button"]').click();
    await page.waitForFunction(
      (prev) => window.__bedtimeAudio.src !== prev,
      firstSrc,
      { timeout: 5000 },
    );
    assert(true, "skip advances to the next lineup item");

    // The last item is a 3s tone and no ambient track is configured, so the
    // engine stops and the player auto-exits to the shelf.
    await page.waitForSelector('[data-testid="night-screen"]', {
      state: "detached",
      timeout: 20000,
    });
    assert(true, "player exits back to the shelf after the last track ends");

    // --- Step 11: schedule + armed countdown (mocked clock) ---
    await page.goto(BASE + "/parent/schedule");
    await page.check('input[name="enabled"]');
    await page.fill('input[name="startTime"]', "20:30");
    await page.fill('input[name="fadeSeconds"]', "2");
    await page.click('button[type="submit"]');
    await page.waitForURL(/saved=1/, { timeout: 10000 });
    assert(true, "schedule saved (enabled, 20:30, fade 2s)");

    const armPage = await context.newPage();
    await armPage.clock.install({ time: new Date(2026, 6, 21, 20, 29, 30) });
    await armPage.goto(BASE + "/");
    await armPage.waitForSelector('[data-testid="arm-button"]', { timeout: 10000 });
    await armPage.locator('[data-testid="arm-button"]').click();
    await armPage.waitForSelector('[data-testid="countdown"]', { timeout: 5000 });
    assert(true, "arming shows the countdown screen");
    await armPage.clock.fastForward("00:40");
    await armPage.waitForSelector('[data-testid="night-screen"]', { timeout: 15000 });
    await armPage.waitForFunction(
      () => {
        const a = window.__bedtimeAudio;
        return !!a && !a.paused && a.currentTime > 0.3;
      },
      { timeout: 10000 },
    );
    assert(true, "scheduled start fired at 20:30: playback fading in");
    await armPage.locator('[data-testid="all-done"]').click();
    await armPage.waitForSelector('[data-testid="night-screen"]', {
      state: "detached",
      timeout: 10000,
    });
    assert(true, "all-done stops scheduled playback");
    await armPage.close();

    // --- Step 12: catch-up banner when reopened after start time ---
    const latePage = await context.newPage();
    await latePage.clock.install({ time: new Date(2026, 6, 21, 20, 45, 0) });
    await latePage.goto(BASE + "/");
    await latePage.waitForSelector('[data-testid="catch-up-banner"]', { timeout: 10000 });
    assert(true, "catch-up banner offered when reopened after start time");
    await latePage.close();

    // --- Step 13: reset schedule + lineup so cleanup leaves no residue ---
    await page.goto(BASE + "/parent/schedule");
    await page.uncheck('input[name="enabled"]');
    await page.click('button[type="submit"]');
    await page.waitForURL(/saved=1/, { timeout: 10000 });
    await page.goto(BASE + "/");
    for (let i = 0; i < 10; i++) {
      const n = await page.locator('[data-testid="lineup-item"]').count();
      if (n === 0) break;
      await page.locator('[data-testid="lineup-item"]').first().click();
      await page.waitForTimeout(500);
    }
    assert(
      (await page.locator('[data-testid="lineup-item"]').count()) === 0,
      "tonight lineup cleared",
    );
    await page.goto(BASE + "/parent");
```

Also append one line to the coverage comment at the top of the file: `// Plan 2: shelf/lineup, playback with pause/skip/auto-exit, mocked-clock scheduled start, catch-up banner.`

- [ ] **Step 4: Run the full harness**

With `npm run dev` running: `npm run e2e`
Expected: `ALL <N> ASSERTIONS PASSED` (N grows by ~14) and the library ends empty. If the armed test flakes on timing, widen the `fastForward` to `"01:00"` — never replace the mocked clock with real waiting.

- [ ] **Step 5: Commit**

```powershell
git add scripts/e2e-smoke.mjs
git commit -m "test: e2e coverage for shelf, playback, scheduling, catch-up"
```

---

### Task 12: Full verification, merge, deploy (USER-ASSISTED at the end)

**Files:** none new (possible straggler fixes only)

**Interfaces:**
- Consumes: everything above.
- Produces: Plan 2 live at https://reader-ecru-phi.vercel.app.

- [ ] **Step 1: Full local verification**

Run in order, all must pass/exit 0:

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Then with `npm run dev` running: `npm run e2e` → all assertions pass, library empty.

- [ ] **Step 2: Merge to master and push**

```powershell
git checkout master
git merge --no-ff feature/player -m "feat: player - shelf, engine, scheduling, sleep features, PWA"
git push origin master
```

(Follow superpowers:finishing-a-development-branch for this step — confirm the merge choice with the user first.)

- [ ] **Step 3: Deploy**

```powershell
vercel deploy
```

NOTE: on this project `vercel deploy` targets **production** by default. Expected: production URL responds; then:

```powershell
curl.exe -s -o NUL -w "%{http_code}" https://reader-ecru-phi.vercel.app/manifest.webmanifest
```

Expected: `200`.

- [ ] **Step 4 (user): Real-device sanity on the phone**

The user, on their phone (production password/PIN):
- Log in, upload one real story (this is also the still-outstanding Plan 1 production check), tap its tile, play → night screen, fades audible (GainNode), lock screen shows artwork/controls.
- Install to home screen (iOS: Share → Add to Home Screen); reopen standalone.
- Set a schedule 2 minutes out, arm, lock intent: screen stays awake on the countdown; playback fades in on time.

- [ ] **Step 5: Record the milestone**

```powershell
git add -A
git commit -m "chore: player milestone deployed" --allow-empty
git push origin master
```

---

## Self-review notes

- **Spec coverage:** kid shelf + lineup + big play (Task 7–8) ✓; playback engine with per-item loops, lineup loop, GainNode fades (Tasks 5–6) ✓; armed scheduling with countdown, wake lock, catch-up, Media Session (Tasks 6, 8) ✓; sleep features — fade-out (`stop({fade:true})` + hard stop timer), ambient rollover at low gain, night screen, resume via `playback_state` (Tasks 4–6, 8) ✓; PWA manifest/icons/SW/install (Task 10) ✓; carry-over review items (Tasks 1–3) ✓; e2e per spec's verification section (Task 11) ✓.
- **Deliberate scope calls:** no UI to set per-item `loopCount` in v1 (engine + schema support it; the schedule page's "repeat lineup" toggle covers the common case). No drag-reorder of the lineup (remove + re-add covers a 1–6 item strip) — this is what keeps the neon-http no-transaction constraint safe. Family password token stays non-expiring by design (1-year cookie is the spec).
- **Type consistency check:** `EngineSnapshot.paused` used by Player ✓ (defined in Task 6); `toLineupEntry` consumed in Task 8's shelf plumbing matches Task 7's signature ✓; `TonightItem.itemId/track` shape matches Task 4's select ✓; `saveSchedule` reads the exact input names rendered by the page form ✓; `nextPosition` "engine increments `loopsDone` before calling" contract is honored in `handleEnded` ✓.
- **Bundle boundary:** client components import runtime values only from `lib/lineup`, `lib/audio/*`, `lib/schedule`, `app/actions`; `lib/playlists` (→ `lib/db` → `requiredEnv("DATABASE_URL")`) is server-only, type-imports excepted.








