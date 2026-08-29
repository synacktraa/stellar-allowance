/**
 * What an allowance's three numbers mean, in one place.
 *
 * The contract takes a per-call cap, a window cap and a window length. The interface offers
 * fewer than that on purpose.
 *
 * **The per-call cap is gone as a separate idea.** It was the rule most likely to break a
 * working setup for a reason the owner did not control: a developer raising a price above the
 * cap turns every call into a refusal, discovered later in an agent's log. It is set equal to
 * the window cap, so a single call can spend at most what the window allows anyway.
 *
 * **The window cap is optional.** It is the last of the four protections this product offers,
 * not the first — the agent holding no money at all is the first, and the allowlist deciding
 * who may be paid is the third. When no rate limit is set, the balance in the contract is the
 * limit, which is a true sentence and a simpler one.
 */

/** A cap nothing will reach: 1e18 stroops is a hundred billion USDC. */
export const NO_RATE_LIMIT = 10n ** 18n;

/** Testnet closes a ledger roughly every five seconds. */
export const LEDGERS_PER_MINUTE = 12;

/** A day, for the window length when there is no rate limit to measure. */
export const DEFAULT_WINDOW_LEDGERS = 17_280;

export function isUnlimited(windowCap: string | bigint | null | undefined): boolean {
  if (windowCap === null || windowCap === undefined) return true;
  try {
    return BigInt(windowCap) >= NO_RATE_LIMIT;
  } catch {
    return true;
  }
}
