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

/** What each side needs to tell its half of the story. */
const WALLET_TARGET = 5_000_000n; // 0.5 USDC — five purchases, then genuinely empty
const ALLOWANCE_TARGET = 12_000_000n; // 1.2 USDC — always more than the window cap allows
// Top up below 1.0 rather than 0.7. At the old floor a run could start at exactly 0.7 and end
// at 0.2, which still tells the story but faintly: the point is that the rule stopped it while
// there was plainly money left, and 1.2 → 0.7 says that where 0.7 → 0.2 mumbles it.
const ALLOWANCE_FLOOR = 10_000_000n;

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

    // 2 — the unprotected agent starts with exactly its allotment and no more, so that running
    //     out lands as the consequence of having no limit rather than of being underfunded.
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
        // Above target it would not drain within seven attempts, and the column would end with
        // money left — which is the other column's ending. Moving money *out* of the agent is
        // the agent's own transfer, so it has to be signed by the agent and not by us.
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
