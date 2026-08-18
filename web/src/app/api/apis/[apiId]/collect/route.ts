import type { NextRequest } from 'next/server';
import { db } from '@/lib/supabase';
import { invoke, platformKeypair } from '@/lib/stellar';

/**
 * Pays out a splitter's accumulated balance: 90% to the developer, 10% to the platform.
 *
 * The platform submits and pays the fee, but that is a convenience rather than a permission.
 * `flush()` is callable by anyone — the funds can only reach the two addresses fixed when the
 * splitter was created — so a developer is never waiting on us to release their money. If this
 * endpoint disappeared they could call the contract directly.
 *
 * Sending tokens to a contract runs none of its code, which is why a payout has to be
 * triggered at all rather than happening on receipt.
 */

export const maxDuration = 60;

export async function POST(_request: NextRequest, ctx: RouteContext<'/api/apis/[apiId]/collect'>) {
  const { apiId } = await ctx.params;

  const { data: api } = await db()
    .from('apis')
    .select('splitter_contract_id')
    .eq('id', apiId)
    .maybeSingle<{ splitter_contract_id: string | null }>();

  if (!api?.splitter_contract_id) {
    return Response.json({ error: 'No such API.' }, { status: 404 });
  }

  try {
    const { hash, returnValue } = await invoke(
      api.splitter_contract_id,
      'flush',
      [],
      platformKeypair(),
    );

    const [developerAmount, platformAmount] = (returnValue as [string, string]) ?? ['0', '0'];

    return Response.json({
      tx: hash,
      developer_stroops: String(developerAmount),
      platform_stroops: String(platformAmount),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    // Contract error 4 is NothingToFlush — an empty splitter, not a failure worth alarming about.
    if (/#4/.test(detail)) {
      return Response.json({ error: 'Nothing to collect yet.' }, { status: 409 });
    }
    return Response.json({ error: detail }, { status: 502 });
  }
}
