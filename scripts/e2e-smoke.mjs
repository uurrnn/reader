// E2E smoke test for the Bedtime Reader parent library.
//
// Prerequisites:
//   - Google Chrome installed locally (driven headless via playwright-core's
//     `channel: "chrome"` — no bundled browser download required).
//   - ffmpeg available at C:\Users\uurrn\AppData\Local\ffmpeg\bin\ffmpeg.exe
//     (override the path with the FFMPEG_PATH env var if it lives elsewhere).
//   - `npm run dev` already running and reachable at http://localhost:3000.
//   - .env.local configured with the dev credentials this script assumes:
//       FAMILY_PASSWORD=dev-password
//       PARENT_PIN=1234
//     plus a real DATABASE_URL / BLOB_READ_WRITE_TOKEN — this flow exercises
//     the actual dev Neon database and Vercel Blob store. The script cleans
//     up every track it creates (and defensively clears any pre-existing
//     tracks first), so the library is empty both before and after a run.
//     BECAUSE OF THAT CLEANUP, the run aborts if the library already has
//     tracks in it (the real family library now lives in this database);
//     set E2E_ALLOW_WIPE=1 to override and destroy whatever is there.
//
// Run: npm run e2e
//
// Covers: login gate (wrong then right password), parent PIN gate, a
// tagged-mp3 upload (title/artwork/duration extracted from ID3 tags), title
// + kind edit persistence across reload, an untagged upload (cleaned
// filename + placeholder icon), a duplicate-filename two-file batch upload,
// artwork replacement with a >1 MB image (regression test for the
// server-action bodySizeLimit fix — this request 413s without it), a
// delete-with-confirm flow, and a final full cleanup that leaves the
// library empty.
//
// Plan 2: shelf/lineup, playback with pause/skip/auto-exit, mocked-clock
// scheduled start, catch-up banner, hidden parent door (2s moon hold
// navigates to /parent; quick tap must not).

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = "http://localhost:3000";
const FFMPEG = process.env.FFMPEG_PATH ?? "C:\\Users\\uurrn\\AppData\\Local\\ffmpeg\\bin\\ffmpeg.exe";
const ROW_SELECTOR = "div.flex.items-center.gap-4";
const MIN_ARTWORK_BYTES = 1024 * 1024; // 1 MB

let passCount = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  passCount += 1;
  console.log("PASS:", msg);
}

