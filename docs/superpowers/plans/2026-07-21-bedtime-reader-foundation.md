# Bedtime Reader — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, password-gated Next.js app where the parent can upload audio files and manage the library (titles, artwork, kinds), with metadata and cover art extracted automatically.

**Architecture:** Next.js 16 App Router on Vercel. `proxy.ts` gates every route behind a family-password cookie; `/parent/*` additionally behind a PIN cookie. Audio/images live in Vercel Blob (client uploads); the catalog lives in Neon Postgres via Drizzle. Mutations are server actions on the PIN-gated `/parent` pages.

**Tech Stack:** Next.js 16.2, React 19, Tailwind v4, drizzle-orm + @neondatabase/serverless, drizzle-kit, @vercel/blob, music-metadata, vitest.

**Spec:** `docs/superpowers/specs/2026-07-21-bedtime-reader-design.md`

## Global Constraints

- Next.js **16**: the request gate file is `proxy.ts` (NOT `middleware.ts`), exporting `function proxy()` and `const proxyConfig` (NOT `config`).
- `cookies()` from `next/headers` is **async** — always `await cookies()`.
- Tailwind **v4**: no `tailwind.config.js`; theme lives in `app/globals.css`. Do not create a Tailwind config file.
- TypeScript strict; path alias `@/*` maps to repo root (already configured in `tsconfig.json`).
- No component library (no shadcn). Plain Tailwind.
- Secrets only in env vars. Local values in `.env.local` (already gitignored via `.env*`). Never commit secrets.
- Env vars used: `FAMILY_PASSWORD`, `PARENT_PIN`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`.
- Shell is Windows PowerShell 5.1: no `&&` chaining; use `;` or separate commands. `curl.exe` (not the `curl` alias) for HTTP checks.
- End every git commit message with the line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Track kinds are exactly: `"story" | "song" | "ambient"`.

---

### Task 1: Test harness + auth token helpers

**Files:**
- Create: `vitest.config.ts`
- Create: `lib/auth.ts`
- Test: `lib/auth.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: nothing (first task)
- Produces (used by Tasks 2, 3, 7):
  - `FAMILY_COOKIE = "family_session"`, `PARENT_COOKIE = "parent_session"` (string consts)
  - `familyToken(password: string): Promise<string>`
  - `parentToken(pin: string): Promise<string>`
  - `isValidFamilyToken(token: string | undefined, password: string): Promise<boolean>`
  - `isValidParentToken(token: string | undefined, pin: string): Promise<boolean>`

- [ ] **Step 1: Commit the design docs**

```powershell
git add docs
git commit -m "docs: add design spec and foundation implementation plan"
```

- [ ] **Step 2: Install vitest and add scripts**

```powershell
npm install -D vitest
```

Add to `package.json` `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { environment: "node" },
});
```

- [ ] **Step 3: Write the failing tests**

Create `lib/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  familyToken,
  isValidFamilyToken,
  isValidParentToken,
  parentToken,
} from "@/lib/auth";

describe("auth tokens", () => {
  it("family token round-trips against the same password", async () => {
    const token = await familyToken("hunter2");
    expect(await isValidFamilyToken(token, "hunter2")).toBe(true);
  });

  it("family token fails against a different password", async () => {
    const token = await familyToken("hunter2");
    expect(await isValidFamilyToken(token, "other")).toBe(false);
  });

  it("rejects undefined and tampered tokens", async () => {
    expect(await isValidFamilyToken(undefined, "hunter2")).toBe(false);
    const token = await familyToken("hunter2");
    expect(await isValidFamilyToken(token + "0", "hunter2")).toBe(false);
  });

  it("family and parent tokens differ for the same secret", async () => {
    expect(await familyToken("1234")).not.toBe(await parentToken("1234"));
  });

  it("parent token round-trips", async () => {
    const token = await parentToken("1234");
    expect(await isValidParentToken(token, "1234")).toBe(true);
    expect(await isValidParentToken(token, "9999")).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/auth'` (or similar resolution error).

