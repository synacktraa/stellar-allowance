import {
  Address,
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
  scValToNative,
} from '@stellar/stellar-sdk';
import { env } from './env';

/**
 * Reading a payment that has not happened yet.
 *
 * Normally an agent pays, waits about five seconds for a ledger to close, and then points the
 * gateway at the hash. The waiting is most of the seven seconds a purchase takes.
 *
 * It is avoidable because the allowance's rules run during **simulation**, not at apply time. By
 * the time a transaction has been prepared, the per-call cap, the rolling window and the
 * allowlist have all been checked — a refusal is already known. So the agent can hand over the
 * signed transaction itself, and the gateway can see everything it needs without waiting for the
 * network to agree.
 *
 * What is read here is the transaction's own content, not a claim about it. The sender chooses
 * the bytes, so every field below is treated as hostile until the caller has checked it against
 * a challenge it issued: which contract is being asked to pay, who is being paid, how much, and
 * which request it settles.
 *
 * Simulating it is a separate step, and a necessary one. This function only says what the
 * transaction *would* do.
 */

export type Spend = {
  transaction: Transaction;
  /** The allowance being asked to pay. Not checked here — anyone may hold one. */
  allowance: string;
  /** Whose account submits it, pays the fee, and answers for it if it bounces. */
  agent: string;
  to: string;
  amountStroops: bigint;
  reference: string;
};

export type EnvelopeFailure =
  | 'unreadable'
  | 'not_one_operation'
  | 'not_a_contract_call'
  | 'not_a_spend'
  | 'bad_arguments';

export type EnvelopeResult =
  | { ok: true; spend: Spend }
  | { ok: false; reason: EnvelopeFailure };

export function readSpend(xdr: string): EnvelopeResult {
  let transaction: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(xdr, env.networkPassphrase());
    // A fee-bump wraps another transaction, and unwrapping one here would mean reasoning about
    // two sources and two fee payers to save a case nobody is using.
    if (parsed instanceof FeeBumpTransaction) return { ok: false, reason: 'unreadable' };
    transaction = parsed;
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  // One operation, so there is nothing else riding along. Soroban permits only one anyway, but
  // that is the network's rule to enforce and this is ours to state.
  if (transaction.operations.length !== 1) {
    return { ok: false, reason: 'not_one_operation' };
  }

  const operation = transaction.operations[0] as { type: string; func?: unknown };
  if (operation.type !== 'invokeHostFunction' || !operation.func) {
    return { ok: false, reason: 'not_a_contract_call' };
  }

  let allowance: string;
  let name: string;
  let args: unknown[];
  try {
    // Uploading wasm or creating a contract are also host functions; asking one of those for its
    // contract call throws, which is the check.
    const invoke = (operation.func as { invokeContract: () => {
      contractAddress: () => Parameters<typeof Address.fromScAddress>[0];
      functionName: () => { toString: () => string };
      args: () => Parameters<typeof scValToNative>[0][];
    } }).invokeContract();

    allowance = Address.fromScAddress(invoke.contractAddress()).toString();
    name = invoke.functionName().toString();
    args = invoke.args().map((arg) => scValToNative(arg));
  } catch {
    return { ok: false, reason: 'not_a_contract_call' };
  }

  if (name !== 'spend') return { ok: false, reason: 'not_a_spend' };
  if (args.length !== 3) return { ok: false, reason: 'bad_arguments' };

  const [to, amount, reference] = args;
  if (typeof to !== 'string' || typeof reference !== 'string') {
    return { ok: false, reason: 'bad_arguments' };
  }

  let amountStroops: bigint;
  try {
    amountStroops = BigInt(amount as string | number | bigint);
  } catch {
    return { ok: false, reason: 'bad_arguments' };
  }

  return {
    ok: true,
    spend: {
      transaction,
      allowance,
      agent: transaction.source,
      to,
      amountStroops,
      reference,
    },
  };
}
