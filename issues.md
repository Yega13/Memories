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

## #3 — Videos failing — 97/100 with XHR network errors (chunk 1)
**Status:** OPEN  
**Area:** Upload — Cloudflare Stream / R2 multipart

**Problem:** Nearly all video uploads fail. Both short and long videos error on chunk 1. Stream TUS path fails and falls back to R2 multipart, which also drops. Likely a Cloudflare WAF / Worker body-size / connection-timeout issue at the edge.

---

## #4 — Video poster/thumbnail never appears after upload
**Status:** OPEN  
**Area:** Upload — poster queue / `uploadToR2` (no retry)

**Problem:** After a video uploads via R2 (fallback path), `uploadToR2` for the poster JPEG has zero retry logic — one network blip = permanent failure. Stream-backed videos use `stream_thumbnail_url` which is returned by Cloudflare but may not be valid until the video finishes processing. Net result: video tiles always show the generic "Play" placeholder.

---

## #5 — Upload stops / freezes when tab is backgrounded
**Status:** OPEN  
**Area:** Upload — UploadZone.tsx / Web Locks

**Problem:** The Web Locks API (`navigator.locks.request`) doesn't fully prevent throttling on iOS Safari when the tab is hidden. Long uploads (100+ photos, any video) pause until the user returns to the tab. No Service Worker is in place as a proper fix.

---

## #6 — Upload speed too slow (100 photos > 5 min, target ~2 min)
**Status:** OPEN  
**Area:** Upload — UploadZone.tsx

**Problem:** Concurrency is capped at 3 (mobile) or 5 (desktop). Each image upload is sequential within its worker slot. Thumbnail generation adds latency inline. HEIC conversion is per-file and expensive. Combined with Supabase storage being single-region, 100 photos routinely takes 5+ minutes.

---

## #7 — Album share link has no OG thumbnail
**Status:** OPEN  
**Area:** SEO / `[slug]/page.tsx` — Open Graph meta

**Problem:** When a Hushare album link is pasted into iMessage, WhatsApp, Slack, etc., there is no preview image. Needs `og:image` set to either the album's cover photo or the first photo in the album. Also needs a custom OG image when the album has a cover set.

---

## #8 — No way to create a second collection from the website
**Status:** OPEN  
**Area:** Account page / OwnerToolbar

**Problem:** The only path to create a collection is through an album's owner toolbar → Settings → "Add to collection". Once one collection exists there is no standalone "Create collection" button anywhere on the site or account dashboard. Users with multiple albums who already have one collection are stuck.

---

## #9 — uploadToR2 (poster uploads, small videos) has no retry logic
**Status:** OPEN  
**Area:** UploadZone.tsx — `uploadToR2()`

**Problem:** `uploadToR2` wraps a single XHR with no retry loop. Any transient network error (mobile carrier proxy drop, brief Cloudflare hiccup) causes a permanent failure for that upload. This is specifically why video posters fail — they are small uploads through this path, and without retry there is no recovery.

---

## #10 — WAF / Cloudflare edge still dropping multipart chunk connections
**Status:** OPEN  
**Area:** Infrastructure / Cloudflare

**Problem:** Even with the WAF skip rule in place, `chunk 1` multipart errors occur on both short and long videos. This suggests either the skip rule isn't targeting the right route, a Worker CPU time limit is being hit on large chunks, or the edge is rewriting `Content-Type: multipart/form-data` in a way the Worker doesn't expect.

---

## #11 — No E2E test suite — bugs only found manually
**Status:** OPEN  
**Area:** Testing / CI

**Problem:** There is no automated end-to-end test suite (Playwright, Cypress, etc.). Upload failures, arrangement bugs, and missing DB columns were all found by hand. Any new deployment can silently regress any of the above.

---

## #12 — Face Finder has no rate limiting on the search endpoint
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

Any guest can hammer the search endpoint in a loop. Each call triggers a billed AWS Rekognition `SearchFacesByImage`. Low probability event but when it hits it will be sudden and expensive. Defer until closer to scale, but don't forget it. Tracked separately as issue #12.

---

### S11 — E2E test suite
**Priority: Medium (engineering health)**  
**Area:** Testing / CI

Every bug in this file was found manually in production. The arrangement bug, the missing DB columns, the drag-and-drop failures — all caught by hand. Playwright covering the 3 golden paths (create album → upload photo → guest views) would catch regressions before they ship. Low urgency now, becomes critical once there are paying users who notice every regression.

---

### S12 — Upload retry logic for R2 / poster uploads
**Priority: Low (partially overlaps issue #9)**  
**Area:** `src/components/UploadZone.tsx` — `uploadToR2()`

`uploadToR2` wraps a single XHR with no retry. One network blip = permanent failure for poster JPEGs and small video uploads. Add exponential backoff with 3 retries. Directly linked to issue #9 (poster thumbnail never appearing) and issue #4.

---

### S13 — RSVP / event management (v2 consideration)
**Priority: Low**  
**Area:** New feature

Fotify and Wedibox include RSVP, seating charts, and DJ requests as part of their event platform pitch. This pulls Hushare into a different product category (event management vs photo sharing) and is a significant scope expansion. Only worth considering once the core photo + video experience is flawless and market position is established. Do not build prematurely.
