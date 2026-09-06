import { Keypair, StrKey, xdr } from '@stellar/stellar-sdk';

export interface AllowanceSigner {
  /** The allowance's C address. What the token calls `require_auth` on. */
  readonly address: string;
  /**
   * Signs the 32-byte auth payload as the allowance's `Signature`, a `BytesN<64>`.
   *
   * The returned shape is what `authorizeEntry` accepts in place of a signature it would
   * otherwise wrap in an account's own format.
   */
  sign(payload: Buffer): Promise<{ signatureScVal: xdr.ScVal }>;
}

/**
 * A signer for one allowance, holding the agent's key.
 *
 * The address is the allowance's and the key is the agent's. `__check_auth` verifies the
 * signature against the `agent_key` the allowance was constructed with.
 */
export function createAllowanceSigner(address: string, secret: string): AllowanceSigner {
  if (!StrKey.isValidContract(address)) {
    throw new Error(`not a contract address: ${address}`);
  }
  const agent = Keypair.fromSecret(secret);
  return {
    address,
    async sign(payload: Buffer) {
      return { signatureScVal: xdr.ScVal.scvBytes(agent.sign(payload)) };
    },
  };
}
