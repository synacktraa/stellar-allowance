import {
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { env } from './env';

/** USDC has 7 decimals. Amounts are always integers in base units — never floats. */
export const STROOPS_PER_USDC = 10_000_000n;

export function toUsdc(stroops: bigint | string | number): string {
  const value = BigInt(stroops);
  const whole = value / STROOPS_PER_USDC;
  const fraction = (value % STROOPS_PER_USDC).toString().padStart(7, '0');
  return `${whole}.${fraction}`;
}

export function server(): rpc.Server {
  return new rpc.Server(env.rpcUrl());
}

/**
 * Which of these contracts are running the binary we currently deploy.
 *
 * **A deployed contract keeps the code it was created with.** There is no migration and no
 * upgrade path, so an allowance made before a change simply does not have the functions added
 * since — and an interface that offers one anyway produces "trying to invoke non-existent
 * contract function" in front of somebody who pressed a button we drew for them.
 *
 * One batched ledger read for the whole list. Anything unreadable is reported as *not* current,
 * because the only thing this is used for is deciding whether to offer a newer function, and
 * guessing yes is the answer that breaks.
 */
export async function onCurrentWasm(contractIds: string[]): Promise<Set<string>> {
  if (contractIds.length === 0) return new Set();

  const current = env.allowanceWasmHash().toLowerCase();
  const keys = contractIds.map((id) =>
    xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: Address.fromString(id).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    ),
  );

  try {
    const { entries } = await server().getLedgerEntries(...keys);
    const matching = new Set<string>();

    for (const entry of entries) {
      const data = entry.val.contractData();
      const executable = data.val().instance().executable();
      if (executable.switch().name !== 'contractExecutableWasm') continue;
      if (executable.wasmHash().toString('hex').toLowerCase() !== current) continue;
      matching.add(Address.fromScAddress(data.contract()).toString());
    }
    return matching;
  } catch {
    return new Set();
  }
}

export function platformKeypair(): Keypair {
  return Keypair.fromSecret(env.platformSecret());
}

/**
 * Builds, simulates, signs and submits a contract call, then waits for the ledger to close.
 *
 * `prepareTransaction` is the simulation step. It fills in the storage footprint and resource
 * fees, and skipping it produces a failure that reports a resource error rather than anything
 * resembling the real cause.
 */
export async function invoke(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  signer: Keypair,
): Promise<{ hash: string; returnValue: unknown }> {
  const rpcServer = server();
  const account = await rpcServer.getAccount(signer.publicKey());

  const built = new TransactionBuilder(account, {
    fee: '2000000',
    networkPassphrase: env.networkPassphrase(),
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();

  const prepared = await rpcServer.prepareTransaction(built);
  prepared.sign(signer);

  const sent = await rpcServer.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`submit failed for ${method}: ${JSON.stringify(sent.errorResult)}`);
  }

  let result = await rpcServer.getTransaction(sent.hash);
  const deadline = Date.now() + 30_000;
  while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${method} (${sent.hash})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await rpcServer.getTransaction(sent.hash);
  }

  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`${method} reverted (${sent.hash})`);
  }

  return {
    hash: sent.hash,
    returnValue: result.returnValue ? scValToNative(result.returnValue) : null,
  };
}

/**
 * Reads a contract without submitting anything. Simulation alone is enough for a view, and it
 * costs no fee and needs no signature.
 */
export async function read(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<unknown> {
  const rpcServer = server();
  // Any funded account works as the simulation source; nothing is signed or submitted.
  const account = await rpcServer.getAccount(env.platformAddress());

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: env.networkPassphrase(),
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const simulated = await rpcServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`${method} simulation failed: ${simulated.error}`);
  }
  if (!simulated.result?.retval) {
    return null;
  }
  return scValToNative(simulated.result.retval);
}

export const arg = {
  address: (value: string) => nativeToScVal(value, { type: 'address' }),
  i128: (value: bigint | string | number) =>
    nativeToScVal(BigInt(value), { type: 'i128' }),
  u32: (value: number) => nativeToScVal(value, { type: 'u32' }),
  symbol: (value: string) => nativeToScVal(value, { type: 'symbol' }),
};
