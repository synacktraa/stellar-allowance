import type { NextRequest } from 'next/server';
import { db } from '@/lib/supabase';
import { newReference } from '@/lib/reference';
import { verifyPayment } from '@/lib/verify';
import { env } from '@/lib/env';

/**
 * The toll booth.
 *
 * First call: no payment attached, so the request is refused with a price and a reference.
 * Second call: the agent points at a payment with `X-Payment-Tx`, the payment is checked
 * against the chain, and the upstream response is forwarded back.
 *
 * The two calls share no state except through the database, because they are separate HTTP
 * requests and the payment happened on a network this server was not part of.
 */

const CHALLENGE_TTL_SECONDS = 300;

type Api = {
  id: string;
  upstream_url: string;
  price_stroops: string;
  splitter_contract_id: string | null;
  upstream_secret: string;
  status: string;
};

function problem(status: number, title: string, detail: string, extra: Record<string, unknown> = {}) {
  return Response.json(
    { type: `https://stellar-allowance.dev/problems/${title}`, title, status, detail, ...extra },
    { status, headers: { 'content-type': 'application/problem+json; charset=utf-8' } },
  );
}

export async function GET(request: NextRequest, ctx: RouteContext<'/api/pay/[apiId]'>) {
  const { apiId } = await ctx.params;
  const supabase = db();

  const { data: api } = await supabase
    .from('apis')
    .select('id, upstream_url, price_stroops, splitter_contract_id, upstream_secret, status')
    .eq('id', apiId)
    .maybeSingle<Api>();

  // An inactive or unknown API is a 404 either way. Distinguishing them would let anyone
  // enumerate which ids exist.
  if (!api || api.status !== 'active' || !api.splitter_contract_id) {
    return problem(404, 'not-found', 'No such API.');
  }

  const txHash = request.headers.get('x-payment-tx');

  // ---------------------------------------------------------------- unpaid
  if (!txHash) {
    const reference = newReference();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);

    await supabase.from('challenges').insert({
      reference,
      api_id: api.id,
      amount_stroops: api.price_stroops,
      recipient: api.splitter_contract_id,
      expires_at: expiresAt.toISOString(),
    });

    await supabase.from('requests').insert({
      api_id: api.id,
      reference,
      status: 'challenge_sent',
    });

    return Response.json(
      {
        type: 'https://stellar-allowance.dev/problems/payment-required',
        title: 'Payment Required',
        status: 402,
        detail: 'Pay the amount below, then retry this request with X-Payment-Tx set.',
        // Everything an agent needs to construct the payment.
        amount: api.price_stroops,
        asset: env.usdcSac(),
        recipient: api.splitter_contract_id,
        reference,
        network: 'stellar:testnet',
        expires: expiresAt.toISOString(),
      },
      {
        status: 402,
        headers: {
          'content-type': 'application/problem+json; charset=utf-8',
          'cache-control': 'no-store',
          'x-allowance-reference': reference,
          'x-allowance-amount': api.price_stroops,
          'x-allowance-recipient': api.splitter_contract_id,
        },
      },
    );
  }

  // ------------------------------------------------------------------ paid
  const verified = await verifyPayment(txHash, {
    recipient: api.splitter_contract_id,
    minAmountStroops: BigInt(api.price_stroops),
  });

  if (!verified.ok) {
    return problem(402, 'payment-invalid', `Payment could not be verified: ${verified.reason}.`, {
      reason: verified.reason,
    });
  }

  // An allowance carries the reference on-chain, in its event. A direct payer cannot — Soroban
  // transactions have no memo and a SAC transfer has no free field — so it names the reference
  // in the request instead, and gets the weaker guarantee described in migration 0002.
  const reference = verified.payment.reference ?? request.headers.get('x-allowance-reference');
  if (!reference) {
    return problem(402, 'no-reference', 'That payment does not say which request it settles.');
  }

  const { data: challenge } = await supabase
    .from('challenges')
    .select('reference, api_id, expires_at, consumed_tx_hash')
    .eq('reference', reference)
    .maybeSingle<{
      reference: string;
      api_id: string;
      expires_at: string;
      consumed_tx_hash: string | null;
    }>();

  // A payment carrying a reference we never issued, or one issued for a different API, buys
  // nothing here. This is what stops a payment being reused across endpoints.
  if (!challenge || challenge.api_id !== api.id) {
    return problem(402, 'unknown-reference', 'That payment does not reference this request.');
  }

  if (new Date(challenge.expires_at) < new Date()) {
    return problem(402, 'expired', 'The challenge for that payment has expired.');
  }

  // Consume atomically. A select-then-update would let two concurrent requests both pass.
  // Zero rows updated means the challenge was already claimed; a unique-violation error means
  // this transaction has already paid for a different challenge.
  const { data: consumed, error: consumeError } = await supabase
    .from('challenges')
    .update({ consumed_tx_hash: txHash, consumed_at: new Date().toISOString() })
    .eq('reference', reference)
    .is('consumed_tx_hash', null)
    .select('reference');

  if (consumeError || !consumed || consumed.length === 0) {
    await supabase
      .from('requests')
      .update({ status: 'replayed', tx_hash: txHash })
      .eq('reference', reference);

    return problem(409, 'already-used', 'That payment has already been used.');
  }

  await supabase
    .from('requests')
    .update({ status: 'payment_verified', tx_hash: txHash, updated_at: new Date().toISOString() })
    .eq('reference', reference);

  // ------------------------------------------------------------- forwarding
  let upstream: Response;
  try {
    const target = new URL(api.upstream_url);
    // Preserve the caller's query string, minus our own routing parameter.
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'apiId') target.searchParams.set(key, value);
    });

    upstream = await fetch(target, {
      headers: { 'x-allowance-secret': api.upstream_secret },
      // The buyer is waiting; a slow origin should fail rather than hold the payment open.
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    await supabase
      .from('requests')
      .update({ status: 'upstream_failed', updated_at: new Date().toISOString() })
      .eq('reference', reference);

    // The payment stands and the reference records what it bought, which is the information a
    // refund would need. No refund is issued today.
    return problem(502, 'upstream-failed', 'The API did not respond. Your payment was not refunded.', {
      reference,
      tx: txHash,
    });
  }

  const body = await upstream.text();
  const delivered = upstream.ok;

  await supabase
    .from('requests')
    .update({
      status: delivered ? 'forwarded' : 'upstream_failed',
      http_status: upstream.status,
      updated_at: new Date().toISOString(),
    })
    .eq('reference', reference);

  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'x-allowance-reference': reference,
      'x-allowance-tx': txHash,
      'x-allowance-delivered': String(delivered),
    },
  });
}
