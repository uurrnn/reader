# Plan 2 Handoff — Bedtime Reader

Written 2026-07-21, after Plan 1 (Foundation) shipped. Read this plus the spec before starting Plan 2.

## Where things stand

- **Production is live:** https://reader-ecru-phi.vercel.app (Vercel project `uurrnn-8754s-projects/reader`; note `vercel deploy` targets production by default on this project). GitHub: `git@github.com:uurrnn/reader.git`, branch `master`, everything merged and pushed.
- **Shipped and reviewed:** family-password gate (`proxy.ts`), parent PIN gate, full Drizzle schema (all 5 tables including the Plan-2 ones: `playlists`, `playlist_items`, `schedule`, `playback_state`), Blob client-upload + `music-metadata` tag/artwork extraction, parent library UI at `/parent`. Final whole-branch review verdict: ready to merge, all blocking fixes landed.
- **Infra:** Neon Postgres `neon-bronze-saddle` + Blob store `reader-media`, both linked for all environments. Dev creds in `.env.local`: password `dev-password`, PIN `1234` (Preview env uses these too). Production secrets were set by the user via CLI.
- **Outstanding human check:** log in on a real phone with the production password, enter the PIN, upload one real story. This is the only path never exercised with production secrets. Do it before building on top.

## Plan 2 scope (spec: `docs/superpowers/specs/2026-07-21-bedtime-reader-design.md`)

1. **Kid shelf** (`app/page.tsx`, currently a placeholder): 2-col artwork tile grid, tap adds to the reserved `tonight` playlist, lineup strip, big play button. Audience is an early reader (5–7): artwork-first, short titles, dusk-toned warm palette.
2. **Playback engine** (`lib/audio/engine.ts`): one `<audio>` + Web Audio GainNode, state machine `idle → armed → playing → fading → ambient → stopped`; per-item loop counts (`playlistItems.loopCount`, -1 = infinite) and whole-lineup loop (`playlists.loop`).
3. **Armed scheduling:** open app + one tap arms it (satisfies autoplay policy); Screen Wake Lock; countdown screen; fade-in at `schedule.startTime`; catch-up "start now" if reopened late; Media Session API for lock-screen artwork/controls.
4. **Sleep features:** fade-out over `schedule.fadeSeconds`, hard stop, ambient rollover to `schedule.ambientTrackId` (looping, low volume), dim night screen, resume for long stories via `playback_state` (persist ~10s, only kind=story over ~10 min).
5. **PWA polish:** manifest, icons, install prompt, service-worker app shell (audio streams, no offline cache in v1).

## Carry-over items from the final review (fold into Plan 2 tasks)

- Error surfacing for parent-area mutations (`track-card.tsx` startTransition calls swallow failures) — do EARLY; it's what made the 413 bug silent.
- Rate-limit / fixed-delay on `/login` and `/parent/pin` failures (internet-exposed, no throttling today).
- Parent cookie expiry is browser-only (HMAC has no timestamp; `maxAge` 1h is not server-enforced) — embed expiry in the HMAC message.
- Add `audio/x-m4b` (and check `.m4b` in practice) to the upload allowlist in `app/api/upload/route.ts`.
- `measureDuration` in `upload-form.tsx` needs a ~10s timeout.
- a11y: label the login/PIN inputs.
- Client-side orphan blob (upload succeeds, finalize never called) — accepted for v1; optional orphan-sweep later.
- User-adjudicated: duration 0 stays "unknown" — do not change.

## Gotchas a fresh session must know

- **Next 16.2:** the gate file is `proxy.ts` exporting `function proxy()` but the matcher const MUST be named `config` (`proxyConfig` is silently ignored — verified against framework source). `cookies()`/`searchParams` are async.
- **iOS Safari:** `audio.volume` is read-only — ALL fades must go through a GainNode. This is why the engine design exists.
- **Server actions body limit** is raised to 10mb in `next.config.ts` (`experimental.serverActions.bodySizeLimit`) — artwork replacement breaks without it.
- **neon-http driver** (`lib/db/index.ts`) does NOT support `db.transaction()`. Playlist reordering may need the WebSocket `Pool` driver or batched statements — decide during Plan 2 design, not mid-task.
- **E2E harness:** `npm run e2e` (`scripts/e2e-smoke.mjs`) — needs Chrome, ffmpeg (`C:\Users\uurrn\AppData\Local\ffmpeg\bin\ffmpeg.exe`), `npm run dev` running, dev creds. Drives installed Chrome headless via `playwright-core` `channel: "chrome"`. Extend it for Plan 2 features; it must leave the library empty.
- Auth helpers: `lib/auth.ts` is runtime-agnostic (vitest-safe — no next/headers imports); server-only helpers like `requireParent()` live in `lib/auth-server.ts`. Every mutating server action starts with `await requireParent()` — keep that convention for all new actions.

## Process to resume

Spec is approved; brainstorming is done. Start with **superpowers:writing-plans** to produce `docs/superpowers/plans/<date>-bedtime-reader-player.md` (same format as the foundation plan), get user approval, then execute via **superpowers:subagent-driven-development** on a `feature/player` branch. Progress ledger convention: `.superpowers/sdd/progress.md` (git-excluded).
