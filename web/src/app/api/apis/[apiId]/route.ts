import type { NextRequest } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyProof } from '@/lib/auth';

/**
 * Editing an API you registered.
 *
 * The gap this closes has been open since the beginning: a price could be set once and never
 * changed, an upstream URL was fixed at registration, and there was no way to retire an API at
 * all. Every one of those is a column the database has always had and the interface never
 * offered — the same shape as the allowlist editor, and the reason a price rise could break a
 * buyer with no way for anyone to fix it.
 *
 * The payout address is deliberately not here. It is fixed inside the splitter contract at
 * deployment and cannot be changed by us or by the developer, which is the reason a developer
 * does not have to trust us with their money. Editing it would mean redeploying, and a new
 * splitter is a new address that every existing allowlist would no longer match.
 */

export const dynamic = 'force-dynamic';

type Api = {
  id: string;
  developer_address: string;
  name: string;
  upstream_url: string;
  price_stroops: string;
  status: string;
};

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/apis/[apiId]'>) {
  const { apiId } = await ctx.params;

  let body: {
    address?: string;
    nonce?: string;
    signature?: string;
    name?: string;
    price_stroops?: string | number;
    upstream_url?: string;
    status?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const proof = await verifyProof(body);
  if (!proof.ok) {
    return Response.json({ error: `Could not prove that address: ${proof.reason}.` }, { status: 401 });
  }

  const supabase = db();
  const { data: api } = await supabase
    .from('apis')
    .select('id, developer_address, name, upstream_url, price_stroops, status')
    .eq('id', apiId)
    .maybeSingle<Api>();

  // Same answer for "no such API" and "not yours", so this cannot be used to discover which ids
  // belong to whom.
  if (!api || api.developer_address !== proof.address) {
    return Response.json({ error: 'No such API.' }, { status: 404 });
  }

  const patch: Record<string, string> = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return Response.json({ error: 'name cannot be empty.' }, { status: 400 });
    patch.name = name;
  }

  if (body.price_stroops !== undefined) {
    let price: bigint;
    try {
      price = BigInt(body.price_stroops);
    } catch {
      return Response.json({ error: 'price_stroops must be a whole number.' }, { status: 400 });
    }
    if (price <= 0n) {
      return Response.json({ error: 'price_stroops must be positive.' }, { status: 400 });
    }
    // A buyer holding a quote is unaffected: the gateway settles against the price it quoted,
    // for as long as that quote lives. A rise only reaches people who ask after this moment.
    patch.price_stroops = price.toString();
  }

  if (body.upstream_url !== undefined) {
    let target: URL;
    try {
      target = new URL(body.upstream_url);
    } catch {
      return Response.json({ error: 'upstream_url must be an absolute URL.' }, { status: 400 });
    }
    if (target.protocol !== 'https:' && target.hostname !== 'localhost') {
      return Response.json({ error: 'upstream_url must use https.' }, { status: 400 });
    }
    patch.upstream_url = target.toString();
  }

  if (body.status !== undefined) {
    // Retiring is the only status a developer sets. `pending` belongs to a half-finished deploy
    // and `active` is what the deploy decides, so neither is theirs to assert.
    if (body.status !== 'archived') {
      return Response.json({ error: 'status can only be set to archived.' }, { status: 400 });
    }
    patch.status = 'archived';
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'Nothing to change.' }, { status: 400 });
  }

  const { error } = await supabase.from('apis').update(patch).eq('id', api.id);
  if (error) {
    // The only constraint that can fail here is one name per developer.
    return Response.json({ error: `You already have an API called ${patch.name}.` }, { status: 409 });
  }

  return Response.json({ ...api, ...patch });
}
