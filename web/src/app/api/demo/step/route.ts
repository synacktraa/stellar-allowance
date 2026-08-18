import type { NextRequest } from 'next/server';
import {
  Contract,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { env } from '@/lib/env';
import { read, server } from '@/lib/stellar';

/**
 * One purchase, either way.
 *
 * A step at a time rather than the whole run, because a single purchase takes about seven
 * seconds — most of it waiting for a ledger to close — and seven of them in one request would
 * outlast any serverless function. Stepping also lets the page fill in as it goes, which is
 * the part worth watching.
 */

export const maxDuration = 60;

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

type Body = {
  mode?: 'allowance' | 'unprotected';
  apiId?: string;
  allowanceId?: string;
};

async function usdcBalance(address: string): Promise<string> {
  try {
    const horizon = new Horizon.Server(env.horizonUrl());
    const account = await horizon.loadAccount(address);
    const line = account.balances.find(
      (b) => 'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
    );
    return line && 'balance' in line ? line.balance : '0';
  } catch {
    return '0';
  }
}

async function settle(tx: Parameters<rpc.Server['sendTransaction']>[0]) {
  const rpcServer = server();
  const sent = await rpcServer.sendTransaction(tx);
  if (sent.status === 'ERROR') return { ok: false as const, reason: 'rejected before inclusion' };

  let result = await rpcServer.getTransaction(sent.hash);
  const deadline = Date.now() + 40_000;
  while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) return { ok: false as const, reason: 'timed out' };
    await new Promise((r) => setTimeout(r, 900));
    result = await rpcServer.getTransaction(sent.hash);
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    return { ok: false as const, reason: 'refused on-chain' };
  }
  return { ok: true as const, hash: sent.hash };
}

/** Turns a host error into the reason a person would give. */
function readReason(detail: string): string {
  if (/not within the allowed range|#10/.test(detail)) return 'wallet empty';
  if (/#7/.test(detail)) return 'over the window cap';
  if (/#5/.test(detail)) return 'over the per-call cap';
  if (/#6/.test(detail)) return 'recipient not allowed';
  if (/#4/.test(detail)) return 'agent revoked';
  return detail.split('\n')[0].slice(0, 90);
}

export async function POST(request: NextRequest) {
  const { mode = 'unprotected', apiId, allowanceId }: Body = await request.json();
  if (!apiId) return Response.json({ error: 'apiId is required' }, { status: 400 });
  if (mode === 'allowance' && !allowanceId) {
    return Response.json({ error: 'allowanceId is required' }, { status: 400 });
  }

  const payer = Keypair.fromSecret(
    mode === 'allowance' ? env.demoAgentSecret() : required('WALLET_AGENT_SECRET'),
  );
  const paidUrl = `${request.nextUrl.origin}/api/pay/${apiId}`;

  // 1 — ask, and be refused with a price
  const quote = await fetch(paidUrl);
  if (quote.status !== 402) {
    return Response.json({ error: `expected 402, got ${quote.status}` }, { status: 502 });
  }
  const { amount, recipient, reference } = await quote.json();

  // 2 — pay, one way or the other
  const rpcServer = server();
  const account = await rpcServer.getAccount(payer.publicKey());
  const builder = new TransactionBuilder(account, {
    fee: '2000000',
    networkPassphrase: env.networkPassphrase(),
  });

  builder.addOperation(
    mode === 'allowance'
      ? new Contract(allowanceId!).call(
          'spend',
          nativeToScVal(recipient, { type: 'address' }),
          nativeToScVal(BigInt(amount), { type: 'i128' }),
          nativeToScVal(reference, { type: 'symbol' }),
        )
      : Operation.invokeContractFunction({
          contract: env.usdcSac(),
          function: 'transfer',
          args: [
            nativeToScVal(payer.publicKey(), { type: 'address' }),
            nativeToScVal(recipient, { type: 'address' }),
            nativeToScVal(BigInt(amount), { type: 'i128' }),
          ],
        }),
  );

  let paid;
  try {
    const prepared = await rpcServer.prepareTransaction(builder.setTimeout(60).build());
    prepared.sign(payer);
    paid = await settle(prepared);
  } catch (cause) {
    paid = {
      ok: false as const,
      reason: readReason(cause instanceof Error ? cause.message : String(cause)),
    };
  }

  /**
   * What is left, and where.
   *
   * These are different accounts on purpose. An unprotected agent holds its own USDC, so its
   * wallet is the thing that drains. An agent with an allowance holds nothing at all — its
   * wallet is zero before the first call and zero after the last — so reporting it would show
   * both columns ending at 0.00 and hide the entire point. The money that survives is in the
   * contract.
   */
  const remaining =
    mode === 'allowance'
      ? String(Number(((await readBalance(allowanceId!)) ?? 0n)) / 1e7)
      : await usdcBalance(payer.publicKey());

  if (!paid.ok) {
    return Response.json({
      delivered: false,
      refused: true,
      reason: paid.reason,
      amount,
      remaining,
      remainingLabel: mode === 'allowance' ? 'allowance after' : 'wallet after',
    });
  }

  // 3 — come back and point at the payment
  const headers: Record<string, string> = { 'x-payment-tx': paid.hash };
  if (mode !== 'allowance') headers['x-allowance-reference'] = reference;

  const delivery = await fetch(paidUrl, { headers });
  const body = await delivery.text();

  return Response.json({
    delivered: delivery.ok,
    refused: false,
    amount,
    txHash: paid.hash,
    status: delivery.status,
    body: body.replace(/\s+/g, ' ').slice(0, 90),
    remaining:
      mode === 'allowance'
        ? String(Number((await readBalance(allowanceId!)) ?? 0n) / 1e7)
        : await usdcBalance(payer.publicKey()),
    remainingLabel: mode === 'allowance' ? 'allowance after' : 'wallet after',
  });
}

async function readBalance(contractId: string): Promise<bigint | null> {
  try {
    const value = await read(contractId, 'balance');
    return BigInt(value as string | number | bigint);
  } catch {
    return null;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