function ffmpeg(args) {
  execFileSync(FFMPEG, ["-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
}

function buildFixtures(dir) {
  const coverPng = path.join(dir, "cover.png");
  const taggedMp3 = path.join(dir, "gruffalo-test.mp3");
  const dupMp3 = path.join(dir, "dup", "gruffalo-test.mp3");
  const untaggedMp3 = path.join(dir, "rain_sounds.mp3");
  const bigArtworkJpg = path.join(dir, "big-artwork.jpg");

  fs.mkdirSync(path.join(dir, "dup"), { recursive: true });

  // 300x300 orange cover art, embedded below as an ID3 attached picture.
  ffmpeg(["-f", "lavfi", "-i", "color=c=orange:s=300x300", "-frames:v", "1", coverPng]);

  // 3s tagged tone: TIT2 = "The Gruffalo Test", cover embedded as APIC.
  ffmpeg([
    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
    "-i", coverPng,
    "-map", "0:a", "-map", "1:v",
    "-c:a", "libmp3lame",
    "-id3v2_version", "3",
    "-metadata", "title=The Gruffalo Test",
    "-c:v", "png",
    "-disposition:v", "attached_pic",
    taggedMp3,
  ]);

  // Same fixture, different directory — same basename, for the
  // duplicate-filename batch-upload regression check.
  fs.copyFileSync(taggedMp3, dupMp3);

  // 30s untagged tone: no title tag, no artwork, no ID3v1 fallback. Longer
  // than the tagged fixture because "rain sounds" plays first in the player
  // test below; a 3s track could end mid-pause-assertion and flake.
  ffmpeg([
    "-f", "lavfi", "-i", "sine=frequency=220:duration=30",
    "-c:a", "libmp3lame",
    "-map_metadata", "-1",
    "-write_id3v1", "0",
    untaggedMp3,
  ]);

  // High-entropy noise JPEG, large enough to comfortably exceed 1 MB — this
  // is what would 413 against the default 1 MB server-action body limit.
  ffmpeg([
    "-f", "lavfi", "-i", "nullsrc=size=1600x1200,geq=random(1)*255:128:128:0",
    "-frames:v", "1",
    "-q:v", "2",
    "-update", "1",
    bigArtworkJpg,
  ]);
  const bigArtworkBytes = fs.statSync(bigArtworkJpg).size;
  assert(
    bigArtworkBytes > MIN_ARTWORK_BYTES,
    `generated artwork fixture is >1 MB (${bigArtworkBytes} bytes)`,
  );

  return { coverPng, taggedMp3, dupMp3, untaggedMp3, bigArtworkJpg, bigArtworkBytes };
}

// Deletes every card currently in the library via the UI delete-with-confirm
// flow, then asserts the library is empty. Used both as defensive cleanup
// before the run (in case a previous run left residue) and as the final
// cleanup step.
async function clearLibrary(page, label) {
  for (let i = 0; i < 25; i++) {
    const count = await page.locator(ROW_SELECTOR).count();
    if (count === 0) break;
    await page.locator(ROW_SELECTOR).first().locator('button:has-text("Delete")').click();
    await page.waitForTimeout(600);
  }
  await page.reload();
  await page.waitForTimeout(300);
  const remaining = await page.locator(ROW_SELECTOR).count();
  assert(remaining === 0, `library is empty ${label}`);
}

async function main() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "reader-e2e-"));
  console.log("fixture dir:", fixtureDir);
  const fixtures = buildFixtures(fixtureDir);

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") console.log("[browser console error]", m.text());
    });
    page.on("dialog", async (dialog) => {
      console.log("[dialog]", dialog.type(), dialog.message());
      await dialog.accept();
    });

    // --- Step 1: login gate (wrong then right password) ---
    await page.goto(BASE + "/");
    await page.waitForURL(/\/login/);
    assert(page.url().includes("/login"), "redirected to /login when unauthenticated");

    await page.fill('input[name="password"]', "wrong-password");
    await page.click('button[type="submit"]');
    // The login action throttles failed attempts with a ~1.5s delay before
    // redirecting to /login?error=1; wait on that redirect rather than a
    // fixed sleep so this doesn't flake against the throttle.
    await page.waitForURL(/error=1/, { timeout: 5000 });
    assert(
      /not it|try again/i.test((await page.textContent("body")) ?? ""),
      "wrong password shows an error message",
    );
    assert(page.url().includes("/login"), "still on /login after wrong password");

    await page.fill('input[name="password"]', "dev-password");
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 5000 });
    assert(!page.url().includes("/login"), "correct password navigates away from /login");

    // --- Step 2: parent PIN gate ---
    await page.goto(BASE + "/parent");
    await page.waitForURL(/\/parent\/pin/);
    assert(page.url().includes("/parent/pin"), "redirected to /parent/pin");

    await page.fill('input[name="pin"]', "1234");
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname === "/parent", { timeout: 5000 });
    await page.waitForSelector("h1");
    assert((await page.textContent("h1"))?.trim() === "Library", "landed on Library page after correct PIN");

    // Substring match: the upload input's accept attribute now also lists
    // ".m4b" (added for m4b upload support), so an exact-value selector
    // would no longer match.
    const fileInput = page.locator('input[type="file"][accept*="audio/*"]');

    // Everything below wipes and repopulates the library against the real
    // dev database and blob store. The real family library lives there now,
    // so refuse to continue if tracks already exist.
    const preexisting = await page.locator(ROW_SELECTOR).count();
    if (preexisting > 0 && !process.env.E2E_ALLOW_WIPE) {
      throw new Error(
        `library already has ${preexisting} track(s); this run would delete them all. ` +
          "Set E2E_ALLOW_WIPE=1 to run anyway (this DESTROYS the library and its blobs).",
      );
    }

    // Defensive cleanup in case a previous interrupted run left residue.
    await clearLibrary(page, "at start (defensive cleanup)");

    // --- Step 3: tagged-mp3 upload — title/artwork/duration extraction ---
    await fileInput.setInputFiles(fixtures.taggedMp3);
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("p")).some((p) => p.textContent?.includes("added")),
      { timeout: 20000 },
    );
    await page.waitForTimeout(1000);
    await page.waitForSelector('input[value="The Gruffalo Test"]', { timeout: 10000 });
    assert(true, 'tagged upload card shows title "The Gruffalo Test" (from ID3 tag, not filename)');
    assert((await page.locator("img").count()) >= 1, "artwork <img> rendered from embedded ID3 cover");
    const bodyAfterTaggedUpload = await page.textContent("body");
    assert(/0:0[2-4]/.test(bodyAfterTaggedUpload ?? ""), "duration displays as e.g. 0:03");

    // --- Step 4: title + kind edit persistence across reload ---
    const titleHandle = await page.locator('input[value="The Gruffalo Test"]').first().elementHandle();
    await titleHandle.fill("The Gruffalo Renamed");
    await titleHandle.evaluate((el) => el.blur());
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForSelector('input[value="The Gruffalo Renamed"]', { timeout: 10000 });
    assert(true, "renamed title persisted after reload");

    const kindSelect = page.locator("select").first();
    await kindSelect.selectOption("song");
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForSelector('input[value="The Gruffalo Renamed"]', { timeout: 10000 });
    assert((await page.locator("select").first().inputValue()) === "song", "kind change persisted after reload");

    // --- Step 5: untagged upload — cleaned filename + placeholder ---
    await fileInput.setInputFiles(fixtures.untaggedMp3);
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("p")).filter((p) => p.textContent?.includes("added")).length >= 1,
      { timeout: 20000 },
    );
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForSelector('input[value="rain sounds"]', { timeout: 10000 });
    assert(true, 'untagged upload card titled "rain sounds" (cleaned filename)');
    assert(((await page.textContent("body")) ?? "").includes("🎧"), "🎧 placeholder shown for track with no artwork");

    // --- Step 6: duplicate-filename two-file batch upload ---
    const cardCountBeforeBatch = await page.locator(ROW_SELECTOR).count();
    await fileInput.setInputFiles([fixtures.taggedMp3, fixtures.dupMp3]);
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("p")).filter(
          (p) => p.textContent?.includes("gruffalo-test.mp3") && p.textContent?.includes("added"),
        ).length >= 2,
      { timeout: 30000 },
    );
    const statusLines = await page.locator("p", { hasText: "gruffalo-test.mp3" }).allTextContents();
    assert(statusLines.length === 2, "two separate status entries rendered for the duplicate-name batch");
    assert(statusLines.every((t) => t.includes("added")), 'both status entries independently reached "✓ added"');
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForTimeout(500);
    const cardCountAfterBatch = await page.locator(ROW_SELECTOR).count();
    assert(
      cardCountAfterBatch === cardCountBeforeBatch + 2,
      `two new cards appeared after the duplicate batch (before=${cardCountBeforeBatch}, after=${cardCountAfterBatch})`,
    );
    assert(
      (await page.locator('input[value="The Gruffalo Test"]').count()) === 2,
      'two distinct cards titled "The Gruffalo Test" exist after the batch',
    );

    // --- Step 7: artwork replacement with a >1 MB image ---
    // This is the regression test for the server-action bodySizeLimit fix:
    // without it, Next.js defaults server-action bodies to 1 MB and this
    // multipart POST (sent directly as FormData, not via the blob client
    // upload route) would 413.
    const rainRowSelector = 'input[value="rain sounds"]';
    const rainRow = page.locator(ROW_SELECTOR, { has: page.locator(rainRowSelector) });
    assert((await rainRow.count()) === 1, "rain sounds card present before artwork replacement");
    assert((await rainRow.locator("img").count()) === 0, "rain sounds card has no artwork <img> yet (placeholder)");

    const artworkFileInput = rainRow.locator('input[type="file"][accept="image/*"]');
    const artworkResponsePromise = page.waitForResponse(
      (res) => res.request().method() === "POST" && res.url() === BASE + "/parent",
      { timeout: 20000 },
    );
    await artworkFileInput.setInputFiles(fixtures.bigArtworkJpg);
    const artworkResponse = await artworkResponsePromise;
    console.log(
      `artwork replacement POST status: ${artworkResponse.status()} (fixture size ${fixtures.bigArtworkBytes} bytes)`,
    );
    assert(
      artworkResponse.status() < 400,
      `artwork replacement request for a >1MB image succeeded (status ${artworkResponse.status()}, not a 413)`,
    );
    await rainRow.locator("img").waitFor({ state: "attached", timeout: 10000 });
    assert((await rainRow.locator("img").count()) >= 1, "artwork <img> now rendered after >1MB replacement");

    await page.reload();
    await page.waitForSelector(rainRowSelector, { timeout: 10000 });
    const rainRowAfterReload = page.locator(ROW_SELECTOR, { has: page.locator(rainRowSelector) });
    assert((await rainRowAfterReload.locator("img").count()) >= 1, "large artwork persisted after reload");

    // --- Step 8: delete-with-confirm ---
    const renamedSelector = 'input[value="The Gruffalo Renamed"]';
    const renamedRow = page.locator(ROW_SELECTOR, { has: page.locator(renamedSelector) });
    assert((await renamedRow.count()) === 1, "renamed card present before delete");
    await renamedRow.locator('button:has-text("Delete")').click();
    await page.waitForSelector(renamedSelector, { state: "detached", timeout: 15000 });
    assert((await page.locator(renamedSelector).count()) === 0, "card gone from DOM after confirmed delete");
    await page.reload();
    await page.waitForTimeout(500);
    assert((await page.locator(renamedSelector).count()) === 0, "deleted card still gone after reload");

    // --- Step 9: kid shelf + lineup ---
    await page.goto(BASE + "/");
    await page.waitForSelector('[data-testid="shelf-grid"]');

    // Hidden parent door: a quick tap on the moon must do nothing; holding
    // it for 2s must navigate to /parent (already parent-authed here).
    const moon = page.locator('[data-testid="parent-door"]');
    await moon.click();
    await page.waitForTimeout(2500);
    assert(
      new URL(page.url()).pathname === "/",
      "quick tap on the moon does not open the parent door",
    );
    const moonBox = await moon.boundingBox();
    await page.mouse.move(moonBox.x + moonBox.width / 2, moonBox.y + moonBox.height / 2);
    await page.mouse.down();
    await page.waitForURL((u) => u.pathname === "/parent", { timeout: 5000 });
    await page.mouse.up();
    assert(true, "holding the moon for 2s opens the parent page");
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
      // Dispatch the click via an in-page DOM call rather than
      // Playwright's coordinate-based click: the Next.js dev-mode devtools
      // indicator (<nextjs-portal>, dev-only chrome never present in
      // production) sits on top of the bottom-docked lineup strip at these
      // coordinates and swallows real/forced pointer input. A direct
      // element.click() still fires React's onClick via event bubbling
      // without going through screen-coordinate hit-testing.
      await page.locator('[data-testid="lineup-item"]').first().evaluate((el) => el.click());
      await page.waitForTimeout(500);
    }
    assert(
      (await page.locator('[data-testid="lineup-item"]').count()) === 0,
      "tonight lineup cleared",
    );
    await page.goto(BASE + "/parent");

    // --- Step 14: full cleanup — library ends empty ---
    await clearLibrary(page, "after full cleanup");

    console.log(`\nALL ${passCount} ASSERTIONS PASSED`);
  } finally {
    await browser.close();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("E2E FAILED:", err);
    process.exit(1);
  });
