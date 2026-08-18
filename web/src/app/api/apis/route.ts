import type { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import { db } from '@/lib/supabase';
import { deployInstance } from '@/lib/deploy';
import { env } from '@/lib/env';
import { arg } from '@/lib/stellar';

/**
 * Registering an API.
 *
 * Two things happen together: a row is written, and a splitter contract is deployed for this
 * API alone. The splitter is why an allowance can allowlist one API and not another — a shared
 * platform address would make every API resolve to the same recipient, and the allowlist could
 * not tell them apart.
 *
 * The row is inserted as `pending` and only flipped to `active` once the splitter exists. The
 * gateway refuses anything that is not active with a splitter, so a deploy that fails halfway
 * leaves an API that is invisible rather than one taking payments nobody can collect.
 */

// One transaction, but it still waits for a ledger to close.
export const maxDuration = 60;

type RegisterBody = {
  developer_address?: string;
  name?: string;
  upstream_url?: string;
  price_stroops?: string | number;
  payout_address?: string;
};

function bad(detail: string) {
  return Response.json({ error: detail }, { status: 400 });
}

export async function POST(request: NextRequest) {
  let body: RegisterBody;
  try {
    body = await request.json();
  } catch {
    return bad('Body must be JSON.');
  }

  const developer = body.developer_address?.trim();
  const payout = body.payout_address?.trim() || developer;
  const name = body.name?.trim();
  const upstream = body.upstream_url?.trim();
  const price = BigInt(body.price_stroops ?? 0);

  if (!developer || !StrKey.isValidEd25519PublicKey(developer)) {
    return bad('developer_address must be a Stellar account address.');
  }
  if (!payout || !StrKey.isValidEd25519PublicKey(payout)) {
    return bad('payout_address must be a Stellar account address.');
  }
  if (!name) return bad('name is required.');
  if (price <= 0n) return bad('price_stroops must be a positive integer in base units.');

  let target: URL;
  try {
    target = new URL(upstream ?? '');
  } catch {
    return bad('upstream_url must be an absolute URL.');
  }
  if (target.protocol !== 'https:' && target.hostname !== 'localhost') {
    return bad('upstream_url must use https.');
  }

  const supabase = db();

  await supabase.from('developers').upsert({ address: developer }, { onConflict: 'address' });

  const { data: api, error } = await supabase
    .from('apis')
    .insert({
      developer_address: developer,
      name,
      upstream_url: target.toString(),
      price_stroops: price.toString(),
      payout_address: payout,
      upstream_secret: randomBytes(24).toString('base64url'),
      status: 'pending',
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !api) {
    return Response.json({ error: error?.message ?? 'Could not register.' }, { status: 500 });
  }

  try {
    // Deployed and configured in one transaction, so the splitter never exists in a state
    // where someone else could set the payout addresses.
    const splitter = await deployInstance(env.splitterWasmHash(), [
      arg.address(payout),
      arg.address(env.platformAddress()),
      arg.address(env.usdcSac()),
      arg.u32(env.platformFeeBps()),
    ]);

    await supabase
      .from('apis')
      .update({ splitter_contract_id: splitter, status: 'active' })
      .eq('id', api.id);

    return Response.json(
      {
        id: api.id,
        name,
        paid_url: `${request.nextUrl.origin}/api/pay/${api.id}`,
        price_stroops: price.toString(),
        splitter_contract_id: splitter,
        payout_address: payout,
        fee_bps: env.platformFeeBps(),
      },
      { status: 201 },
    );
  } catch (cause) {
    // The row stays `pending`, so the gateway will not serve it and no payment can be taken
    // for an API with nowhere to send the money.
    return Response.json(
      {
        error: 'Registered, but the payment contract could not be deployed.',
        detail: cause instanceof Error ? cause.message : String(cause),
        id: api.id,
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  const developer = request.nextUrl.searchParams.get('developer');
  if (!developer || !StrKey.isValidEd25519PublicKey(developer)) {
    return bad('developer query parameter must be a Stellar account address.');
  }

  const { data } = await db()
    .from('apis')
    .select('id, name, upstream_url, price_stroops, splitter_contract_id, payout_address, status, created_at')
    .eq('developer_address', developer)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });

  const origin = request.nextUrl.origin;
  return Response.json({
    apis: (data ?? []).map((row) => ({ ...row, paid_url: `${origin}/api/pay/${row.id}` })),
  });
}
