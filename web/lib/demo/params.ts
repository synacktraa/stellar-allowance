// Amounts are in the asset's base unit. USDC on Stellar has seven decimals, so 100000 is 0.01.
export const DECIMALS = 7;

// 5 USDC in, of which the window lets 0.025 out per day. The seller charges 0.01, so two
// payments fit inside the cap and a third does not. The balance is far larger than the cap on
// purpose: a refusal against a nearly empty allowance proves nothing, because a reader cannot
// tell the rule from the funds running out.
export const DEPOSIT = 50_000_000n;
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

/**
 * The contract code every allowance is deployed from, already installed on testnet.
 *
 * Checked by hash rather than fetched. The release asset carries no cross-origin headers, so a
 * browser cannot read it, and the hash is what a deployment needs anyway.
 */
export const WASM_HASH = '6077823e41bb7de03da15497b5996894609a3caa26fab363efdf0a0499eeb7c2';

/** The x402 API the demo pays. Public, and pointable at a local seller during development. */
export const SELLER_URL =
  process.env.NEXT_PUBLIC_SELLER_URL ?? 'https://xlm-quote-api.vercel.app/api/quote';

export const usdc = (base: bigint | string | number): string =>
  (Number(base) / 10 ** DECIMALS).toFixed(3);

/**
 * What the owner typed, as the integer the contract counts in.
 *
 * Digits and one point, never a float: money that round-trips through a double is money that
 * arrives a stroop light.
 */
export function toBase(amount: string): bigint {
  const [whole, fraction = ''] = amount.trim().split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new Error(`"${amount}" is not an amount`);
  }
  if (fraction.length > DECIMALS) {
    throw new Error(`USDC has ${DECIMALS} decimals, so "${amount}" is finer than it can hold`);
  }
  return (
    BigInt(whole) * 10n ** BigInt(DECIMALS) +
    BigInt((fraction + '0'.repeat(DECIMALS)).slice(0, DECIMALS))
  );
}
