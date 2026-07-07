// Platform invariants. Never environment-dependent; live in code so each
// wrangler env's vars block stays minimal. Sourced from spec §NFRs and RFC §7.

export const R2_REGION = "auto"; // R2 is always "auto"

// Upload protocol limits — spec §NFRs.
export const SINGLE_PART_LIMIT_BYTES = 100 * 1024 * 1024; // 100 MB
export const MULTIPART_PART_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per part
export const MULTIPART_MAX_OBJECT_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
export const MULTIPART_MAX_PARTS = 10_000;

// Pending timer. Spec: default 24h; v1 uses a single global value for all
// pending blobs. `pendingTimerSeconds` on registerUpload is accepted but
// ignored (see spec §Deferrals — per-blob configurable timers/grace).
export const DEFAULT_PENDING_TIMER_SECONDS = 24 * 60 * 60;

// Signed read URL lifetime bounds — spec §NFRs.
export const DEFAULT_READ_URL_LIFETIME_SECONDS = 3600;
export const MIN_READ_URL_LIFETIME_SECONDS = 60;
export const MAX_READ_URL_LIFETIME_SECONDS = 24 * 60 * 60;
export const READ_URL_CACHE_SAFETY_MARGIN_SECONDS = 30;

// Admin pagination.
export const ADMIN_LIST_DEFAULT_LIMIT = 50;
export const ADMIN_LIST_MAX_LIMIT = 200;

// Scheduled tasks.
export const PENDING_REAP_BATCH_SIZE = 50;
