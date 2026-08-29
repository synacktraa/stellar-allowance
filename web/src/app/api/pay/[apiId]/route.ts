import type { NextRequest } from 'next/server';
import { after } from 'next/server';
import { db } from '@/lib/supabase';
import { readSpend, type Spend } from '@/lib/envelope';
import { isDemoted, recordSettlement, simulateAndSubmit } from '@/lib/settle';
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
 *
 * GET and POST are the same transaction with a different envelope, so both run through
 * `handle`. A POST sends its body twice — once to be refused, once to be delivered — which is
 * inherent to 402 rather than a quirk here: the first call cannot be served, so whatever it
 * carried has to come again with the payment.
 *
 * An API may also opt into answering before the ledger closes. Then the agent sends the signed
 * transaction itself in `X-Payment-Envelope` rather than a hash, and the gateway simulates it,
 * submits it, and delivers on the network's acceptance. That is about five seconds faster and
 * costs the developer a free call on the rare transaction that reverts after a clean simulation,
 * which is why it is off unless they turn it on.
 *
 * An API may also opt into answering before the ledger closes. Then the agent sends the signed
 * transaction itself in `X-Payment-Envelope` rather than a hash, and the gateway simulates it,
 * submits it, and delivers on the network's acceptance. That is about five seconds faster, and
 * costs the developer a free call on the rare transaction that reverts after a clean simulation
 * — which is why it is off unless they turn it on.
 *
 * The quote is deliberately *not* bound to the body. The price is per call, not per byte, so a
 * quote taken for one body and spent on another costs the developer nothing. That changes the
 * day pricing is metered, and then the body's hash belongs in the challenge.
 */

// The response goes out in about two seconds, but `after` keeps running until the ledger takes a
// position on the payment — and it only gets the route's budget to do it in.
export const maxDuration = 60;

const CHALLENGE_TTL_SECONDS = 300;

// Far more than a request to a paid API should ever need, and small enough that nobody can
// make the gateway hold a large buffer for the price of an unpaid request.
const MAX_BODY_BYTES = 64 * 1024;

type Api = {
  id: string;
  upstream_url: string;
  price_stroops: string;
  splitter_contract_id: string | null;
  upstream_secret: string;
  status: string;
  optimistic: boolean;
};

function problem(status: number, title: string, detail: string, extra: Record<string, unknown> = {}) {
  return Response.json(
    { type: `https://stellar-allowance.dev/problems/${title}`, title, status, detail, ...extra },
    { status, headers: { 'content-type': 'application/problem+json; charset=utf-8' } },
  );
}