- [ ] **Step 5: Implement `lib/auth.ts`**

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 5 tests.

- [ ] **Step 7: Commit**

```powershell
git add vitest.config.ts lib/auth.ts lib/auth.test.ts package.json package-lock.json
git commit -m "feat: auth token helpers with vitest harness"
```

---

### Task 2: Family password gate (`proxy.ts` + `/login`)

**Files:**
- Create: `proxy.ts`
- Create: `app/login/page.tsx`
- Create: `app/login/actions.ts`
- Create: `.env.local` (dev secrets, NOT committed)
- Modify: `app/page.tsx` (placeholder home)

**Interfaces:**
- Consumes: `FAMILY_COOKIE`, `familyToken`, `isValidFamilyToken`, `PARENT_COOKIE`, `isValidParentToken` from `@/lib/auth` (Task 1)
- Produces: gate behavior all later tasks rely on — unauthenticated page requests redirect to `/login`; unauthenticated `/api/*` requests get 401; `/api/upload` and `/login` bypass the gate.

- [ ] **Step 1: Create `.env.local` (do not commit)**

```
FAMILY_PASSWORD=dev-password
PARENT_PIN=1234
```

- [ ] **Step 2: Create `proxy.ts`** (repo root — includes the `/parent` PIN rule used in Task 3)

```ts
import { NextResponse, type NextRequest } from "next/server";
import {
  FAMILY_COOKIE,
  PARENT_COOKIE,
  isValidFamilyToken,
  isValidParentToken,
} from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const familyOk = await isValidFamilyToken(
    request.cookies.get(FAMILY_COOKIE)?.value,
    process.env.FAMILY_PASSWORD!,
  );
  if (!familyOk) {
    if (pathname.startsWith("/api")) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname.startsWith("/parent") && pathname !== "/parent/pin") {
    const parentOk = await isValidParentToken(
      request.cookies.get(PARENT_COOKIE)?.value,
      process.env.PARENT_PIN!,
    );
    if (!parentOk) {
      return NextResponse.redirect(new URL("/parent/pin", request.url));
    }
  }

  return NextResponse.next();
}

export const proxyConfig = {
  matcher: [
    "/((?!login|api/upload|_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest).*)",
  ],
};
```

