// The contract spreads a rolling window over a ring of slices and ages it forward on every
// payment. Reading the total is a pure function of what the ring holds and where the chain is,
// so a dashboard can work it out from one ledger entry instead of a call per allowance.
//
// This mirrors `rolled_window` in contracts/allowance/src/lib.rs. The two move together.

export const SLICES = 24;
export const SLOTS = SLICES + 1;

export interface Window {
  slots: bigint[];
  head: number;
}

// A window narrower than the slice count still gets a ledger per slice, which makes it wider
// than asked rather than a division by zero.
export const sliceOf = (ledger: number, windowLedgers: number) =>
  Math.floor(ledger / Math.max(Math.floor(windowLedgers / SLICES), 1));

export function spentInWindow(
  window: Window | undefined,
  windowLedgers: number,
  ledger: number,
): bigint {
  if (!window) return 0n;
  const slice = sliceOf(ledger, windowLedgers);
  const slots = [...window.slots];

  if (slice > window.head) {
    const stale = Math.min(slice - window.head, SLOTS);
    for (let n = 1; n <= stale; n += 1) slots[(window.head + n) % SLOTS] = 0n;
  }

  return slots.reduce((total, slot) => total + slot, 0n);
}
