// ─── Gesture: arrange drag / select mode ──────────────────────────────────────

// Desktop only: how long the user must hold before entering select mode.
export const HOLD_TO_SELECT_MS = 500

// Mobile long-press duration to enter bulk-select. Slightly longer than desktop
// to account for touch-event latency and iOS contextmenu timing.
export const HOLD_TO_SELECT_MOBILE_MS = 550

// After a drag-swap completes, clicks are suppressed for this duration to
// prevent the pointer-up from immediately selecting or opening a photo.
export const SUPPRESS_CLICK_AFTER_REORDER_MS = 300

// After a long-press triggers select mode, suppress slightly longer so the
// pointer-up that ends the press doesn't immediately deselect.
export const SUPPRESS_CLICK_AFTER_SELECT_MS = 800

// ─── Lightbox swipe navigation ────────────────────────────────────────────────

// Minimum horizontal drag distance (px) before a touch counts as a swipe.
export const SWIPE_THRESHOLD_PX = 42

// Minimum velocity (px/ms) to accept a swipe that falls below the distance
// threshold — allows quick flicks to navigate even on a short drag.
export const SWIPE_VELOCITY_MIN = 0.42

// Duration (ms) of the snap-back animation when a swipe gesture is rejected.
export const SWIPE_RESET_ANIMATE_MS = 180

// ─── Photo grid ───────────────────────────────────────────────────────────────

// IntersectionObserver rootMargin for preloading full-resolution images.
// Larger margin = more aggressive prefetch during fast scrolling.
export const GRID_PRELOAD_MARGIN_PX = 900

// ─── Arrange-mode auto-scroll ─────────────────────────────────────────────────

// Viewport edge zone (px) that triggers auto-scroll while dragging a photo.
export const AUTO_SCROLL_ZONE_PX = 120

// Scroll velocity range in px/frame (linear ramp across the zone).
export const AUTO_SCROLL_MIN_PX_FRAME = 7
export const AUTO_SCROLL_MAX_PX_FRAME = 30

// ─── Upload ───────────────────────────────────────────────────────────────────

// XHR timeout for a single (non-multipart) R2 upload request.
export const R2_SINGLE_UPLOAD_TIMEOUT_MS = 120_000

// XHR timeout per multipart/stream chunk. 10 minutes to accommodate slow mobile data
// (5 MB chunk at 100 Kbps ≈ 400 s; 600 s gives ample margin before retry kicks in).
export const R2_CHUNK_UPLOAD_TIMEOUT_MS = 600_000

// Maximum concurrent upload worker slots by device input class.
// Mobile gets 2 — cellular carriers drop burst connections when 3+ simultaneous
// XHRs hit the same host, causing fast "failed to fetch" failures on mobile.
// Desktop gets 3 — reduced from 5 to avoid saturating the 6-connection-per-host
// HTTP/1.1 limit to supabase.co, which caused every 6th upload to stall.
export const UPLOAD_CONCURRENCY_MOBILE = 2
export const UPLOAD_CONCURRENCY_DESKTOP = 4

// Concurrent R2 multipart chunk workers per video. Independent from the file-level concurrency
// above — these run inside a single video's uploadVideoMultipart call.
// 2 parallel workers doubles throughput without overwhelming carrier connections. 4 caused
// Worker cold-start contention on burst uploads, manifesting as "failed to fetch."
export const R2_MULTIPART_CONCURRENCY = 2

// R2 multipart enforces a 5 MiB minimum per part (except the last part).
// At 700 KB/s upload speed, 5 MiB takes ~7 seconds — well under the 60-second
// TCP idle timeout enforced by most carrier proxies and CGNAT devices.
export const R2_CHUNK_SIZE_BYTES = 5 * 1024 * 1024

// Cloudflare Stream TUS has no enforced minimum chunk size.
// 1 MiB per chunk keeps each transfer under ~10 seconds on a 100 KB/s connection,
// well below any carrier TCP timeout. The previous 5 MiB caused timeouts on weak mobile data.
export const STREAM_CHUNK_SIZE_BYTES = 1 * 1024 * 1024