async function handle(request: NextRequest, apiId: string, method: 'GET' | 'POST') {
  // Read once, before anything else can consume the stream. An unpaid POST is refused without
  // its body ever being forwarded, but it still has to be measured.
  let payload: string | null = null;
  if (method === 'POST') {
    payload = await request.text();
    if (payload.length > MAX_BODY_BYTES) {
      return problem(413, 'too-large', `Body is larger than ${MAX_BODY_BYTES} bytes.`);
    }
  }

  const supabase = db();

  const { data: api } = await supabase
    .from('apis')
    .select(
      'id, upstream_url, price_stroops, splitter_contract_id, upstream_secret, status, optimistic',
    )
    .eq('id', apiId)
    .maybeSingle<Api>();

  // An inactive or unknown API is a 404 either way. Distinguishing them would let anyone
  // enumerate which ids exist.
  if (!api || api.status !== 'active' || !api.splitter_contract_id) {
    return problem(404, 'not-found', 'No such API.');
  }

  const txHash = request.headers.get('x-payment-tx');
  const envelope = request.headers.get('x-payment-envelope');

  // ---------------------------------------------------------------- unpaid
  if (!txHash && !envelope) {
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
        // Advertised rather than assumed. An agent that does not understand this keeps paying
        // and retrying with a hash, which works exactly as it did before.
        settlement: api.optimistic ? ['confirmed', 'optimistic'] : ['confirmed'],
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
  //
  // Two shapes of payment arrive here. A hash names something that already happened and can be
  // read back off the chain. An envelope is a signed transaction that has not happened yet, and
  // everything about it has to be read out of the bytes the sender chose. Both end up with the
  // same three facts: which request this settles, how much it pays, and what to consume.
  let reference: string | null;
  let paidStroops: bigint;
  let spend: Spend | null;

  if (envelope) {
    // Checked before anything is parsed: it is the developer who serves a free call when this
    // goes wrong, so an API that has not asked for it never reaches the rest of this.
    if (!api.optimistic) {
      return problem(
        402,
        'settlement-required',
        'This API delivers on settlement. Submit the payment yourself, then retry with X-Payment-Tx.',
      );
    }

    const read = readSpend(envelope);
    if (!read.ok) {
      return problem(400, 'bad-envelope', `That envelope is not a payment: ${read.reason}.`, {
        reason: read.reason,
      });
    }

    // Whose splitter it pays, decided by us rather than by whoever built the transaction. An
    // allowlisted address belonging to a different API would otherwise buy a call here.
    if (read.spend.to !== api.splitter_contract_id) {
      return problem(402, 'wrong-recipient', 'That payment is made out to a different API.');
    }

    spend = read.spend;
    reference = read.spend.reference;
    paidStroops = read.spend.amountStroops;
  } else {
    // Only that money reached the splitter, and which request it names. Whether it is *enough*
    // is settled further down, against the challenge — not against whatever the price says now.
    const verified = await verifyPayment(txHash!, { recipient: api.splitter_contract_id });

    if (!verified.ok) {
      return problem(402, 'payment-invalid', `Payment could not be verified: ${verified.reason}.`, {
        reason: verified.reason,
      });
    }

    // An allowance carries the reference on-chain, in its event. A direct payer cannot — Soroban
    // transactions have no memo and a SAC transfer has no free field — so it names the reference
    // in the request instead, and gets the weaker guarantee described in migration 0002.
    reference = verified.payment.reference ?? request.headers.get('x-allowance-reference');
    spend = null;
    paidStroops = verified.payment.amountStroops;
  }

  if (!reference) {
    return problem(402, 'no-reference', 'That payment does not say which request it settles.');
  }

  const { data: challenge } = await supabase
    .from('challenges')
    .select('reference, api_id, amount_stroops, expires_at, consumed_tx_hash')
    .eq('reference', reference)
    .maybeSingle<{
      reference: string;
      api_id: string;
      amount_stroops: string;
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

  // The price the 402 named, not the price the API charges now.
  //
  // The agent was told an amount and paid it. If the developer moved the price in between, the
  // agent has no way to know and no way to take the money back — it is already in the splitter.
  // Measuring against the current price would mean keeping a payment and refusing what it
  // bought. A quote holds until `expires_at`; that is what a quote is.
  const owed = BigInt(challenge.amount_stroops);
  if (paidStroops < owed) {
    return problem(402, 'underpaid', 'That payment is less than the amount this request was quoted.', {
      quoted: owed.toString(),
      paid: paidStroops.toString(),
      // Unconsumed, so the reference is still good until it expires.
      reference,
    });
  }

  // An agent whose recent optimism proved misplaced waits for the ledger like everybody did
  // before. It still buys — this is a demotion, not a ban, and it lifts itself.
  if (spend && (await isDemoted(spend.agent))) {
    return problem(
      402,
      'settlement-required',
      'A recent payment from this agent reverted after it had been delivered, so this one waits ' +
        'for settlement. Submit it yourself and retry with X-Payment-Tx.',
    );
  }

  // Simulated by us rather than taken on the sender's word, then submitted. `PENDING` is the
  // network vouching for the signature, the sequence number and the fee — none of which
  // simulation looks at, and all of which could otherwise turn a delivery into a gift.
  let paymentHash: string;
  if (spend) {
    const submitted = await simulateAndSubmit(spend.transaction);
    if (!submitted.ok) {
      return submitted.reason === 'refused_by_the_allowance'
        ? problem(402, 'refused', `The allowance refused it: ${submitted.detail}.`, {
            rule: submitted.detail,
          })
        : problem(502, 'not-submitted', `The network would not take it: ${submitted.detail}.`);
    }
    paymentHash = submitted.hash;
  } else {
    paymentHash = txHash!;
  }

  // Consume atomically. A select-then-update would let two concurrent requests both pass.
  // Zero rows updated means the challenge was already claimed; a unique-violation error means
  // this transaction has already paid for a different challenge.
  const { data: consumed, error: consumeError } = await supabase
    .from('challenges')
    .update({ consumed_tx_hash: paymentHash, consumed_at: new Date().toISOString() })
    .eq('reference', reference)
    .is('consumed_tx_hash', null)
    .select('reference');

  if (consumeError || !consumed || consumed.length === 0) {
    await supabase
      .from('requests')
      .update({ status: 'replayed', tx_hash: paymentHash })
      .eq('reference', reference);

    return problem(409, 'already-used', 'That payment has already been used.');
  }

  await supabase
    .from('requests')
    .update({
      status: 'payment_verified',
      tx_hash: paymentHash,
      optimistic: Boolean(spend),
      updated_at: new Date().toISOString(),
    })
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
      method,
      headers: {
        'x-allowance-secret': api.upstream_secret,
        // Carried through so the API sees what the buyer actually sent, not our guess at it.
        ...(payload === null
          ? {}
          : { 'content-type': request.headers.get('content-type') ?? 'application/json' }),
      },
      body: payload ?? undefined,
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
      tx: paymentHash,
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

  // The answer is going out before the ledger has decided. Recording what it decides is the only
  // way anybody — the developer especially — can see how often that optimism is misplaced.
  if (spend) {
    const { agent } = spend;
    after(() => recordSettlement(paymentHash, reference, agent));
  }

  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'x-allowance-reference': reference,
      'x-allowance-tx': paymentHash,
      'x-allowance-delivered': String(delivered),
      // Says which promise was made: the ledger has taken this, or the network has agreed to try.
      'x-allowance-settlement': spend ? 'optimistic' : 'confirmed',
    },
  });
}

export async function GET(request: NextRequest, ctx: RouteContext<'/api/pay/[apiId]'>) {
  const { apiId } = await ctx.params;
  return handle(request, apiId, 'GET');
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/pay/[apiId]'>) {
  const { apiId } = await ctx.params;
  return handle(request, apiId, 'POST');
}
