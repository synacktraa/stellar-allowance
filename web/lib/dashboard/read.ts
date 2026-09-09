import { Address, Networks, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { deriveAllowanceAddress } from '@stellar-allowance/sdk';
import { MAX_ALLOWANCES, USDC_SAC } from '../demo/params';
import { summarize, type Summary } from './summary';
import { spentInWindow, type Window } from './window';

export const RPC_URL = 'https://soroban-testnet.stellar.org';

export interface Row extends Summary {
  credits: bigint;
  spent: bigint;
  /** The ledger this allowance stops being readable at, unless a payment renews it. */
  liveUntilLedger?: number;
}

export interface Listing {
  rows: Row[];
  /** Where a new allowance would go. Undefined once the owner has used every index. */
  nextIndex?: number;
  ledger: number;
}

const contractData = (contract: string, key: xdr.ScVal) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contract).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );

const instanceKey = (contract: string) =>
  contractData(contract, xdr.ScVal.scvLedgerKeyContractInstance());

// The contract's DataKey is a unit-variant enum, which encodes as a one-symbol vector.
const dataKey = (name: string) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);

const balanceKey = (token: string, holder: string) =>
  contractData(
    token,
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Balance'), new Address(holder).toScVal()]),
  );

const contractOf = (entry: rpc.Api.LedgerEntryResult) =>
  Address.fromScAddress(entry.val.contractData().contract()).toString();

// Instance storage arrives as a list of key/value pairs whose keys are those one-symbol
// vectors. Flatten it to the record the summary expects.
function instanceStorage(entry: rpc.Api.LedgerEntryResult): Record<string, unknown> {
  const pairs = entry.val.contractData().val().instance().storage() ?? [];
  const storage: Record<string, unknown> = {};
  for (const pair of pairs) {
    const key = scValToNative(pair.key());
    const name = Array.isArray(key) ? String(key[0]) : String(key);
    storage[name] = scValToNative(pair.val());
  }
  return storage;
}

/**
 * Everything an owner has, in two requests.
 *
 * The first asks for all sixty derived addresses at once; whatever answers exists, and the
 * gaps are free indexes. The second asks each survivor for its spend window and its USDC
 * balance. Nothing here is cached: occupancy is the one thing a stale answer gets wrong in a
 * way the owner pays for, so every load probes.
 */
export async function readAllowances(
  server: rpc.Server,
  owner: string,
  networkPassphrase: string = Networks.TESTNET,
): Promise<Listing> {
  const addresses = Array.from({ length: MAX_ALLOWANCES }, (_, index) =>
    deriveAllowanceAddress({ owner, index, networkPassphrase }),
  );

  const probe = await server.getLedgerEntries(...addresses.map(instanceKey));
  const found = new Map(probe.entries.map((entry) => [contractOf(entry), entry]));
  const nextIndex = addresses.findIndex((address) => !found.has(address));

  const summaries = addresses
    .map((address, index) => ({ address, index, entry: found.get(address) }))
    .filter((row): row is { address: string; index: number; entry: rpc.Api.LedgerEntryResult } =>
      Boolean(row.entry),
    )
    .map(({ address, index, entry }) => ({
      summary: summarize(address, index, instanceStorage(entry)),
      liveUntilLedger: entry.liveUntilLedgerSeq,
    }));

  if (summaries.length === 0) {
    return { rows: [], nextIndex: 0, ledger: probe.latestLedger };
  }

  const hydrate = await server.getLedgerEntries(
    ...summaries.flatMap(({ summary }) => [
      contractData(summary.id, dataKey('Window')),
      balanceKey(summary.token || USDC_SAC, summary.id),
    ]),
  );

  const windows = new Map<string, Window>();
  const credits = new Map<string, bigint>();
  for (const entry of hydrate.entries) {
    const data = entry.val.contractData();
    const key = scValToNative(data.key()) as unknown[];
    const value = scValToNative(data.val());
    if (key[0] === 'Window') {
      windows.set(contractOf(entry), value as Window);
    } else if (key[0] === 'Balance') {
      credits.set(String(key[1]), (value as { amount: bigint }).amount);
    }
  }

  const ledger = hydrate.latestLedger || probe.latestLedger;
  const rows = summaries.map(({ summary, liveUntilLedger }) => ({
    ...summary,
    liveUntilLedger,
    credits: credits.get(summary.id) ?? 0n,
    spent: spentInWindow(windows.get(summary.id), summary.windowLedgers, ledger),
  }));

  return { rows, nextIndex: nextIndex === -1 ? undefined : nextIndex, ledger };
}
