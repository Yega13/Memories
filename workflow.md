# Hushare — Engineering Decisions & Solutions Log

This file records every significant architectural decision, bug fix strategy, and solved problem.
Before trying a new approach, check here first.

---

## IMAGE UPLOAD: Supabase Storage → R2 Migration (planned 2026-06-08)

**Problem:** Supabase free-tier cached egress quota (5 GB) is blown through in hours of testing
because every photo view counts against egress. At 1000 customers this costs $200+/month.

**Solution:** Move image storage from Supabase Storage to R2. R2 egress via Cloudflare's network
is free at any scale. Supabase stays for auth + database only (free tier sufficient for that).

**Files to change (3 total):**
1. `src/app/api/upload/r2/route.ts` — add `kind='image'` support + image MIME set + `caps.image` sizing
2. `src/app/api/album/photos/create/route.ts` — remove hardcoded `image → supabase-only` check (line 204)
3. `src/components/UploadZone.tsx` — replace `uploadToSupabaseStorage` with `uploadToR2` in image path

**No changes needed:** delete routes, bulk-delete, album-delete, download proxy, next.config, PhotoGrid
— these all already handle `storage_backend: 'r2'` correctly.

**Backward compat:** existing Supabase-stored photos keep working (DB has `storage_backend: 'supabase'`).
No data migration. Old and new photos coexist.

**Thumbnail strategy:** No Supabase image transform for R2 images. Use same URL for both `url` and
`thumb_url`. Client already compresses to 1600px/q=0.8 so files are ~200–400 KB — fine for grid.

---

## MOBILE UPLOAD SPEED: createImageBitmap resize (2026-06-08)

**Problem:** `createImageBitmap(file)` decodes a 12MP photo at full 4032×3024 = ~140 MB bitmap,
taking 3–10 s on mobile. 100 photos at concurrency 3 = 5+ minutes preparation.

**Solution:** `createImageBitmap(file, { resizeWidth: maxDim, resizeQuality: 'high' })` — browser
uses hardware-accelerated downscaling during JPEG decode. Output bitmap is ~8 MB, takes ~150 ms.

**Side effect:** Removed `stripExifClientSide` fast path from `encodeFromSource` — it was broken by
pre-resize (bitmap always appears ≤maxDim even for 12MP originals, so it would upload the full
original file instead of the resized version).

**Concurrency changes:**
- `ADDFILES_CONCURRENCY` mobile: 3 → 6 (safe because bitmaps are 8 MB not 140 MB)
- `ADDFILES_CONCURRENCY` desktop: 4 → 8
- `UPLOAD_CONCURRENCY_MOBILE`: 3 → 5
- `UPLOAD_CONCURRENCY_DESKTOP`: 4 → 6
- `MOBILE_UPLOAD_STAGGER_MS`: 800 → 400

---

## MOBILE SUPABASE UPLOADS: XHR → fetch() (2026-06-08)

**Problem:** `xhr.send(blob)` on iOS silently fires `onerror` ("Failed to Fetch") for some images
after a long session. Likely cause: iOS can invalidate canvas.toBlob() Blobs under memory pressure,
OR iOS has a known bug where XHR silently cancels large binary request bodies.

**Solution:** Rewrote `uploadToSupabaseOnce`:
1. Read Blob to ArrayBuffer first (`file.arrayBuffer()`) — pins bytes in JS heap, not GPU memory
2. Switch from XHR to `fetch()` — uses NSURLSession which handles large binary bodies more reliably on iOS

---

## DELETE TOASTS: Silent success (2026-06-08)

**Problem:** Both individual delete and bulk delete showed success toast on every deletion.
User wanted silent on success, only show error toasts.

**Solution:**
- `PhotoGrid.tsx deletePhoto`: removed `showAppToast('Media deleted.')`
- `useSelectMode.ts bulkDeleteSelected`: removed `showAppToast('${deleted} deleted.')`

---

## DEADLOCK FIX: bgSem drain + mark-failed (prev session)

**Problem:** `bgSem.current.q = []` drained the bg upload queue but left queued files with
status `'uploading'` permanently. Upload workers had a `while (bg?.status === 'uploading') await wait(50)`
spin-loop — they spun forever. Progress froze at ~25% for 5+ minutes.

**Solution:** After draining the queue, mark ALL `'uploading'` items as `'failed'`:
```js
bgSem.current.q = []
bgUploads.current.forEach((val, file) => {
  if (val.status === 'uploading') bgUploads.current.set(file, { status: 'failed' })
})
```
Also removed the spin-wait loop — workers now just fall through to `uploadItem` immediately.

---

## BULK DELETE TIMEOUT: Parallelise Stream deletions (prev session)

**Problem:** Sequential `for...await deleteStreamVideo()` for 17 videos = 34+ seconds, exceeding
Cloudflare Worker timeout → "0 media deleted, 17 skipped".

**Solution:** `Promise.all(streamUids.map(uid => deleteStreamVideo(uid).catch(...)))`

---

## MOBILE VIDEO: Single-file first, then multipart fallback (prev session)

**Problem:** Multipart chunks failing on iOS with "Network error on chunk 1".

**Solution:** On mobile for files ≤95 MB: try single-file FormData POST to `/api/upload/r2` first
(3 attempts). Fall back to multipart only if that fails.

Also: rewrote `uploadChunkOnce` to use `fetch()` instead of XHR for Worker proxy path (same
NSURLSession reliability fix as Supabase uploads above).

---

## 150-FILE LIMIT (prev session)

Added cap in `addFiles`: slice `filesArr` to 150 and show error message if exceeded.

---

## SUPABASE EGRESS ROOT CAUSE (2026-06-08)

**What happened:** 24.7 GB cached egress (495%) on free tier (5 GB limit) from images served
via Supabase CDN during testing. Service paused.

**Real fix:** Migrate images to R2 (see above). After migration, Supabase free tier is sufficient
for auth + database indefinitely even at 1000 customers.

**Immediate fix if needed:** Upgrade to Supabase Pro ($25/mo) or wait for billing cycle reset.
Billing cycle resets 2026-06-09 (tomorrow at time of discovery).
