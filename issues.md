# Hushare Issues

---

## #1 — Arrangement: "Could not save media order" on large albums
**Status:** FIXED  
**Area:** API — `/api/album/photos/reorder`, `src/components/PhotoGrid.tsx`

**Problem (1a — saving):** On albums with many photos, saving drag-and-drop order failed with "Could not save media order". Root cause was N individual UPDATE queries fired in parallel, exhausting Supabase's connection pool.

**Fix (1a):** Replaced all individual row UPDATEs with a single PostgreSQL RPC call (`batch_set_sort_order`) using `unnest()` — one atomic round-trip, zero partial-failure risk.  
**Files:** `supabase/migrations/20260524_batch_sort_order_rpc.sql`, `src/app/api/album/photos/reorder/route.ts`

---

**Problem (1b — swap logic):** `movePhoto` used "insert-before" (splice + re-insert). Dragging photo A to photo B's slot inserted A before B and shifted every photo between their positions by one. In a 60-photo album, dragging from position 3 to position 47 moved 44 photos. Users saw the dragged photo go to the right place but everything else shift unexpectedly.

**Fix (1b):** Changed to a direct swap: `[nextPhotos[from], nextPhotos[to]] = [nextPhotos[to], nextPhotos[from]]`. Only two photos change positions; everything else is untouched. Also fixes "50+ album order looks wrong" since large shifts no longer happen.  
**File:** `src/components/PhotoGrid.tsx` — `movePhoto()`

---

**Problem (1c — drag broken on desktop + mobile scroll conflict):** Timer-based drag had two fatal flaws: (1) on desktop, any mouse movement off the tile before the 1000ms timer fired triggered `onPointerLeave` → `clearReorderTimer()` → drag cancelled silently. (2) on mobile, a 150ms timer still allowed the browser to claim the touch as a scroll gesture before `setPointerCapture` could take over. A partial fix added `startDragFromHandle` with its own `onPointerDown` + `stopPropagation`, but that function read `reorderDraggingId` / `reorderTargetId` STATE from inside `finishReorder`, which may not be committed yet — so `finishReorder` saw null and never called `movePhoto`. Drags silently succeeded visually but didn't swap anything.

**Fix (1c — permanent):**
- `startReorderPress` now handles arrange mode inline: checks `(e.target).closest('[data-drag-handle]')`. If from the handle: immediately sets both refs (`reorderDragIdRef`, `reorderTargetIdRef`) and calls `setPointerCapture` on `e.currentTarget` (the tile) — no timer, no `stopPropagation`, no separate function.
- `startDragFromHandle` deleted entirely.
- `handleReorderMove` now also writes `reorderTargetIdRef.current` alongside `setReorderTargetId`.
- `finishReorder` reads `reorderDragIdRef.current` and `reorderTargetIdRef.current` (refs, always current) instead of the stale state values — root cause of the swap never happening.
- Desktop hold-to-select timer reduced from 1000ms → 500ms.
- Handle icon changed from `GripVertical` to `ArrowLeftRight` (swap metaphor).

**File:** `src/components/PhotoGrid.tsx` — `startReorderPress`, `handleReorderMove`, `finishReorder`, tile `useMemo`, imports

---

## #2 — thumb_path / thumb_url columns missing from DB
**Status:** FIXED  
**Area:** Database / migrations

**Problem:** No migration added `thumb_path` / `thumb_url` to the `photos` table. The `photos/create` route had a fallback that silently stripped them on insert. Every image loaded full-resolution in the grid instead of a small preview thumbnail. Thumbnail data generated client-side was wasted work.

