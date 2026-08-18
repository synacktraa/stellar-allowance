import { db } from '@/lib/supabase';

/**
 * Every API on the gateway, for choosing what an allowance may pay.
 *
 * The user picks APIs; the contract stores addresses. Resolving one to the other happens here,
 * off-chain, because a contract has no network access and could never resolve a URL — so the
 * picker is a convenience and the resulting address list is the part the network enforces.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data } = await db()
    .from('apis')
    .select('id, name, upstream_url, price_stroops, splitter_contract_id')
    .eq('status', 'active')
    .not('splitter_contract_id', 'is', null)
    .order('created_at', { ascending: false });

  return Response.json({ apis: data ?? [] });
}
