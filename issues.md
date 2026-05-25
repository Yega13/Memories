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

**Problem (1c — drag broken on desktop + mobile scroll conflict):** Timer-based drag had two fatal flaws: (1) on desktop, any mouse movement off the tile before the 1000ms timer fired triggered `onPointerLeave` → `clearReorderTimer()` → drag cancelled silently. (2) on mobile, a 150ms timer still allowed the browser to claim the touch as a scroll gesture before `setPointerCapture` could take over.

**Fix (1c):** Added a dedicated `GripVertical` drag handle overlay on each tile in arrange mode. The handle has `touchAction: 'none'` and calls `startDragFromHandle` on `pointerDown`, which *immediately* sets `reorderDraggingId` and calls `setPointerCapture` on the parent tile — no timer, no scroll conflict, no mouse-leave cancellation. `startReorderPress` on the tile body now returns early in arrange mode (handle owns drag). `handleReorderMove` now checks the ref (`reorderDragIdRef`) instead of the state so it works before the first React re-render commits.  
**File:** `src/components/PhotoGrid.tsx` — `startDragFromHandle`, `startReorderPress`, `handleReorderMove`, tile `useMemo`

---

## #2 — thumb_path / thumb_url columns missing from DB
**Status:** OPEN  
**Area:** Database / migrations

**Problem:** No migration adds `thumb_path` / `thumb_url` to the `photos` table. The `photos/create` route has a fallback that silently strips them on insert. Every image loads full-resolution in the grid instead of a small preview thumbnail, making the grid slow. Thumbnail data generated client-side is wasted work.

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

## Future / Version 2 items

- Competitor analysis & feature gap list
- Full billing model + profit/loss calculation  
- Mobile UI/UX polish pass  
- UI polish (desktop + mobile)  
