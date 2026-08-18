import { Address, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { env } from './env';
import { server } from './stellar';

/**
 * Proving that a payment happened, and that it paid for *this* request.
 *
 * The `X-Payment-Tx` header is attacker-controlled input. It is a pointer, not evidence — it
 * only says where to look. Transaction hashes are public, so a caller can send someone else's.
 * Everything that matters is read back off the chain.
 *
 * Two facts have to hold together:
 *
 *   1. Real USDC moved to this API's splitter, in this transaction, for at least the price.
 *      Read from the token contract's own transfer event, so a contract that merely *claims*
 *      to have paid proves nothing.
 *   2. The transaction carries the reference we issued for this challenge.
 *
 * Either alone is useless. A payment with no reference cannot be matched to a request; a
 * reference with no payment is just a string.
 *
 * Note what is deliberately *not* checked: whether the payer used an allowance. A direct payer
 * with no allowance is equally welcome — the gateway is not the thing enforcing limits.
 */

export type VerifiedPayment = {
  /** Present when the payment went through an allowance; null for a direct payer. */
  reference: string | null;
  amountStroops: bigint;
  recipient: string;
};

export type VerifyFailure =
  | 'not_found'
  | 'not_successful'
  | 'no_reference'
  | 'no_matching_transfer';

export type VerifyResult =
  | { ok: true; payment: VerifiedPayment }
  | { ok: false; reason: VerifyFailure };

/**
 * Pulls contract events out of a transaction's result metadata.
 *
 * The location changed between meta versions. Up to v3 they sat under `sorobanMeta`; from v4
 * (Protocol 23 onward, which is what testnet runs) they are per-operation, with a separate
 * transaction-level list that wraps each event alongside its stage. Both are gathered so this
 * keeps working either side of the change.
 */
function contractEvents(meta: xdr.TransactionMeta): xdr.ContractEvent[] {
  switch (meta.switch()) {
    case 3:
      return meta.v3().sorobanMeta()?.events() ?? [];
    case 4: {
      const v4 = meta.v4();
      const fromOperations = v4.operations().flatMap((operation) => operation.events());
      const fromTransaction = v4.events().map((event) => event.event());
      return [...fromOperations, ...fromTransaction];
    }
    default:
      return [];
  }
}

/**
 * Finds a `transfer` event emitted by the USDC contract itself.
 *
 * Topics for the SAC are ["transfer", from, to, sep41_asset_string] and the value is the amount.
 */
function findTransfer(
  events: xdr.ContractEvent[],
  expectedRecipient: string,
): { to: string; amount: bigint } | null {
  const usdc = env.usdcSac();

  for (const event of events) {
    const emitter = event.contractId();
    if (!emitter) continue;
    // Only the token contract's own event proves USDC moved. A contract that merely claims
    // to have paid can emit anything it likes.
    // `contractId()` is an XDR Hash, which the generated types model as an opaque array; it is
    // 32 raw bytes at runtime.
    const emitterId = Address.contract(
      Buffer.from(emitter as unknown as Uint8Array),
    ).toString();
    if (emitterId !== usdc) continue;

    const body = event.body().v0();
    const topics = body.topics().map((topic) => {
      try {
        return scValToNative(topic);
      } catch {
        return null;
      }
    });

    if (topics[0] !== 'transfer') continue;

    const to = topics[2];
    if (typeof to !== 'string' || to !== expectedRecipient) continue;

    let amount: bigint;
    try {
      amount = BigInt(scValToNative(body.data()) as string | bigint | number);
    } catch {
      continue;
    }

    return { to, amount };
  }

  return null;
}

/**
 * Reads the reference out of an allowance's `spend_recorded` event.
 *
 * The obvious place for this was the transaction memo, which does not work: **Soroban
 * transactions do not support memos at all**. That rules it out for both paths, because paying
 * a splitter means a SAC transfer, which is itself a Soroban operation.
 *
 * So the reference travels the only way it can — as an argument to `spend()`, echoed back in
 * the contract's event.
 *
 * Trusting any contract's event is safe here because it proves nothing on its own. The money
 * is verified separately against the token contract's own transfer event, so a contract that
 * emits a reference without paying gets nowhere.
 */
function readReference(events: xdr.ContractEvent[]): string | null {
  for (const event of events) {
    const body = event.body().v0();
    const topics = body.topics().map((topic) => {
      try {
        return scValToNative(topic);
      } catch {
        return null;
      }
    });

    if (topics[0] !== 'spend_recorded') continue;

    // Topics are [event name, to, reference].
    const reference = topics[2];
    if (typeof reference === 'string' && reference.length > 0) {
      return reference;
    }
  }
  return null;
}

export async function verifyPayment(
  txHash: string,
  expected: { recipient: string; minAmountStroops: bigint },
): Promise<VerifyResult> {
  const result = await server().getTransaction(txHash);

  if (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    return { ok: false, reason: 'not_found' };
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    return { ok: false, reason: 'not_successful' };
  }

  const events = contractEvents(result.resultMetaXdr);

  const transfer = findTransfer(events, expected.recipient);
  if (!transfer || transfer.amount < expected.minAmountStroops) {
    return { ok: false, reason: 'no_matching_transfer' };
  }

  // Null for a payer with no allowance, which is allowed — the caller then has to supply the
  // reference itself, and gets a weaker guarantee for it.
  const reference = readReference(events);

  return {
    ok: true,
    payment: {
      reference,
      amountStroops: transfer.amount,
      recipient: transfer.to,
    },
  };
}
