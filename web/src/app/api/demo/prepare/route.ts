import type { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { db } from '@/lib/supabase';
import { env } from '@/lib/env';
import { arg, invoke, platformKeypair, read } from '@/lib/stellar';

/**
 * Puts the demo back to its starting position before a run.
 *
 * The landing page demo spends real testnet USDC, so a public URL means strangers spending it.
 * Without this the two columns drift into telling the same story — both empty — and the page
 * loses the contrast it exists to show. The unprotected agent in particular must start with
 * exactly its allotment, because "it spent everything it had" is only legible if it had
 * something.
 *
 * The money comes back rather than being handed out. The demo API's developer is the platform
 * itself, so flushing its splitter returns ninety percent as the developer share and ten as the
 * fee — the whole amount, less XLM transaction fees, which the platform holds in the thousands.
 *
 * Topping the allowance up is a plain token transfer, not `deposit`. `deposit` requires the
 * owner's signature by design; `balance()` reads the contract's own token balance, so anyone
 * can add to it and only the owner can take it out. That asymmetry is the point.
 */

export const maxDuration = 60;

/**
 * Both sides start with the same money. This is the whole basis of the comparison.
 *
 * An earlier version gave the unprotected agent 0.5 and the allowance 1.2, so the unprotected
 * one ran out after five purchases — but it ran out because it had been handed less, not
 * because anything stopped it. That is a confounded experiment presented as a controlled one,
 * and it made both columns read 5/7, which is the opposite of a contrast.
 *
 * At 1.2 each, seven attempts of 0.1 cost 0.7 and the unprotected agent pays every one of them:
 * nothing is positioned to refuse. The allowance pays five and refuses the rest against its 0.5
 * window cap, with 0.7 still in the contract. Same money in, same script, same API — 7/7
 * against 5/7, and the only difference is where the money sits.
 */
const START = 12_000_000n; // 1.2 USDC on both sides
const WALLET_TARGET = START;
const ALLOWANCE_TARGET = START;
const ALLOWANCE_FLOOR = 10_000_000n; // refill before a run could end short of its cap

async function usdcBalance(address: string): Promise<bigint> {
  const balance = await read(env.usdcSac(), 'balance', [arg.address(address)]);
  return BigInt((balance as bigint | string | number) ?? 0);
}

export async function POST(request: NextRequest) {
  const { apiId, allowanceId }: { apiId?: string; allowanceId?: string } = await request.json();
  if (!apiId || !allowanceId) {
    return Response.json({ error: 'apiId and allowanceId are required' }, { status: 400 });
  }

  const platform = platformKeypair();
  const walletAgent = process.env.WALLET_AGENT_ADDRESS;
  if (!walletAgent) {
    return Response.json({ error: 'WALLET_AGENT_ADDRESS is not set' }, { status: 500 });
  }

  const { data: api } = await db()
    .from('apis')
    .select('splitter_contract_id, developer_address')
    .eq('id', apiId)
    .single();

  if (!api?.splitter_contract_id) {
    return Response.json({ error: 'unknown demo API' }, { status: 404 });
  }

  const done: string[] = [];

  try {
    // 1 — recover what the last run spent. Only worth a transaction if there is something in
    //     there, and only ours to recover if the platform is the developer being paid.
    if (api.developer_address === env.platformAddress()) {
      const pending = await usdcBalance(api.splitter_contract_id);
      if (pending > 0n) {
        await invoke(api.splitter_contract_id, 'flush', [], platform);
        done.push(`recovered ${Number(pending) / 1e7} USDC`);
      }
    }

    // 2 — set to the target exactly, in either direction. Both columns must begin level, or the
    //     comparison measures the funding rather than the rule.
    const held = await usdcBalance(walletAgent);
    if (held !== WALLET_TARGET) {
      if (held < WALLET_TARGET) {
        await invoke(
          env.usdcSac(),
          'transfer',
          [
            arg.address(env.platformAddress()),
            arg.address(walletAgent),
            arg.i128(WALLET_TARGET - held),
          ],
          platform,
        );
      } else {
        // Moving money *out* of the agent is the agent's own transfer, so it has to be signed
        // by the agent and not by us.
        const agentSecret = process.env.WALLET_AGENT_SECRET;
        if (agentSecret) {
          await invoke(
            env.usdcSac(),
            'transfer',
            [
              arg.address(walletAgent),
              arg.address(env.platformAddress()),
              arg.i128(held - WALLET_TARGET),
            ],
            Keypair.fromSecret(agentSecret),
          );
        }
      }
      done.push(`wallet agent set to ${Number(WALLET_TARGET) / 1e7} USDC`);
    }

    // 3 — the allowance must always hold more than its window cap, or it stops because it is
    //     empty and the refusal reads as the same failure as the other column.
    const inAllowance = await usdcBalance(allowanceId);
    if (inAllowance < ALLOWANCE_FLOOR) {
      await invoke(
        env.usdcSac(),
        'transfer',
        [
          arg.address(env.platformAddress()),
          arg.address(allowanceId),
          arg.i128(ALLOWANCE_TARGET - inAllowance),
        ],
        platform,
      );
      done.push(`allowance topped up to ${Number(ALLOWANCE_TARGET) / 1e7} USDC`);
    }

    // The starting position, read after the resets rather than assumed from the targets — a
    // top-up that failed would otherwise be reported as a figure that was never true. The page
    // needs these: an ending balance means nothing without the one it started from.
    return Response.json({
      ready: true,
      done,
      start: {
        wallet: (await usdcBalance(walletAgent)).toString(),
        allowance: (await usdcBalance(allowanceId)).toString(),
      },
    });
  } catch (cause) {
    // A run against a slightly-off starting position still demonstrates the mechanism, so this
    // reports what it managed and lets the demo proceed rather than blocking on it.
    let start = null;
    try {
      start = {
        wallet: (await usdcBalance(walletAgent)).toString(),
        allowance: (await usdcBalance(allowanceId)).toString(),
      };
    } catch {
      // Reporting the failure below matters more than reporting the balances.
    }
    return Response.json({
      ready: false,
      done,
      start,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/** The starting position, without changing anything — used to check the demo's health. */
export async function GET() {
  const walletAgent = process.env.WALLET_AGENT_ADDRESS;
  return Response.json({
    platform: (await usdcBalance(env.platformAddress())).toString(),
    wallet_agent: walletAgent ? (await usdcBalance(walletAgent)).toString() : null,
  });
}
