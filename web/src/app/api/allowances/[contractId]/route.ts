import type { NextRequest } from 'next/server';
import { read } from '@/lib/stellar';

/**
 * Live state for one allowance, read straight off the chain.
 *
 * Nothing here is cached or mirrored into the database. Balance, remaining budget and the rules
 * are whatever the contract says right now, which means the dashboard cannot drift out of sync
 * with the thing it is describing — there is no second copy to disagree.
 *
 * All four are simulations, so they cost nothing and need no signature.
 */

export const dynamic = 'force-dynamic';

type Rules = {
  max_per_call: bigint;
  window_ledgers: number;
  window_cap: bigint;
  allowlist: string[];
};

export async function GET(_request: NextRequest, ctx: RouteContext<'/api/allowances/[contractId]'>) {
  const { contractId } = await ctx.params;

  if (!contractId?.startsWith('C') || contractId.length !== 56) {
    return Response.json({ error: 'not a contract address' }, { status: 400 });
  }

  try {
    const [balance, remaining, spent, rules, revoked] = await Promise.all([
      read(contractId, 'balance'),
      read(contractId, 'remaining'),
      read(contractId, 'spent_in_window'),
      read(contractId, 'config'),
      read(contractId, 'revoked'),
    ]);

    const config = rules as Rules;

    return Response.json({
      contract_id: contractId,
      balance: String(balance ?? 0),
      remaining: String(remaining ?? 0),
      spent_in_window: String(spent ?? 0),
      revoked: Boolean(revoked),
      rules: {
        max_per_call: String(config.max_per_call),
        window_ledgers: config.window_ledgers,
        window_cap: String(config.window_cap),
        allowlist: config.allowlist,
      },
    });
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : String(cause) },
      { status: 502 },
    );
  }
}
