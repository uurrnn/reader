# Bedtime Audio Reader — Design Spec

## Context

A personal family web app (PWA) that plays bedtime stories and songs for an early reader (age 5–7). The goal is a purpose-built player: a parent-managed cloud library of audio files, a kid-facing picker built around cover artwork, and reliable "start tonight's stories at 8:30 PM" behavior — plus bedtime-specific touches (gentle fade-out, ambient sound after the stories end, a dim night screen, resume for long audiobooks).

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Playback device | Parent's phone; app is opened before bedtime and left open ("armed" model) |
| Library home | Cloud: admin upload page → Vercel Blob; metadata + cover art extracted server-side |
| Who operates it | Kid picks stories from artwork tiles; everything else in a PIN-gated parent area |
| Audience | Early reader (5–7): artwork-first UI, short titles as support |
| Sleep features | All four: sleep timer + fade-out, ambient sound after queue, night screen, resume long stories |
| Access control | One shared family password (env var, long-lived cookie); parent area behind a short PIN |
| Stack | Next.js 16 (App Router) on Vercel + Vercel Blob + Neon Postgres (Drizzle) |

## Storage model (files vs. catalog)

Audio files and cover images are stored as objects in **Vercel Blob** (in the family's own Vercel account). **Postgres stores only the catalog**: titles, kinds, durations, and the blob URLs. Object storage gives the `<audio>` element a direct, CDN-cached URL with HTTP range-request support (instant seeking in long audiobooks); the database stays small and fast. Deleting a track in admin deletes both the row and its blobs.

Blob URLs are public-but-unguessable (long random suffix) and the app itself is password-gated. If stricter privacy is ever wanted, Vercel Blob supports private files with expiring signed URLs — a swap that doesn't change the schema.

## Why "armed" scheduling works (key constraint)

Browsers only allow audio playback after a user gesture, and phones suspend background tabs — so a closed PWA cannot wake itself at 8:30. Instead: the parent opens the app any time before bed and taps **Arm** once. That tap satisfies the autoplay policy for the session; the app holds a Screen Wake Lock, shows a countdown, and starts playback (fading in) at the scheduled time. If the OS killed the tab anyway, reopening after start time offers "start now" immediately.

iOS caveat that shapes the code: `audio.volume` is read-only on iOS Safari, so all fades must go through a Web Audio `GainNode`, not the volume property.

## Architecture

Single Next.js App Router project, one Vercel deploy.

```
Phone PWA  ──  Next.js on Vercel
                │          │
        Neon Postgres   Vercel Blob
        (tracks, playlists,  (audio files,
         schedule, resume)    cover images)
```

### Data model (Drizzle schema, `lib/db/schema.ts`)

- `tracks` — id, title, kind (`story` | `song` | `ambient`), audioUrl, artworkUrl (nullable → placeholder art), durationSec (nullable), createdAt
- `playlists` — id, name, loop (boolean: repeat the whole lineup); a reserved playlist named `tonight` is the kid-editable lineup
- `playlistItems` — playlistId, trackId, sortOrder, loopCount (null = once, -1 = infinite)
- `schedule` — single row: enabled, startTime (`"20:30"` local), fadeSeconds, hardStopTime (nullable), ambientTrackId (nullable)
- `playbackState` — trackId, positionSec, updatedAt (resume for long stories; only persisted for kind=story over ~10 min)

### Auth

- `proxy.ts` (Next 16's rename of `middleware.ts`): every route except `/login` and framework assets requires a signed HttpOnly cookie. `/login` posts the family password (compared against `FAMILY_PASSWORD` env var) via a server action; sets a ~1-year cookie.
- `/parent/*` additionally requires a short-lived PIN cookie (`PARENT_PIN` env var, ~1 hour); simple PIN pad screen at `/parent/pin`.
- Cookie values are HMAC-SHA256 tokens keyed by the secret itself, so changing the password/PIN invalidates all existing cookies.

### Upload & metadata pipeline

Large audio files bypass function body limits via client uploads:

1. Browser measures the file's duration locally (`<audio preload="metadata">` on an object URL), then uploads the raw file with `@vercel/blob/client` `upload()`; the token-generation route (`app/api/upload/route.ts`) authorizes via the family cookie.
2. Browser calls the `finalizeTrack` server action (PIN-gated via `/parent`) with the blob URL, filename, and client-measured duration. (This replaces Blob's `onUploadCompleted` callback, which cannot reach localhost during development.)
3. Server streams the blob through `music-metadata`: extracts title, duration, and embedded cover art (ID3/MP4 tags) → cover art stored as its own blob → `tracks` row inserted. Extraction failure still creates the track (cleaned-up filename as title, placeholder artwork). Parent area allows editing title/kind and replacing artwork manually.

### Playback engine (`lib/audio/engine.ts`, client)

One `<audio>` element + Web Audio GainNode, wrapped in a small state machine:

`idle → armed(waiting) → playing(item n) → fading → ambient → stopped`

- Handles per-item loop counts and whole-lineup loop
- Fade-out over `fadeSeconds` at end-of-timer / hard stop; fade-in at scheduled start
- Ambient rollover: when the last lineup item ends, crossfade into the configured ambient track at low volume, looping
- Persists `currentTime` every ~10s for resumable stories; lineup offers "continue from last night"
- On `error` from the audio element: skip to next item silently (no alerts at bedtime)
- Screen Wake Lock while armed/playing; Media Session API for lock-screen controls + artwork

### UI surfaces

1. **Kid shelf** (`app/page.tsx`, default screen): 2-column grid of large cover tiles; tapping a cover adds it to "tonight's lineup" with a playful animation; a lineup strip along the bottom shows the 1–4 chosen covers; one big play button. Dusk-toned warm palette, rounded and friendly, readable short titles.
2. **Armed/countdown screen**: "Tonight at 8:30" with the lineup covers, countdown, and a Start Now button.
3. **Night screen** (auto-enters during playback): near-black warm background, artwork at low opacity, tiny clock, giant pause, skip.
4. **Parent area** (`app/parent/*`): library (upload, edit, artwork, delete), playlists, schedule settings (time, fade, ambient track, hard stop), general settings. Functional/dense UI is fine here; plain Tailwind, no component library required.

### PWA

`manifest.webmanifest` + icons (installable, standalone), minimal service worker caching the app shell only. Audio streams from Blob in v1 — offline caching of tonight's lineup is an explicit future enhancement.

## Key libraries

`next` 16, `tailwindcss` v4, `drizzle-orm` + `@neondatabase/serverless`, `drizzle-kit`, `@vercel/blob`, `music-metadata`, `vitest`.

## Build order

Two implementation plans, each shipping working software:

**Plan 1 — Foundation** (`docs/superpowers/plans/2026-07-21-bedtime-reader-foundation.md`)
1. Family-password gate (`proxy.ts` + `/login`) and parent PIN gate
2. Provision Neon + Blob via Vercel; Drizzle schema pushed
3. Parent library: client upload, metadata/artwork extraction, track CRUD
4. First production deploy

**Plan 2 — Player** (written after Plan 1 completes)
5. Kid shelf + tonight's lineup + playback engine (play/next/loop)
6. Scheduling: armed mode, countdown, wake lock, media session, catch-up "start now"
7. Sleep features: GainNode fades, ambient rollover, night screen, resume
8. PWA polish: manifest, icons, install prompt, service-worker app shell

## Verification

- **Unit** (Vitest): auth token round-trips, metadata mapping (tag title vs. filename fallback, duration rounding, artwork passthrough), scheduler decisions as pure functions, loop counting, fade curve math.
- **E2E** (Playwright MCP tools): log in → upload a real mp3 → verify tile shows extracted artwork → build a lineup → mock the clock to trigger a scheduled start → verify playback order, fade, ambient rollover.
- **Real-device sanity** (manual, with the user): install to phone home screen; verify armed mode survives screen dim, fades work (GainNode), lock-screen shows artwork/controls.

## Out of scope for v1 (noted future ideas)

Offline caching of tonight's audio; multiple kid profiles; casting to speakers; push-notification "time to arm" reminder; private blob storage with signed URLs.