- [ ] **Step 3: Create `app/login/actions.ts`**

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FAMILY_COOKIE, familyToken } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password !== process.env.FAMILY_PASSWORD) {
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
```

- [ ] **Step 4: Create `app/login/page.tsx`**

```tsx
import { loginAction } from "./actions";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-indigo-950 p-6">
      <form action={loginAction} className="w-full max-w-xs space-y-4 text-center">
        <p className="text-4xl">🌙</p>
        <h1 className="text-xl font-semibold text-indigo-100">Bedtime Reader</h1>
        <input
          type="password"
          name="password"
          placeholder="Family password"
          autoFocus
          className="w-full rounded-xl border border-indigo-700 bg-indigo-900 px-4 py-3 text-indigo-100 placeholder-indigo-400 outline-none focus:border-indigo-400"
        />
        {error && <p className="text-sm text-rose-300">That's not it — try again.</p>}
        <button
          type="submit"
          className="w-full rounded-xl bg-indigo-400 px-4 py-3 font-semibold text-indigo-950 active:bg-indigo-300"
        >
          Come in
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Replace `app/page.tsx` with a placeholder home**

```tsx
export default function Home() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-indigo-950">
      <p className="text-indigo-200">🌙 Story shelf coming soon.</p>
    </main>
  );
}
```

- [ ] **Step 6: Verify the gate with the dev server**

Start: `npm run dev` (background), wait for "Ready".

```powershell
curl.exe -s -o NUL -w "%{http_code} %{redirect_url}" http://localhost:3000/
```
Expected: `307 http://localhost:3000/login`

```powershell
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/login
```
Expected: `200`

```powershell
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/api/anything
```
Expected: `401`

Then in a browser (Playwright MCP): open `http://localhost:3000/` → redirected to login → wrong password shows error → correct password `dev-password` lands on the placeholder home. Reload `/` → still home (cookie persisted).

- [ ] **Step 7: Commit**

```powershell
git add proxy.ts app/login app/page.tsx
git commit -m "feat: family password gate with login page"
```

---

### Task 3: Parent PIN gate

**Files:**
- Create: `app/parent/pin/page.tsx`
- Create: `app/parent/pin/actions.ts`
- Create: `app/parent/page.tsx` (placeholder — replaced in Task 9)

**Interfaces:**
- Consumes: `PARENT_COOKIE`, `parentToken` from `@/lib/auth`; the `/parent` proxy rule from Task 2.
- Produces: `/parent/*` reachable only with a valid PIN cookie (1-hour lifetime). Tasks 8–9 build the library UI behind this gate.

- [ ] **Step 1: Create `app/parent/pin/actions.ts`**

```ts
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
```

- [ ] **Step 2: Create `app/parent/pin/page.tsx`**

```tsx
import { pinAction } from "./actions";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function PinPage({ searchParams }: Props) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-6">
      <form action={pinAction} className="w-full max-w-xs space-y-4 text-center">
        <h1 className="text-lg font-semibold text-slate-100">Grown-ups only</h1>
        <input
          type="password"
          name="pin"
          inputMode="numeric"
          placeholder="PIN"
          autoFocus
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-center text-2xl tracking-[0.5em] text-slate-100 outline-none focus:border-slate-400"
        />
        {error && <p className="text-sm text-rose-300">Wrong PIN.</p>}
        <button
          type="submit"
          className="w-full rounded-xl bg-slate-200 px-4 py-3 font-semibold text-slate-900 active:bg-white"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Create placeholder `app/parent/page.tsx`**

```tsx
export default function ParentPage() {
  return (
    <main className="min-h-dvh bg-slate-950 p-6">
      <h1 className="text-xl font-semibold text-slate-100">Library</h1>
      <p className="mt-2 text-slate-400">Uploads coming soon.</p>
    </main>
  );
}
```

- [ ] **Step 4: Verify with the dev server**

With a logged-in browser session (family cookie from Task 2): visit `/parent` → redirected to `/parent/pin` → wrong PIN shows error → `1234` lands on the Library placeholder. Visiting `/parent/pin` without the family cookie still redirects to `/login`.

- [ ] **Step 5: Commit**

```powershell
git add app/parent
git commit -m "feat: parent PIN gate"
```

---

### Task 4: Provision Vercel project, Blob store, and Neon database (USER-ASSISTED)

**Files:**
- Modify: `.env.local` (gains `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` via `vercel env pull`)

**Interfaces:**
- Consumes: nothing from code.
- Produces: `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` available locally and in the Vercel project; `FAMILY_PASSWORD`/`PARENT_PIN` set for Production. Tasks 5–10 depend on these.

> This task requires the user's Vercel account. Steps marked **(user)** must be run by the user (interactive login/browser).

- [ ] **Step 1: Install the Vercel CLI**

```powershell
npm install -g vercel
```

- [ ] **Step 2 (user): Log in** — user types `! vercel login` in the session (or runs it in their terminal).

- [ ] **Step 3: Link the project**

```powershell
vercel link --yes
```
Expected: creates `.vercel/` (already gitignored) linked to a new `reader` project.

- [ ] **Step 4 (user or dashboard): Add storage**
  - Blob: `vercel blob store add reader-media` (or dashboard → Storage → Create Blob store), then connect it to the project so `BLOB_READ_WRITE_TOKEN` is added to all environments.
  - Neon: dashboard → Storage → Create Database → Neon (Marketplace), connect to the project for all environments.

- [ ] **Step 5: Pull env vars locally**

```powershell
vercel env pull .env.local
```
Expected: `.env.local` now contains `BLOB_READ_WRITE_TOKEN` and a Postgres URL. **Check the variable name:** code reads `process.env.DATABASE_URL`. If the Neon integration only created `POSTGRES_URL`/`DATABASE_URL_UNPOOLED` etc., add a `DATABASE_URL` alias in the Vercel dashboard env settings and re-pull. Re-add `FAMILY_PASSWORD`/`PARENT_PIN` lines if the pull overwrote them.

- [ ] **Step 6 (user-assisted): Set app secrets in Vercel** for Production (and Preview):

```powershell
vercel env add FAMILY_PASSWORD production
vercel env add PARENT_PIN production
```
(Interactive value prompts — user supplies real values, which should differ from the dev ones.)

- [ ] **Step 7: No commit** (nothing tracked changed; `.vercel/` and `.env.local` are gitignored).

---

### Task 5: Drizzle schema + push to Neon

**Files:**
- Create: `lib/db/schema.ts`
- Create: `lib/db/index.ts`
- Create: `drizzle.config.ts`
- Create: `scripts/db-smoke.mjs`
- Modify: `package.json` (script)

**Interfaces:**
- Consumes: `DATABASE_URL` (Task 4).
- Produces (used by Tasks 8–9 and all of Plan 2):
  - `db` (drizzle instance) from `@/lib/db`
  - Tables from `@/lib/db/schema`: `tracks`, `playlists`, `playlistItems`, `schedule`, `playbackState`; enum `trackKind`
  - Row types: `tracks.$inferSelect` has `{ id: number; title: string; kind: "story" | "song" | "ambient"; audioUrl: string; artworkUrl: string | null; durationSec: number | null; createdAt: Date }`

- [ ] **Step 1: Install dependencies**

```powershell
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit
```

- [ ] **Step 2: Create `lib/db/schema.ts`**

```ts
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const trackKind = pgEnum("track_kind", ["story", "song", "ambient"]);

export const tracks = pgTable("tracks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  kind: trackKind("kind").notNull().default("story"),
  audioUrl: text("audio_url").notNull(),
  artworkUrl: text("artwork_url"),
  durationSec: real("duration_sec"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const playlists = pgTable("playlists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  loop: boolean("loop").notNull().default(false),
});

export const playlistItems = pgTable("playlist_items", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id")
    .notNull()
    .references(() => playlists.id, { onDelete: "cascade" }),
  trackId: integer("track_id")
    .notNull()
    .references(() => tracks.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  loopCount: integer("loop_count"),
});

export const schedule = pgTable("schedule", {
  id: integer("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  startTime: text("start_time").notNull().default("20:30"),
  fadeSeconds: integer("fade_seconds").notNull().default(30),
  hardStopTime: text("hard_stop_time"),
  ambientTrackId: integer("ambient_track_id").references(() => tracks.id, {
    onDelete: "set null",
  }),
});

export const playbackState = pgTable("playback_state", {
  trackId: integer("track_id")
    .primaryKey()
    .references(() => tracks.id, { onDelete: "cascade" }),
  positionSec: real("position_sec").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 3: Create `lib/db/index.ts`**

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
```

- [ ] **Step 4: Create `drizzle.config.ts`** (loads `.env.local` the way Next does)

```ts
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "./lib/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Add to `package.json` scripts:

```json
"db:push": "drizzle-kit push"
```

- [ ] **Step 5: Push the schema**

Run: `npm run db:push`
Expected: output listing created tables/enum, exit 0.

- [ ] **Step 6: Smoke-check the database**

Create `scripts/db-smoke.mjs`:

```js
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  select table_name from information_schema.tables
  where table_schema = 'public' order by table_name`;
console.log(rows.map((r) => r.table_name).join(", "));
```

Run: `node --env-file=.env.local scripts/db-smoke.mjs`
Expected output includes: `playback_state, playlist_items, playlists, schedule, tracks`

- [ ] **Step 7: Commit**

```powershell
git add lib/db drizzle.config.ts scripts/db-smoke.mjs package.json package-lock.json
git commit -m "feat: drizzle schema for tracks, playlists, schedule, playback state"
```

---

### Task 6: Metadata mapping module (pure logic, TDD)

**Files:**
- Create: `lib/tracks/metadata.ts`
- Test: `lib/tracks/metadata.test.ts`

**Interfaces:**
- Consumes: nothing (pure module; `music-metadata` is installed here for its types and Task 8's parser).
- Produces (used by Task 8):
  - `type AudioMetaLike = { common: { title?: string; picture?: { data: Uint8Array; format: string }[] }; format: { duration?: number } }`
  - `type ExtractedMeta = { title: string; durationSec: number | null; picture: { data: Uint8Array; mime: string } | null }`
  - `titleFromFilename(filename: string): string`
  - `toTrackMeta(meta: AudioMetaLike | null, filename: string): ExtractedMeta`

- [ ] **Step 1: Install music-metadata**

```powershell
npm install music-metadata
```

- [ ] **Step 2: Write the failing tests**

Create `lib/tracks/metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { titleFromFilename, toTrackMeta } from "@/lib/tracks/metadata";

describe("titleFromFilename", () => {
  it("strips extension and normalizes separators", () => {
    expect(titleFromFilename("the_gruffalo-part1.mp3")).toBe("the gruffalo part1");
  });

  it("collapses repeated whitespace", () => {
    expect(titleFromFilename("Goodnight   Moon .m4a")).toBe("Goodnight Moon");
  });
});

describe("toTrackMeta", () => {
  it("prefers the tag title over the filename", () => {
    const meta = { common: { title: "The Gruffalo" }, format: { duration: 754.3 } };
    const result = toTrackMeta(meta, "track01.mp3");
    expect(result.title).toBe("The Gruffalo");
    expect(result.durationSec).toBe(754);
  });

  it("falls back to a cleaned filename when there is no tag title", () => {
    const result = toTrackMeta({ common: {}, format: {} }, "rain_sounds.mp3");
    expect(result.title).toBe("rain sounds");
    expect(result.durationSec).toBeNull();
  });

  it("handles null metadata (parse failure)", () => {
    const result = toTrackMeta(null, "story.mp3");
    expect(result).toEqual({ title: "story", durationSec: null, picture: null });
  });

  it("ignores a blank tag title", () => {
    const result = toTrackMeta({ common: { title: "  " }, format: {} }, "owl.mp3");
    expect(result.title).toBe("owl");
  });

  it("passes through the first embedded picture", () => {
    const data = new Uint8Array([1, 2, 3]);
    const meta = {
      common: { picture: [{ data, format: "image/jpeg" }] },
      format: {},
    };
    const result = toTrackMeta(meta, "x.mp3");
    expect(result.picture).toEqual({ data, mime: "image/jpeg" });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/tracks/metadata'`.

- [ ] **Step 4: Implement `lib/tracks/metadata.ts`**

```ts
export type AudioMetaLike = {
  common: {
    title?: string;
    picture?: { data: Uint8Array; format: string }[];
  };
  format: { duration?: number };
};

export type ExtractedMeta = {
  title: string;
  durationSec: number | null;
  picture: { data: Uint8Array; mime: string } | null;
};

export function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function toTrackMeta(
  meta: AudioMetaLike | null,
  filename: string,
): ExtractedMeta {
  const tagTitle = meta?.common.title?.trim();
  const picture = meta?.common.picture?.[0];
  const duration = meta?.format.duration;
  return {
    title: tagTitle || titleFromFilename(filename),
    durationSec: duration ? Math.round(duration) : null,
    picture: picture ? { data: picture.data, mime: picture.format } : null,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all suites (auth + metadata).

- [ ] **Step 6: Commit**

```powershell
git add lib/tracks package.json package-lock.json
git commit -m "feat: audio metadata mapping with filename fallback"
```

---

### Task 7: Blob client-upload token route

**Files:**
- Create: `app/api/upload/route.ts`

**Interfaces:**
- Consumes: `FAMILY_COOKIE`, `isValidFamilyToken` from `@/lib/auth`; `BLOB_READ_WRITE_TOKEN` env (Task 4).
- Produces: `POST /api/upload` — the `handleUploadUrl` endpoint Task 9's `upload()` calls. Bypasses the proxy gate (see Task 2 matcher) and enforces the family cookie itself during token generation; the upload-completed callback is a no-op (finalization happens via server action in Task 8).

- [ ] **Step 1: Install @vercel/blob**

```powershell
npm install @vercel/blob
```

- [ ] **Step 2: Create `app/api/upload/route.ts`**

```ts
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FAMILY_COOKIE, isValidFamilyToken } from "@/lib/auth";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const cookieStore = await cookies();
        const ok = await isValidFamilyToken(
          cookieStore.get(FAMILY_COOKIE)?.value,
          process.env.FAMILY_PASSWORD!,
        );
        if (!ok) throw new Error("Not authorized");
        return {
          allowedContentTypes: [
            "audio/mpeg",
            "audio/mp4",
            "audio/x-m4a",
            "audio/m4a",
            "audio/aac",
            "audio/ogg",
            "audio/wav",
            "audio/flac",
          ],
          addRandomSuffix: true,
          maximumSizeInBytes: 500 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 3: Verify the auth rejection path**

With the dev server running, no cookie:

```powershell
curl.exe -s -X POST http://localhost:3000/api/upload -H "Content-Type: application/json" -d "{\"type\":\"blob.generate-client-token\",\"payload\":{\"pathname\":\"audio/x.mp3\",\"callbackUrl\":\"http://localhost:3000/api/upload\",\"multipart\":false,\"clientPayload\":null}}"
```
Expected: JSON containing `"Not authorized"` with status 400. (The happy path is exercised end-to-end in Task 9.)

- [ ] **Step 4: Commit**

```powershell
git add app/api/upload package.json package-lock.json
git commit -m "feat: gated blob client-upload token route"
```

---

### Task 8: Track server actions (finalize, update, delete, artwork)

**Files:**
- Create: `app/parent/actions.ts`

**Interfaces:**
- Consumes: `db` (Task 5), `tracks` schema (Task 5), `toTrackMeta`/`AudioMetaLike` (Task 6), `parseWebStream` from `music-metadata`, `put`/`del` from `@vercel/blob`.
- Produces (used by Task 9's client components):
  - `finalizeTrack(input: { url: string; filename: string; clientDurationSec: number | null }): Promise<void>`
  - `updateTrack(id: number, fields: { title?: string; kind?: "story" | "song" | "ambient" }): Promise<void>`
  - `deleteTrack(id: number): Promise<void>`
  - `replaceArtwork(id: number, formData: FormData): Promise<void>` (image file under form key `"artwork"`)

- [ ] **Step 1: Create `app/parent/actions.ts`**

```ts
"use server";

import { del, put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { parseWebStream } from "music-metadata";
import { db } from "@/lib/db";
import { tracks } from "@/lib/db/schema";
import { toTrackMeta, type AudioMetaLike } from "@/lib/tracks/metadata";

function assertBlobUrl(url: string) {
  const host = new URL(url).hostname;
  if (!host.endsWith(".public.blob.vercel-storage.com")) {
    throw new Error("Not a blob URL");
  }
}

export async function finalizeTrack(input: {
  url: string;
  filename: string;
  clientDurationSec: number | null;
}): Promise<void> {
  assertBlobUrl(input.url);

  let meta: AudioMetaLike | null = null;
  try {
    const res = await fetch(input.url);
    if (res.ok && res.body) {
      meta = await parseWebStream(res.body, {
        mimeType: res.headers.get("content-type") ?? undefined,
      });
    }
  } catch {
    meta = null;
  }

  const extracted = toTrackMeta(meta, input.filename);

  let artworkUrl: string | null = null;
  if (extracted.picture) {
    const ext = extracted.picture.mime.split("/")[1] ?? "jpg";
    const blob = await put(
      `artwork/${crypto.randomUUID()}.${ext}`,
      Buffer.from(extracted.picture.data),
      { access: "public", contentType: extracted.picture.mime },
    );
    artworkUrl = blob.url;
  }

  await db.insert(tracks).values({
    title: extracted.title,
    audioUrl: input.url,
    artworkUrl,
    durationSec: extracted.durationSec ?? input.clientDurationSec,
  });
  revalidatePath("/parent");
}

export async function updateTrack(
  id: number,
  fields: { title?: string; kind?: "story" | "song" | "ambient" },
): Promise<void> {
  await db.update(tracks).set(fields).where(eq(tracks.id, id));
  revalidatePath("/parent");
}

export async function deleteTrack(id: number): Promise<void> {
  const [row] = await db.select().from(tracks).where(eq(tracks.id, id));
  if (!row) return;
  await db.delete(tracks).where(eq(tracks.id, id));
  try {
    await del(row.audioUrl);
    if (row.artworkUrl) await del(row.artworkUrl);
  } catch {}
  revalidatePath("/parent");
}

export async function replaceArtwork(id: number, formData: FormData): Promise<void> {
  const file = formData.get("artwork");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return;
  const [row] = await db.select().from(tracks).where(eq(tracks.id, id));
  if (!row) return;
  const ext = file.type.split("/")[1] ?? "jpg";
  const blob = await put(`artwork/${crypto.randomUUID()}.${ext}`, file, {
    access: "public",
    contentType: file.type,
  });
  await db.update(tracks).set({ artworkUrl: blob.url }).where(eq(tracks.id, id));
  if (row.artworkUrl) {
    try {
      await del(row.artworkUrl);
    } catch {}
  }
  revalidatePath("/parent");
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Behavior is verified end-to-end in Task 9.)

- [ ] **Step 3: Commit**

```powershell
git add app/parent/actions.ts
git commit -m "feat: track finalize/update/delete/artwork server actions"
```

---

### Task 9: Parent library UI (upload + manage)

**Files:**
- Create: `app/parent/_components/upload-form.tsx`
- Create: `app/parent/_components/track-card.tsx`
- Modify: `app/parent/page.tsx` (replace placeholder)
- Modify: `next.config.ts` (allow blob images through `next/image`)

**Interfaces:**
- Consumes: `upload` from `@vercel/blob/client` (against Task 7's route); all four server actions from `@/app/parent/actions` (Task 8); `db` + `tracks` (Task 5).
- Produces: the working library page at `/parent`.

- [ ] **Step 1: Allow blob-hosted images in `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

export default nextConfig;
```

- [ ] **Step 2: Create `app/parent/_components/upload-form.tsx`**

```tsx
"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { finalizeTrack } from "@/app/parent/actions";

function measureDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    audio.src = url;
  });
}

type FileStatus = { name: string; state: "uploading" | "saving" | "done" | "error"; pct: number };

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const update = (patch: Partial<FileStatus>) =>
        setStatuses((prev) =>
          prev.map((s) => (s.name === file.name ? { ...s, ...patch } : s)),
        );
      setStatuses((prev) => [...prev, { name: file.name, state: "uploading", pct: 0 }]);
      try {
        const clientDurationSec = await measureDuration(file);
        const blob = await upload(`audio/${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          onUploadProgress: ({ percentage }) => update({ pct: Math.round(percentage) }),
        });
        update({ state: "saving", pct: 100 });
        await finalizeTrack({ url: blob.url, filename: file.name, clientDurationSec });
        update({ state: "done" });
        router.refresh();
      } catch {
        update({ state: "error" });
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-slate-700 p-8 text-center text-slate-400 hover:border-slate-500">
        Tap to add audio files
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>
      {statuses.map((s) => (
        <p key={s.name} className="text-sm text-slate-400">
          {s.name} —{" "}
          {s.state === "uploading"
            ? `${s.pct}%`
            : s.state === "saving"
              ? "extracting details…"
              : s.state === "done"
                ? "✓ added"
                : "✗ failed"}
        </p>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `app/parent/_components/track-card.tsx`**

```tsx
"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { deleteTrack, replaceArtwork, updateTrack } from "@/app/parent/actions";
import type { tracks } from "@/lib/db/schema";

type Track = typeof tracks.$inferSelect;

const KINDS = ["story", "song", "ambient"] as const;

function formatDuration(sec: number | null) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TrackCard({ track }: { track: Track }) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(track.title);

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
            startTransition(() => replaceArtwork(track.id, formData));
          }}
        />
      </label>
      <div className="min-w-0 flex-1 space-y-1">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== track.title) {
              startTransition(() => updateTrack(track.id, { title: title.trim() }));
            }
          }}
          className="w-full rounded bg-transparent text-slate-100 outline-none focus:bg-slate-800 px-1"
        />
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <select
            value={track.kind}
            onChange={(e) =>
              startTransition(() =>
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
      </div>
      <button
        disabled={pending}
        onClick={() => {
          if (confirm(`Delete "${track.title}"?`)) {
            startTransition(() => deleteTrack(track.id));
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

- [ ] **Step 4: Replace `app/parent/page.tsx`**

```tsx
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
      <h1 className="text-xl font-semibold text-slate-100">Library</h1>
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
```

- [ ] **Step 5: End-to-end verification (dev server + browser)**

With `npm run dev` running, in a browser (Playwright MCP): log in → `/parent` → PIN → upload a real mp3 that has ID3 tags/cover art. Verify:
- progress percentage appears, then "✓ added"
- the track card shows the extracted cover art and tag title (not the filename)
- duration displays (from tags or client measurement)
- editing the title persists after reload; changing kind persists
- replacing artwork via tapping the cover works
- delete removes the card, and re-running `node --env-file=.env.local scripts/db-smoke.mjs` style checks (or reloading) shows it gone

Also upload a file with no tags → title is the cleaned filename, placeholder 🎧 shown.

- [ ] **Step 6: Run all checks**

Run: `npm test` → PASS. Run: `npx tsc --noEmit` → clean. Run: `npm run lint` → clean.

- [ ] **Step 7: Commit**

```powershell
git add app/parent next.config.ts
git commit -m "feat: parent library with client uploads and metadata extraction"
```

---

### Task 10: First deploy

**Files:** none (deployment only)

**Interfaces:**
- Consumes: everything above; Vercel project linked in Task 4.
- Produces: a production URL the user can open on their phone.

- [ ] **Step 1: Preview deploy**

```powershell
vercel deploy
```
Expected: preview URL. Open it: login gate works with the *production* `FAMILY_PASSWORD`? — no: preview uses Preview env vars; confirm `FAMILY_PASSWORD`/`PARENT_PIN` exist for Preview (add via `vercel env add FAMILY_PASSWORD preview` if missing).

- [ ] **Step 2: Smoke the preview**

On the preview URL: login → PIN → upload a small mp3 → artwork/title appear. (Uses the same Blob store + Neon DB as all environments.)

- [ ] **Step 3: Production deploy**

```powershell
vercel deploy --prod
```
Expected: production URL. Repeat the smoke test; have the user open it on their phone and log in.

- [ ] **Step 4: Commit any straggler fixes; tag the milestone**

```powershell
git add -A
git commit -m "chore: foundation milestone deployed"
```

---

## Self-review notes

- Spec coverage (Plan 1 scope): password gate ✓ (Task 2), PIN gate ✓ (Task 3), provisioning ✓ (Task 4), schema ✓ (Task 5), upload + extraction pipeline ✓ (Tasks 6–9), first deploy ✓ (Task 10). Kid shelf, playback, scheduling, sleep features, PWA → Plan 2 by design.
- The full schema (playlists/schedule/playbackState) ships in Task 5 even though only `tracks` is used in Plan 1 — one push, no migration churn when Plan 2 starts.
- `/api/upload` bypasses the proxy but re-checks the family cookie in `onBeforeGenerateToken`; the completed-callback is a no-op because finalization is a PIN-gated server action.
