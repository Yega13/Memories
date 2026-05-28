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

**Fix (applied 2026-05-28):**
- `r2/multipart/route.ts`: fixed bug where `req.body ?? await req.arrayBuffer()` ran outside the try/catch, risking an unhandled exception that caused the Worker to return no HTTP response (browser sees `onerror`). Now reads body with `req.arrayBuffer()` safely inside a try/catch.
- `constants.ts`: reduced `STREAM_CHUNK_SIZE_BYTES` from 5 MiB to 1 MiB. Cloudflare Stream TUS has no enforced minimum; 1 MiB keeps each direct-to-Stream transfer under ~10 s even on a 100 KB/s connection.

**Remaining action required:**
Set `CLOUDFLARE_STREAM_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as Cloudflare secrets in the dashboard. Once Stream is live, the video bytes travel browser → Cloudflare Stream directly — no Worker in the data path, no timeout risk. The R2 multipart path then becomes a fallback only for edge cases (Stream API outage, very small files already below `MULTIPART_THRESHOLD`).

**Files changed:** `src/app/api/upload/r2/multipart/route.ts`, `src/lib/constants.ts`

---

## #5 — Upload stops / freezes when tab is backgrounded
**Status:** OPEN  
**Area:** Upload — UploadZone.tsx / Web Locks

**Problem:** The Web Locks API (`navigator.locks.request`) doesn't fully prevent throttling on iOS Safari when the tab is hidden. Long uploads (100+ photos, any video) pause until the user returns to the tab. No Service Worker is in place as a proper fix.

---

## #6 — Album share link has no OG thumbnail
**Status:** OPEN  
**Area:** SEO / `[slug]/page.tsx` — Open Graph meta

**Problem:** When a Hushare album link is pasted into iMessage, WhatsApp, Slack, etc., there is no preview image. Needs `og:image` set to either the album's cover photo or the first photo in the album. Also needs a custom OG image when the album has a cover set.

---

## #7 — No way to create a second collection from the website
**Status:** OPEN  
**Area:** Account page / OwnerToolbar

**Problem:** The only path to create a collection is through an album's owner toolbar → Settings → "Add to collection". Once one collection exists there is no standalone "Create collection" button anywhere on the site or account dashboard. Users with multiple albums who already have one collection are stuck.

---

## #8 — No E2E test suite — bugs only found manually
**Status:** OPEN  
**Area:** Testing / CI

**Problem:** There is no automated end-to-end test suite (Playwright, Cypress, etc.). Upload failures, arrangement bugs, and missing DB columns were all found by hand. Any new deployment can silently regress any of the above.

---

## #9 — Face Finder has no rate limiting on the search endpoint
**Status:** OPEN (deferred)  
**Area:** API — `/api/album/face-search`

**Problem:** Any guest can POST to `/api/album/face-search` in a tight loop with no throttle. Each request triggers an AWS Rekognition `SearchFacesByImage` call, which is billed per API call. A single motivated user could run up significant AWS costs on any indexed album with no friction.

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

### S5 — Guest reactions (emoji) on photos
**Priority: Medium**  
**Area:** New feature / `src/components/photo-grid/`

Guests upload a photo and it disappears into the grid with zero feedback. No like, no heart — nothing. This kills repeat engagement. Reactions are a small build (new `photo_reactions` table, Realtime subscription, single emoji picker on each tile) but meaningfully increase how long guests stay on the album and how often they return.

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
