import { Address, authorizeEntry, xdr } from '@stellar/stellar-sdk';
import { getAddressCredentials } from '@x402/stellar';
import type { AllowanceSigner } from './signer.js';

/**
 * Signs every auth entry the allowance owns, and returns the list with those replaced.
 *
 * The signature goes back to `authorizeEntry` as a `signatureScVal`. Returning raw bytes
 * instead sends it down a branch that calls `Keypair.fromPublicKey` on the entry's own
 * address, which a contract address fails with `invalid version byte. expected 48, got 16`.
 */
export async function authorizeAllowanceEntries(
  entries: xdr.SorobanAuthorizationEntry[],
  signer: AllowanceSigner,
  expirationLedger: number,
  networkPassphrase: string,
): Promise<xdr.SorobanAuthorizationEntry[]> {
  const signed = [...entries];

  for (const [i, entry] of signed.entries()) {
    const credentials = getAddressCredentials(entry.credentials());
    if (!credentials) continue;
    if (Address.fromScAddress(credentials.address()).toString() !== signer.address) continue;

    signed[i] = await authorizeEntry(
      entry,
      (_preimage, payload) => signer.sign(payload),
      expirationLedger,
      networkPassphrase,
    );
  }

  return signed;
}
