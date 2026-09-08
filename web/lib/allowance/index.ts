import { Address, Networks, rpc, xdr } from '@stellar/stellar-sdk';
import { deriveAllowanceAddress } from '@stellar-allowance/sdk';

// Presence is occupancy. An archived allowance still holds its address, so an entry that comes
// back at all means the index is taken, however dead it looks.
export function pickFreeIndex(addresses: string[], taken: Set<string>): number {
  const free = addresses.findIndex((address) => !taken.has(address));
  if (free === -1) throw new Error(`no free index in the first ${addresses.length}`);
  return free;
}

export const instanceKey = (contractId: string) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );

// One request covers the whole window.
export async function firstFreeIndex(
  server: rpc.Server,
  owner: string,
  window = 45,
): Promise<{ index: number; address: string }> {
  const addresses = Array.from({ length: window }, (_, index) =>
    deriveAllowanceAddress({ owner, index, networkPassphrase: Networks.TESTNET }),
  );
  const { entries } = await server.getLedgerEntries(...addresses.map(instanceKey));
  const taken = new Set(
    entries.map((entry) => Address.fromScAddress(entry.key.contractData().contract()).toString()),
  );
  const index = pickFreeIndex(addresses, taken);
  return { index, address: addresses[index] };
}
