/**
 * What the gateway can carry.
 *
 * Shared, because two places need the same number for different reasons: the gateway enforces
 * it, and `/api/allowances/params` publishes it so the client SDK can refuse an oversized body
 * before anyone pays for one. A hardcoded copy in the SDK would go stale in every version that
 * was ever published.
 */

/**
 * Vercel's cap on a serverless request body.
 *
 * Not a protection — anything larger is rejected by the platform before it reaches this code, so
 * what this buys is a legible error instead of whatever the platform returns. Applies to paid
 * and unpaid requests alike: a body too large to forward is too large whether or not somebody
 * paid for it.
 *
 * One number for every API, which is the wrong shape long-term. An API taking a QR code's worth
 * of text and one taking an image want different answers, and the developer registering it is
 * the one who knows which. A per-API limit is the eventual fix; this is the floor under it.
 */
export const MAX_BODY_BYTES = 4_608_000; // 4.5 MB
