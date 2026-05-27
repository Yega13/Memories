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

// XHR timeout per multipart/stream chunk. Five minutes to accommodate slow mobile data
// uploading a 5 MB chunk before the retry kicks in.
export const R2_CHUNK_UPLOAD_TIMEOUT_MS = 300_000

// Maximum concurrent upload worker slots by device input class.
// Coarse-pointer (mobile) gets fewer to avoid saturating carrier connections.
export const UPLOAD_CONCURRENCY_MOBILE = 3
export const UPLOAD_CONCURRENCY_DESKTOP = 5

// Concurrent R2 multipart chunk workers per video. Independent from the file-level concurrency
// above — these run inside a single video's uploadVideoMultipart call.
// Both mobile and desktop use 2 parallel chunks. This doubles throughput vs sequential
// while keeping each Worker invocation isolated — 4 simultaneous chunk requests caused
// Worker cold-start contention on burst uploads, manifesting as "failed to fetch."
export const R2_MULTIPART_CONCURRENCY_MOBILE = 2
export const R2_MULTIPART_CONCURRENCY_DESKTOP = 2

// TUS chunk size for Cloudflare Stream uploads (PATCH requests sent directly to Stream).
// Stream supports up to 200 MB per chunk. 20 MB is safe at 1.5 Mbps (≈107 s < 300 s timeout)
// and cuts round trips 4× vs the previous 5 MB. TUS byte-level resumption means a mid-chunk
// drop only retransmits from the server's last confirmed offset, so larger chunks don't hurt
// resilience.
export const STREAM_CHUNK_SIZE_BYTES = 20 * 1024 * 1024