**Fix:** Added `supabase/migrations/20260525_photos_thumbnails.sql` — two `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for `thumb_path text` and `thumb_url text`. The upload pipeline (UploadZone) and API route (photos/create) already handled these fields correctly; the DB was the only missing piece. Also removed the now-dead fallback strip logic from the API route.  
**Files:** `supabase/migrations/20260525_photos_thumbnails.sql`, `src/app/api/album/photos/create/route.ts`

---

## #3 — Image upload "Failed to fetch" — random partial-batch failures
**Status:** FIXED  
**Area:** Upload — `src/components/UploadZone.tsx`

**Problem:** On solid connections, 4–5 out of 20 image uploads would randomly fail with "Failed to fetch". In guest/incognito mode the failure rate was near-total (1/51 succeeded). Root causes:
1. `supabase.storage.upload()` (JS SDK) uses plain `fetch()` with no timeout. Under 3–5 concurrent workers, a single hanging request occupied a browser HTTP/1.1 connection slot indefinitely. Once all ~6 slots to `supabase.co` filled up, every new request failed immediately with "Failed to fetch" — even on a solid connection.
2. Missing `apikey: {anonKey}` header. The SDK always sends this alongside `Authorization`. Without it, Cloudflare's edge drops the connection silently (onerror, not a 4xx) for anonymous/guest uploads.
3. 5 workers each calling `supabase.auth.getSession()` simultaneously in incognito triggered concurrent auth-state reads on the fresh SSR cookie-client.

**Fix:** Replaced all `supabase.storage.upload()` calls with direct XHR to the Supabase Storage REST API:
- `xhr.timeout = R2_SINGLE_UPLOAD_TIMEOUT_MS` — prevents indefinitely hanging connections
- Added `apikey: supabaseAnonKey` header to every request
- `getUploadToken()` deduplicates concurrent `getSession()` calls with a shared module-level promise
- Retry loop: 5 attempts, 500/1000/1500/2000ms backoff, retries on network errors and 5xx; throws immediately on 4xx
- 409 "already exists" is treated as success

**Result:** 56 images in ~40s (guest/incognito), 100 images in ~1 min (authenticated). Zero failures.  
**Files:** `src/components/UploadZone.tsx`, `src/lib/supabase.ts`

---

## #4 — Video chunk upload fails — "network error on chunk N"
**Status:** PARTIALLY FIXED — root cause identified  
**Area:** Upload — `uploadVideoMultipart`, `uploadVideoToStream`, `r2/multipart/route.ts`

**Root cause:** Two separate problems converging:

1. **Stream not configured.** `wrangler.toml` has no `CLOUDFLARE_STREAM_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secret. Every `POST /api/upload/stream/tus` returns 503 → client immediately falls back to R2 multipart. For Stream, the video bytes go directly from browser to Cloudflare's servers (the Worker only negotiates the upload URL), bypassing any Worker/carrier timeout entirely. Since Stream is misconfigured, this fast path is never used.

2. **R2 multipart chunks route through the Worker.** When Stream isn't available, 5 MB chunks are POSTed browser → Worker → R2. If the total round-trip exceeds ~30–60 s (slow mobile, large file), the carrier proxy or Cloudflare drops the connection mid-transfer and the browser sees `xhr.onerror` → "network error on chunk N". Since R2 enforces a 5 MiB minimum per part, we cannot reduce chunk size to sidestep the timeout.

**Fixes applied (2026-05-28):**
- `r2/multipart/route.ts`: body reading moved inside try/catch; used `req.arrayBuffer()` safely.
- `constants.ts`: `STREAM_CHUNK_SIZE_BYTES` 5 MiB → 1 MiB. TUS has no minimum; 1 MiB = ~12 s at 100 KB/s, well under any carrier timeout.
- `next.config.ts`: added `upload.cloudflarestream.com` and `*.cloudflarestream.com` to `connect-src`. This was the blocking bug — CSP silently refused every TUS PATCH, forcing all videos to the slow R2 fallback. Confirmed by browser console: "Refused to connect because it violates Content Security Policy."
- `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_STREAM_TOKEN` set as Cloudflare secrets.
- `photo/mirror/route.ts`: after R2 mirror succeeds, Stream video is deleted automatically (Stream-as-relay pattern). Prevents quota buildup at scale.
- `LightboxOverlay.tsx`: when `mirror_url` is set, video plays from R2 directly instead of Stream iframe. Stream iframe only used while mirror is still in progress.
- `constants.ts`: `UPLOAD_CONCURRENCY_MOBILE` 3 → 2. Mobile cellular drops burst connections when 3+ concurrent XHRs hit the same host.

**Remaining — R2 presigned URLs for fallback path (not yet built):**
When Stream is unavailable, the fallback is still Worker-proxied R2 multipart (5 MiB chunks, Worker buffers in RAM). Two problems remain: (1) Worker holds the connection idle after the browser finishes uploading, while it waits for the R2 binding call to complete — this idle gap is when carriers kill the connection, not the upload itself; (2) Worker RAM pressure under concurrent load. Fix: generate a presigned S3 PUT URL per chunk in the Worker, return it to the browser, browser PUTs directly to R2. The signing code is already written for Rekognition in `src/lib/rekognition.ts`. Needs: R2 Access Key ID + Secret as Cloudflare secrets.

