// Amounts are in the asset's base unit. USDC on Stellar has seven decimals, so 100000 is 0.01.
export const DECIMALS = 7;

// 0.05 USDC in, of which the window lets 0.025 out per day. The seller charges 0.01, so two
// payments fit inside the cap and a third does not.
export const DEPOSIT = 500_000n;
export const WINDOW_CAP = 250_000n;
export const WINDOW_LEDGERS = 17_280;

export const usdc = (base: bigint | string | number): string =>
  (Number(base) / 10 ** DECIMALS).toFixed(3);
