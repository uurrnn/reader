# Remove family password gate — design

Date: 2026-07-21
Status: approved (in-session)

## Goal

The app no longer asks for a family password. Opening the app lands directly on
the kid shelf. Parent mode keeps its PIN gate unchanged.

## Changes

### Gates

- `proxy.ts`: delete the family-cookie check. Matcher shrinks to
  `"/parent/:path*"`; the handler keeps the existing `/parent/pin` exception
  and the parent-token redirect. All non-parent routes are public.
- `app/api/upload/route.ts`: `onBeforeGenerateToken` validates the **parent**
  cookie (`isValidParentToken` + `PARENT_PIN`) instead of the family cookie.
  Uploads are only initiated from `/parent` pages, which require a live PIN
  session, so the flow is unchanged for the parent. The route must not become
  public (blob-write access).

### Deletions

- `app/login/` (page + server action).
- `lib/auth.ts`: `FAMILY_COOKIE`, `familyToken`, `isValidFamilyToken`.
- `lib/auth-server.ts`: `requireFamily`.
- `app/actions.ts`: the five `requireFamily()` calls (tonight playlist
  add/remove/reorder, resume save/clear become unauthenticated — accepted).
- `lib/auth.test.ts`: `familyToken` tests and the family/parent
  domain-separation test. Parent-token tests stay.
- `.env.local`: `FAMILY_PASSWORD` line. The Vercel-side env var becomes unused
  and can be deleted from the dashboard at leisure.

### e2e (`scripts/e2e-smoke.mjs`)

Step 1 ("login gate") is replaced by "no login gate": `/` loads the shelf with
no redirect; `/parent` still redirects to `/parent/pin`. `FAMILY_PASSWORD` is
no longer read by the script.

## Accepted consequences

- Anyone with the URL can view the shelf, play tracks, and call the kid
  actions (playlist composition, resume positions). All content-changing
  parent actions (upload, delete, artwork, schedule) remain PIN-gated.
- Stale `family_session` cookies on devices are ignored; no migration needed.

## Verification

`npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, plus live
Playwright checks against the dev server: `/` renders the shelf without
redirect, `/parent` bounces to `/parent/pin`. The full `npm run e2e` suite is
NOT run against the dev DB (wipe guard; real library lives there).