**Stream quota monitoring (operational risk):**
Free tier = 1,000 minutes stored. With Stream-as-relay, videos live in Stream only until the mirror job completes (seconds to minutes). Steady-state storage ≈ 0. Risk: at a large concurrent event (200+ simultaneous uploads of 2-min clips), transient storage could approach 400 minutes. Monitor via Cloudflare Stream Analytics. If sustained burst load becomes common, upgrade to the paid tier ($0.50/1,000 minutes) or implement server-side mirror triggering (Worker fetches and mirrors to R2 after Stream processing, so the browser tab doesn't need to stay open).

**Files changed:** `src/app/api/upload/r2/multipart/route.ts`, `src/lib/constants.ts`, `next.config.ts`, `src/app/api/album/photo/mirror/route.ts`, `src/components/photo-grid/LightboxOverlay.tsx`

---

## #5 — Upload stops / freezes when tab is backgrounded
**Status:** OPEN  
**Area:** Upload — UploadZone.tsx / Web Locks

**Problem:** The Web Locks API (`navigator.locks.request`) doesn't fully prevent throttling on iOS Safari when the tab is hidden. Long uploads (100+ photos, any video) pause until the user returns to the tab. No Service Worker is in place as a proper fix.

---

## #6 — Album share link has no OG thumbnail
**Status:** FIXED  
**Area:** SEO / `src/app/[slug]/page.tsx`

Uses cover photo if set, falls back to first photo in album, falls back to brand OG image. Reveal-time albums don't expose the cover before unlock.

---

## #7 — No way to create a second collection from the website
**Status:** FIXED  
**Area:** `src/app/account/CreateCollectionButton.tsx`, `src/app/account/page.tsx`

"New collection" button added to the account dashboard, visible to Studio tier users.

---

## #8 — No E2E test suite — bugs only found manually
**Status:** OPEN  
**Area:** Testing / CI

**Problem:** There is no automated end-to-end test suite (Playwright, Cypress, etc.). Upload failures, arrangement bugs, and missing DB columns were all found by hand. Any new deployment can silently regress any of the above.

---

## #9 — Face Finder has no rate limiting on the search endpoint
**Status:** FIXED  
**Area:** API — `/api/album/face-search`

**Fix:** In-memory per-isolate rate limiter — 10 searches per IP per 60 seconds. Returns 429 with `Retry-After: 60` when exceeded. Map is pruned when it exceeds 5,000 entries to prevent unbounded growth. Cloudflare's consistent-hash routing means a single abusing IP hits the same isolate repeatedly, making per-isolate limits effective against looping abuse.

---

## Future / Version 2 items

- Competitor analysis & feature gap list
- Full billing model + profit/loss calculation  
- Mobile UI/UX polish pass  
- UI polish (desktop + mobile)  

---

## Suggestions

Items from competitive analysis and internal audit. Not bugs — things to build, change, or remove when the time is right. Ordered by estimated impact.

---

### S1 — OG image for album share links
**Priority: High**  
**Area:** SEO / `src/app/[slug]/page.tsx`

When a host pastes their album link into WhatsApp, iMessage, or Slack, there is no preview image — just a raw URL. This is how 90% of album links get distributed. Set `og:image` to the album's cover photo, or the first photo if no cover is set. One route + one meta tag. Highest return-on-effort item on this list.

---

### S2 — AI content moderation
**Priority: High**  
**Area:** Upload pipeline / `src/app/api/album/photos/create/route.ts`

Without moderation, the product is unusable for corporate events and school functions. A single inappropriate upload on a venue projector ends the relationship. AWS Rekognition already integrated — `DetectModerationLabels` can be called on upload. Add a per-album toggle in owner settings (off by default, on for Pro+). Kululu charges $99/event for this. We can ship it as a Pro feature.

---

### S3 — Move Face Finder down to Pro tier
**Priority: High**  
**Area:** `src/app/api/album/resolve/route.ts`, `src/lib/subscriptions.ts`, pricing page

Face Finder is the strongest technical differentiator in the market. Currently gated to Max ($10/month). GuestCam charges $45/event as an add-on — our subscription model is already cheaper annually for repeat users, but only if they can access the feature. Moving Face Finder to Pro ($4/month) makes the Pro upgrade dramatically more compelling and removes the main reason a wedding host would evaluate GuestCam instead.

---

### S4 — Audio guestbook
**Priority: High**  
**Area:** New feature

GuestCam's single biggest differentiator. Guests record a short voice message via browser (WebRTC) — no app, no phone number needed. Stored alongside photos. Hosts get an emotional keepsake a photo grid alone can't replace. This is the one feature that makes GuestCam feel irreplaceable at weddings. Removing that advantage closes the main competitive gap.

---

### S6 — QR code download in owner toolbar
**Priority: Medium**  
**Area:** `src/components/OwnerToolbar.tsx`

Every competitor generates a downloadable QR code for the album. Right now hosts have to use a third-party site to get a QR code for their table cards. This should be a one-click download in the owner toolbar — generate a PNG of the album URL as a QR code using a client-side library (e.g. `qrcode`). No backend needed.

---

### S7 — Multi-language guest interface
**Priority: Medium**  
**Area:** `src/app/[slug]/page.tsx`, guest-facing components

GuestCam supports 17 languages. Destination weddings and international events have guests who don't speak English. Auto-detect from `Accept-Language` header; priority markets are Portuguese, Spanish, French. Only the guest-facing strings need translating — owner UI can stay English for now.

---

### S8 — Create collection from the account dashboard
**Priority: Medium**  
**Area:** Account page / `src/components/OwnerToolbar.tsx`

Currently the only way to create a collection is through an album's owner toolbar → Settings → "Add to collection". If no collection exists yet, that path works. Once one collection exists, there is no way to create a second one — no standalone button anywhere. Max users paying for Collections can only have one. Fix: add a "New collection" button to the account dashboard.

---

### S9 — SEO presence / comparison pages
**Priority: Medium**  
**Area:** Marketing / `src/app/`

Hushare appears in zero "best wedding photo sharing app 2026" articles despite beating competitors on several dimensions. A single honest "Hushare vs GuestCam" page showing side-by-side pricing over 10 events (GuestCam: $970+, Hushare: $120/year) is the strongest sales argument available and currently lives nowhere. Add comparison landing pages for the top 3 competitors.

---

### S10 — Face Finder rate limiting
**Priority: Medium (cost risk)**  
**Area:** `src/app/api/album/face-search/route.ts`

Any guest can hammer the search endpoint in a loop. Each call triggers a billed AWS Rekognition `SearchFacesByImage`. Low probability event but when it hits it will be sudden and expensive. Defer until closer to scale, but don't forget it. Tracked separately as issue #9.

---

### S11 — E2E test suite
**Priority: Medium (engineering health)**  
**Area:** Testing / CI

Every bug in this file was found manually in production. The arrangement bug, the missing DB columns, the drag-and-drop failures — all caught by hand. Playwright covering the 3 golden paths (create album → upload photo → guest views) would catch regressions before they ship. Low urgency now, becomes critical once there are paying users who notice every regression.

---

### S12 — RSVP / event management (v2 consideration)
**Priority: Low**  
**Area:** New feature

Fotify and Wedibox include RSVP, seating charts, and DJ requests as part of their event platform pitch. This pulls Hushare into a different product category (event management vs photo sharing) and is a significant scope expansion. Only worth considering once the core photo + video experience is flawless and market position is established. Do not build prematurely.

---

## Audit Issues (2026-05-28)

Issues #10–#24 are from a full codebase audit. Ordered by severity.

---

## #10 — `timingSafeEqual` is not actually timing-safe
**Status:** OPEN  
**Priority: CRITICAL — Security**  
**Area:** `src/lib/timing-safe.ts`, `src/lib/album-owner-access.ts`

**Problem:** The custom `timingSafeEqual` function has an early-exit on length mismatch:
```ts
if (a.length !== b.length) return false  // leaks token length via timing
```
An attacker can binary-search the correct owner token length by measuring response time differences. The constant-time XOR loop that follows is also vulnerable to V8 optimizer short-circuiting. This function is used to verify the owner token — the most sensitive secret in the system. It is not timing-safe in any meaningful way.

**Fix:** Replace with Node's native `crypto.timingSafeEqual`. Since it requires equal-length buffers, hash both inputs with SHA-256 first and compare the hashes:
```ts
import { createHash, timingSafeEqual } from 'node:crypto'
function hashToken(s: string) { return createHash('sha256').update(s).digest() }
export function timingSafeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(hashToken(a), hashToken(b))
}
```
**Files:** `src/lib/timing-safe.ts`

---

## #11 — Rate limiting is fail-open and may be entirely disabled in production
**Status:** OPEN  
**Priority: High — Security**  
**Area:** `src/lib/rate-limit.ts`, all routes that call `checkRateLimit`

**Problem:** Every `checkRateLimit` call returns `{ ok: true }` (allow) if the `rate_limit_events` DB table doesn't exist. The table requires a manual migration (`20260522_rate_limit_events.sql`) to be applied. If that migration was never applied to the production Supabase project, then every rate limit in the codebase — album creation, photo upload — is permanently disabled with no warning, no error, and no way to tell from logs. There is no startup check or health endpoint confirming rate limiting is active.

**Fix:** Add a startup check or a `/api/health` endpoint that confirms the table exists. Alternatively, fail-closed by default and only fail-open during a grace period. At minimum, log a loud warning at startup if the table is missing.  
**Files:** `src/lib/rate-limit.ts`

---

## #12 — Admin emails hardcoded in source code / git history
**Status:** OPEN  
**Priority: High — Security**  
**Area:** `src/lib/auth.ts:2-5`

**Problem:** Both admin email addresses are committed in plaintext:
```ts
const ADMIN_EMAILS = new Set<string>([
  'alinagnuni3@gmail.com',
  'yeganyansuren13@gmail.com',
])
```
These are now in git history permanently. Anyone who accesses the repository knows exactly which email addresses have admin privileges — the target for any social engineering or account-takeover attempt. The same emails are documented in `album-owner-access.ts` comments.

**Fix:** Move to an environment variable. `ADMIN_EMAILS=email1@...,email2@...` in Cloudflare secrets, parsed at runtime. Remove the hardcoded values from source. Consider running `git filter-repo` to scrub history if the repo is or becomes public.  
**Files:** `src/lib/auth.ts`, `src/lib/album-owner-access.ts`

---

## #13 — Face search endpoint has no rate limiting
**Status:** OPEN  
**Priority: High — Cost risk**  
**Area:** `src/app/api/album/face-search/route.ts`

**Problem:** (Already tracked as #9 and S10 — adding here for completeness in the audit sequence.) Any guest can POST to `/api/album/face-search` in a tight loop with no throttle. Each call is a billed AWS Rekognition `SearchFacesByImage` operation. A single motivated person can run up significant AWS costs with no friction and no detection. There is no per-IP limit, no per-album limit, and no alarm.

**Fix:** Add `checkRateLimit(clientIpKey(req, 'face_search'), 60, 5)` — 5 searches per minute per IP is generous for real users and stops scripted abuse. Also add a per-album daily cap as a secondary guard.  
**Files:** `src/app/api/album/face-search/route.ts`

---

## #14 — Homepage is a full client component — LCP is broken
**Status:** OPEN  
**Priority: High — Performance / SEO**  
**Area:** `src/app/page.tsx`

**Problem:** `src/app/page.tsx` has `'use client'` at the top. The entire homepage — hero, FAQ, CTA — is rendered client-side. The user gets a blank screen until React hydrates. There is no static HTML, no server-rendered content, and no LCP content above the fold until JavaScript executes. This tanks Core Web Vitals (especially LCP) and means Google indexes an empty page body during crawl.

**Fix:** Convert `page.tsx` to a Server Component. Extract only the interactive parts (album creation form with `useState`, tilt card animation) into a small `'use client'` child component. The hero text, FAQ, and CTA are all static and should be pure HTML from the server. This is one of the highest-return refactors available — no feature change, massive SEO and performance gain.  
**Files:** `src/app/page.tsx`

---

## #15 — Three sequential API calls on album page load
**Status:** OPEN  
**Priority: Medium — Performance**  
**Area:** `src/app/[slug]/AlbumPageClient.tsx` — `fetchAlbum`

**Problem:** When a user opens an album with an owner token, three fetches happen strictly in series:
1. `GET /api/album/resolve` — album data
2. `POST /api/album/auth` — owner verification (only starts after #1 finishes)
3. `GET /api/me/tier` — subscription tier (only starts after #2 finishes)

On a 100ms RTT connection this adds ~300ms of forced serial latency before the page is interactive. Fetches #2 and #3 could run in parallel with `Promise.all` once the album data arrives, or all three could be consolidated into a single endpoint.

**Fix (quick):** After the resolve call returns, run auth and tier checks in parallel:
```ts
const [authResult, tierResult] = await Promise.all([
  fetch('/api/album/auth', ...),
  fetch('/api/me/tier', ...),
])
```
**Fix (proper):** Create `/api/album/resolve` to return `is_owner` and `tier` in one response when an `owner_token` is supplied, eliminating two round-trips entirely.  
**Files:** `src/app/[slug]/AlbumPageClient.tsx`

---

## #16 — Supabase Realtime DELETE subscription has no server-side filter
**Status:** OPEN  
**Priority: Medium — Scale**  
**Area:** `src/app/[slug]/AlbumPageClient.tsx:183-191`

**Problem:** The DELETE subscription listens to all deletes on the `photos` table across every album:
```ts
{ event: 'DELETE', schema: 'public', table: 'photos' }
// No filter — comment explains Postgres only writes PK to WAL by default
```
Every browser session on every album receives every photo deletion event platform-wide and filters it client-side. At low user counts this is fine. At 1,000 concurrent album sessions, every delete anywhere causes 1,000 unnecessary WebSocket messages.

**Fix:** Enable `REPLICA IDENTITY FULL` on the `photos` table in a migration. This makes the full row available in the WAL on delete, allowing a server-side filter `filter: \`album_id=eq.${albumId}\`` on the DELETE subscription. One migration, eliminates the problem entirely.  
**Files:** `src/app/[slug]/AlbumPageClient.tsx`, Supabase migration needed

---

## #17 — UploadZone.tsx and OwnerToolbar.tsx are 1,400+ line monoliths
**Status:** OPEN  
**Priority: Medium — Code quality / maintainability**  
**Area:** `src/components/UploadZone.tsx` (1,387 lines), `src/components/OwnerToolbar.tsx` (1,452 lines)

**Problem:** Each file does 6–8 unrelated things. `UploadZone.tsx` contains: HEIC worker management, thumbnail generation, Supabase XHR upload, R2 single upload, R2 multipart chunking, Cloudflare Stream TUS, poster job queue, mirror job queue, and the React component itself. When any upload bug surfaces, you're reading 1,400 lines to find it. Changes to one upload path risk silently breaking another.

**Fix:** Split each into focused modules. For `UploadZone`:
- `src/lib/upload/heic.ts` — HEIC worker + conversion
- `src/lib/upload/supabase.ts` — Supabase XHR upload
- `src/lib/upload/r2.ts` — R2 single + multipart
- `src/lib/upload/stream.ts` — Cloudflare Stream TUS
- `src/lib/upload/posterQueue.ts` — poster + mirror background jobs
- `src/components/UploadZone.tsx` — React component only, imports from above

No behavior changes, just extraction. Each module becomes independently testable.  
**Files:** `src/components/UploadZone.tsx`, `src/components/OwnerToolbar.tsx`

---

## #18 — `FILE_ACCEPT` missing HEIC/HEIF MIME types
**Status:** OPEN  
**Priority: Medium — Compatibility / Bug**  
**Area:** `src/components/UploadZone.tsx:610`

**Problem:** The file input's `accept` attribute is:
```ts
const FILE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/avif,video/*'
```
`image/heic` and `image/heif` are absent. On iOS Safari and some Android browsers, the file picker strictly filters by the `accept` attribute. iPhone users on these browsers will not see their HEIC photos in the picker — the most common photo format on iPhone. The HEIC conversion code is excellent but unreachable if the file picker hides the files.

**Fix:** Add `image/heic,image/heif` to `FILE_ACCEPT`.  
**Files:** `src/components/UploadZone.tsx`

---

## #19 — `heic2any` is a pre-release package / `uuid` version looks wrong
**Status:** OPEN  
**Priority: Medium — Dependency risk**  
**Area:** `package.json`

**Problem (19a):** `heic2any: "^0.0.4"` is a pre-release version. The package has never shipped a stable `1.x`. It holds a core feature (iPhone photo support) on an unmaintained pre-release with no SLA for fixes.

**Problem (19b):** `uuid: "^14.0.0"` — the public `uuid` package is at v9/v10. Version 14 does not exist on the public npm registry. This is either a scoped private package, a fork, or a version mismatch that resolves to something unexpected. Needs verification to confirm what's actually being installed.

**Fix (19a):** Evaluate `heic-convert` (Node, maintained) or handle HEIC natively via `createImageBitmap` on browsers that support it (Chrome 130+). If staying with heic2any, pin to exact version and monitor for security advisories.  
**Fix (19b):** Verify `uuid@14` resolves correctly. If it's wrong, replace with `crypto.randomUUID()` which is available natively in all target environments (Workers, Node 19+, modern browsers).  
**Files:** `package.json`

---

## #20 — External Pinterest image URLs hardcoded in homepage
**Status:** OPEN  
**Priority: Medium — Reliability**  
**Area:** `src/app/page.tsx:344,363`

**Problem:** Two "how it works" step images load from `i.pinimg.com` (Pinterest CDN):
```ts
image: 'https://i.pinimg.com/736x/86/28/a9/8628a90f3228558f5961af600d479b28.jpg',
image: 'https://i.pinimg.com/736x/23/97/bc/2397bc85b02c33168976049f3192fe46.jpg',
```
Pinterest rotates and expires CDN URLs. When these links die — and they will — the homepage silently shows broken images with no fallback. There is no error boundary around these cards and `Next/Image` will just render a broken `<img>`.

**Fix:** Download both images, add them to `public/`, and serve locally. Two AVIF/WebP images in public is better than an external dependency that breaks silently.  
**Files:** `src/app/page.tsx`

---

## #21 — QR codes served from an external third-party API
**Status:** OPEN  
**Priority: Low-Medium — Reliability**  
**Area:** `src/app/[slug]/AlbumPageClient.tsx:378`, `src/components/owner-toolbar/ShareMenu.tsx`

**Problem:** QR codes are generated by `https://api.qrserver.com/v1/create-qr-code/` — a free third-party service with no SLA. If this service goes down, rate-limits the app, changes its URL scheme, or disappears, every QR code in the app breaks simultaneously. This is a single point of failure for a feature hosts depend on at live events.

**Fix:** Replace with a client-side QR library such as `qrcode` (maintained, zero dependencies, 15 KB). Generate QR codes entirely in the browser — faster, no external network request, no failure mode.  
**Files:** `src/app/[slug]/AlbumPageClient.tsx`, `src/components/owner-toolbar/ShareMenu.tsx`

---

## #22 — Dead callback prop and dead variables in upload path
**Status:** OPEN  
**Priority: Low — Code quality**  
**Area:** `src/app/[slug]/AlbumPageClient.tsx:235`, `src/components/UploadZone.tsx:990-992`

**Problem (22a):** `handlePhotoAdded = () => {}` on line 235 of `AlbumPageClient.tsx` is a no-op function passed as `onPhotoAdded` to `UploadZone`. The comment explains realtime handles it, but the prop still exists on `UploadZone`'s interface and is called after every batch save. Any reader has to trace the call to discover it does nothing.

**Problem (22b):** In the R2 video fallback path (lines 990–992):
```ts
const posterPath: string | null = null
const posterUrl: string | null = null
const durationSeconds: number | null = null
```
Three variables declared, assigned null, and immediately used as null in the return. They exist only to make the shape explicit, but they add confusion — they look like they should be filled in.

**Fix (22a):** Remove `onPhotoAdded` from `UploadZone`'s props entirely. Remove the call site and the no-op function.  
**Fix (22b):** Use null literals directly in the return object. Delete the three variable declarations.  
**Files:** `src/app/[slug]/AlbumPageClient.tsx`, `src/components/UploadZone.tsx`

---

## #23 — `'unsafe-inline'` in CSP weakens XSS protection
**Status:** OPEN  
**Priority: Low — Security hardening**  
**Area:** `next.config.ts:3`

**Problem:** The CSP includes `'unsafe-inline'` in `script-src` to accommodate Google Tag Manager. This means any XSS injection that reaches the page can execute inline scripts — the CSP provides no XSS mitigation for inline attacks. The rest of the CSP (frame-ancestors, object-src, base-uri) is solid, but `unsafe-inline` on scripts is the most significant weakening possible.

**Fix:** Migrate GTM to use a nonce-based CSP. Next.js 15 supports nonce injection via middleware. With nonces, GTM works and `unsafe-inline` can be removed. This is non-trivial (requires Next.js middleware + GTM nonce config) but meaningful for a platform handling user media.  
**Files:** `next.config.ts`, `src/middleware.ts`

---

## #24 — Repo housekeeping: broken build artifact and stray files committed
**Status:** OPEN  
**Priority: Low — Housekeeping**  
**Area:** Repo root

**Problem:**
- `.next-broken-20260505-002059/` — a broken build directory is committed to the repo. It's large, serves no purpose, and pollutes `git status` and IDE file trees.
- `shared-album.jpg` at repo root — a stray image file, not in `public/`, not referenced anywhere.
- `public/collabs/Tricolor Beat Logo (editedable) (2).pdf` — a source PDF in the public directory, publicly accessible.

**Fix:** Add `.next-*/` to `.gitignore` to prevent future build artifacts from being committed. Delete the existing committed artifacts (`git rm -r .next-broken-20260505-002059`). Remove `shared-album.jpg` from root. Evaluate whether the PDF in `public/collabs/` should be public.  
**Files:** `.gitignore`, repo root cleanup

---

## #25 — Video R2 fallback: Worker is in the data path + 5 MiB chunk size kills mobile
**Status:** OPEN — blocked on Stream stabilisation first  
**Priority: High — Performance / Reliability**  
**Area:** `src/app/api/upload/r2/route.ts`, `src/app/api/upload/r2/multipart/route.ts`, `src/components/UploadZone.tsx`

### Context and scope

This issue is specifically about the **R2 fallback path** (when Cloudflare Stream fails). The primary video path is Stream with 1 MB TUS chunks — that path is already architecturally sound and is being tested in the current deploy. This issue is about making the fallback path not terrible.

Images upload directly to Supabase (`https://zleajzevvhugkwlqlolt.supabase.co/storage/v1/object/...`) — the Worker is not in the image data path. Image failures have a separate cause tracked in #26.

### The two problems with the R2 fallback

**Problem 1 — Worker is in the data path.**  
The multipart chunk route at `/api/upload/r2/multipart` calls `req.arrayBuffer()`, fully buffering each 5 MB chunk in Worker RAM before forwarding to R2. Every video byte is proxied:

```
Browser ──5 MB chunk──► Worker (buffers in RAM) ──5 MB chunk──► R2
```

The Worker adds latency (buffer-then-forward instead of streaming), memory pressure (10 MB RAM per user with 2 concurrent chunk workers), and an extra round-trip hop through Cloudflare's internal network.

**Problem 2 — 5 MiB minimum chunk size is an R2 constraint, not a Worker constraint.**  
R2 enforces a 5 MiB minimum per multipart part. Presigned URLs do not change this — it is a hard R2 requirement. At 0.67 Mbps (weak mobile), 5 MB = ~60 seconds per chunk. Most carriers kill TCP connections idle for >60 s. This is the real reason chunks fail on mobile, regardless of whether the Worker is in the path.

### The comparison

| Path | Data path | Min chunk | 60s carrier risk |
|---|---|---|---|
| Current R2 fallback | Browser → Worker → R2 | 5 MB | High — 5 MB at 0.67 Mbps = 60 s, right at carrier kill threshold |
| R2 presigned URLs | Browser → R2 directly | 5 MB (R2 constraint) | Same — chunk duration is identical; benefit is Worker RAM, not timing |
| Stream (primary, deployed) | Browser → Stream directly | 1 MB | None — 1 MB at 0.67 Mbps = 12 s |

Stream with 1 MB TUS chunks is architecturally superior for mobile. The correct priority is: **stabilise Stream first, then improve the R2 fallback.**

### The fix (implement after Stream is stable)

Use R2 presigned URLs via the S3-compatible API so the Worker is no longer in the video data path.

**New lib: `src/lib/r2-presign.ts`**  
Generates presigned S3 PUT and UploadPart URLs against `https://{account-id}.r2.cloudflarestorage.com/{bucket}`. Reuses the AWS Signature V4 signing approach from `src/lib/rekognition.ts` — change service name from `rekognition` to `s3`, change the host. Requires R2 API token credentials as env vars (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`) — separate from the Worker R2 binding.

**New flow for small videos (under Worker body limit):**
1. Browser calls `POST /api/upload/sign/video` with `{ albumId, filename, contentType, totalSize }`.
2. Worker validates tier cap, generates a presigned `PUT` URL for the full file, returns it.
3. Browser `PUT` directly to R2 — Worker not involved in data transfer.
4. Browser calls `POST /api/album/photos/create` to confirm.

**New flow for large videos (multipart):**
1. Browser calls `POST /api/upload/sign/video` — Worker calls R2 `CreateMultipartUpload`, returns `{ uploadId, key }`.
2. Browser requests batches of presigned `UploadPart` URLs as needed.
3. Browser `PUT` each part directly to its presigned URL — Worker sees no video bytes.
4. Browser sends `parts[]` to Worker → Worker calls `CompleteMultipartUpload`.

Note: minimum part size is still 5 MiB (R2 constraint). The Worker→R2 internal binding takes ~100ms — it does not add meaningful idle time to the browser's connection. The 60s carrier kill problem is caused by 5 MB taking 60s to upload at 0.67 Mbps, full stop. Presigned R2 does not change the chunk duration and does not fix the carrier problem. The real benefits are: no Worker RAM buffering (10 MB per concurrent user disappears), and a cleaner data path for reliability under load. Smaller chunks on mobile require Stream.

### Implementation order
1. Confirm Stream is stable on mobile (test with weak 3G conditions).
2. Add `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` to Cloudflare secrets.
3. Write `src/lib/r2-presign.ts` — V4 signing for R2 S3 API.
4. Add `POST /api/upload/sign/video` and `POST /api/upload/sign/video/complete` routes.
5. Update `uploadToR2` and `uploadVideoMultipart` in `UploadZone.tsx` to use presigned URLs.
6. Keep old proxied routes until confirmed working, then remove them.

---

## #26 — Image upload failures: root cause not yet identified
**Status:** OPEN — needs investigation  
**Priority: High — Reliability**  
**Area:** `src/components/UploadZone.tsx` — `uploadToSupabaseStorage`

### What we know

Images upload directly from the browser to Supabase Storage via XHR — the Cloudflare Worker is **not** in the image data path. The URL is `https://zleajzevvhugkwlqlolt.supabase.co/storage/v1/object/Photos/{path}` sent directly from the browser. Previous failures (issue #3) were traced to missing `apikey` header and no XHR timeout — those are fixed. Despite this, image upload failures still occur in some conditions.

### Possible causes to investigate

- **Supabase Storage RLS / bucket policy.** The anon key is used for guest uploads. If RLS on the `Photos` bucket has a policy that rejects inserts in certain conditions (e.g. path already exists and `x-upsert: false`), uploads silently fail. The current code treats 409 as success — but other policy rejections (403, 401) may not be retried correctly.
- **Supabase Storage rate limits.** Supabase imposes per-project upload rate limits on the free/pro tier. Burst uploads of 50+ images from multiple users simultaneously may hit these. Unlike the old SDK path, XHR errors from rate limiting might not be retried if the status isn't in `isRetriableResponseStatus`.
- **CORS on Supabase Storage.** If the allowed origins list on the Supabase Storage bucket doesn't include `hushare.space` and `www.hushare.space`, browsers will block the XHR with a CORS preflight failure (manifests as "Failed to fetch", not a 4xx).
- **Thumbnail upload race.** After the main image uploads, a thumbnail is uploaded to `{albumId}/thumbs/{baseId}.ext` — same bucket, concurrent XHR. If both the original and thumbnail hit Supabase simultaneously and one stalls, the retry logic for each is independent and the "already exists" 409 handling might interact badly.
- **File size vs Supabase plan limits.** Supabase Storage has a per-file size limit that depends on the project plan. If the free plan cap is lower than the 25 MB image cap advertised to users, large JPEGs will hit a 413 from Supabase, not from the Worker.

### How to diagnose

1. Open the browser Network tab during a failing batch upload.
2. Find the failing XHR to `supabase.co/storage/v1/object/Photos/...`.
3. Check the exact HTTP status and response body — this pinpoints which of the causes above is responsible.
4. Cross-check Supabase project dashboard for storage error logs.

Once the specific failure mode is identified, update this issue with the root cause and fix.

# GITHUB REPO'S

CYBERSECURITY -mukul975/Anthropic-Cybersecurity-Skills




