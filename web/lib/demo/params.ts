// Amounts are in the asset's base unit. USDC on Stellar has seven decimals, so 100000 is 0.01.
export const DECIMALS = 7;

// 0.05 USDC in, of which the window lets 0.025 out per day. The seller charges 0.01, so two
// payments fit inside the cap and a third does not.
export const DEPOSIT = 500_000n;
export const WINDOW_CAP = 250_000n;
export const WINDOW_LEDGERS = 17_280;

// Stellar closes a ledger about every five seconds, so an hour is 720 of them.
export const LEDGERS_PER_HOUR = 720;

// Testnet, and the USDC issued on it. The interface pays one asset on one network, and says so
// rather than quietly refusing a URL priced in something else.
export const NETWORK_ID = 'stellar:testnet';
export const USDC_SAC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
export const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// The most allowances one owner can have. Asking for all 60 derived addresses is one request,
// so the ceiling is a product decision rather than a technical one.
export const MAX_ALLOWANCES = 60;

export const usdc = (base: bigint | string | number): string =>
  (Number(base) / 10 ** DECIMALS).toFixed(3);
