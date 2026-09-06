import { Address, Networks, StrKey, hash, xdr } from '@stellar/stellar-sdk';

export interface DeriveOptions {
  /** The owner's G address. The deployer, so only they can create at this address. */
  owner: string;
  /** Which of that owner's allowances. Their allowances are one sequence from zero. */
  index: number;
  /** Defaults to testnet. The contract is unaudited and is not built for mainnet. */
  networkPassphrase?: string;
}

/**
 * The salt an allowance is deployed with: `sha256(ScVal(owner) + ScVal(index))`.
 *
 * The pieces are XDR-encoded as soroban's `ToXdr` encodes them, so a contract computing
 * this salt produces the same bytes.
 */
export function generateAllowanceSalt(owner: string, index: number): Buffer {
  const address = xdr.ScVal.scvAddress(new Address(owner).toScAddress()).toXDR();
  const position = xdr.ScVal.scvU32(index).toXDR();
  return hash(Buffer.concat([address, position]));
}

/**
 * Where an owner's allowance at this index is, whether or not it exists yet. Pure: no
 * network, and no answer to whether anything is deployed there.
 */
export function deriveAllowanceAddress({
  owner,
  index,
  networkPassphrase = Networks.TESTNET,
}: DeriveOptions): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(networkPassphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: new Address(owner).toScAddress(),
          salt: generateAllowanceSalt(owner, index),
        }),
      ),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}
