/**
 * Delivering before the ledger closes.
 *
 * A purchase takes about seven seconds and roughly five of them are spent waiting for Stellar to
 * close a ledger. But the allowance's rules run during *simulation*, not at apply time — by the
 * time a transaction is prepared, the per-call cap, the window and the allowlist have all been
 * checked, and a refusal is already known.
 *
 * So the agent hands over a signed, simulated transaction rather than a hash of a settled one.
 * The gateway checks it for itself, submits it, and answers on the network's acceptance rather
 * than the ledger's.
 *
 * These tests use the demo API and the demo allowance, because the allowance path is the only
 * one that can carry a reference on chain, and that allowance is the one whose owner key is
 * available here.
 *
 *   npm run dev        (in another terminal)
 *   npm test
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  ORIGIN,
  db,
  deliverEnvelope,
  landed,
  quote,
  requireServer,
  signedSpend,
} from './helpers.mjs';

const MINUTES = 60_000;

const apiId = process.env.DEMO_API_ID;
const allowanceId = process.env.ALLOWANCE_CONTRACT_ID;
const paidUrl = `${ORIGIN}/api/pay/${apiId}`;

/** Allowlisted on the demo allowance, but belongs to a different API — so it simulates and
 *  still must not buy anything here. */
const OTHER_SPLITTER = 'CCUP6YO3B2XQILSNAZCO44PV2R5SIWTCECJSL4NMZ2UTV5LY5CB2C42X';

const optimistic = (on) => db().from('apis').update({ optimistic: on }).eq('id', apiId);

describe('paying with a transaction that has not landed yet', { timeout: 6 * MINUTES }, () => {
  let splitter;

  before(async () => {
    await requireServer();
    assert.ok(apiId && allowanceId, 'DEMO_API_ID and ALLOWANCE_CONTRACT_ID must be set');
    const { data } = await db().from('apis').select('splitter_contract_id').eq('id', apiId).single();
    splitter = data.splitter_contract_id;
  });

  beforeEach(async () => {
    await optimistic(true);
  });

  after(async () => {
    // The developer's switch, and it stays where the developer left it.
    await optimistic(false);
  });

  it('answers before the transaction reaches a ledger', { timeout: 2 * MINUTES }, async () => {
    // The demo API encodes a QR, so it needs something to encode. A delivery that reached the
    // upstream and came back with its complaint would otherwise read as a gateway failure.
    const withInput = `${paidUrl}?text=paid-before-it-settled`;
    const quoted = await quote(withInput);
    const envelope = await signedSpend({
      allowanceId,
      recipient: splitter,
      amountStroops: quoted.amount,
      reference: quoted.reference,
    });

    const started = Date.now();
    const response = await deliverEnvelope(withInput, { envelope });
    const elapsed = Date.now() - started;
    const body = await response.text();

    assert.equal(response.status, 200, body.slice(0, 200));
    assert.ok(body.length > 0, 'a 200 with no body is not a delivery');
    assert.equal(response.headers.get('x-allowance-settlement'), 'optimistic');

    const hash = response.headers.get('x-allowance-tx');
    assert.match(hash ?? '', /^[0-9a-f]{64}$/, 'the payment being made should be named');

    // A ledger closes about every five seconds, and the confirmed path has to wait for one and
    // *then* make this call. Coming in under a single ledger close is therefore a bound on
    // "did not wait", rather than a performance target — the header above is what states the
    // mode, and this is what would catch it quietly going back to waiting.
    assert.ok(elapsed < 5000, `delivered in ${elapsed}ms — that is a ledger's wait or worse`);

    // Optimism has to be warranted, not merely fast. This is the half that makes the trade
    // acceptable: the payment really does land, and the developer really does get paid.
    assert.equal(await landed(hash), 'SUCCESS', 'delivered, but the payment never landed');
  });

  it('refuses a payment made out to somebody else', { timeout: MINUTES }, async () => {
    const quoted = await quote(paidUrl);
    // Allowlisted, so the allowance permits it and simulation passes. It simply is not this API.
    const envelope = await signedSpend({
      allowanceId,
      recipient: OTHER_SPLITTER,
      amountStroops: quoted.amount,
      reference: quoted.reference,
      prepare: false,
    });

    const response = await deliverEnvelope(paidUrl, { envelope });
    const body = await response.json();
    assert.equal(response.status, 402);
    // Named, because a bare 402 is also what an unpaid request gets — which would let this pass
    // against a gateway that ignored the envelope entirely.
    assert.equal(body.title, 'wrong-recipient');
  });

  it('refuses a payment for less than the quote', { timeout: MINUTES }, async () => {
    const quoted = await quote(paidUrl);
    const envelope = await signedSpend({
      allowanceId,
      recipient: splitter,
      amountStroops: BigInt(quoted.amount) / 2n,
      reference: quoted.reference,
      prepare: false,
    });

    const response = await deliverEnvelope(paidUrl, { envelope });
    assert.equal(response.status, 402);
    assert.equal((await response.json()).title, 'underpaid');
  });

  it('refuses a payment that names a different request', { timeout: MINUTES }, async () => {
    await quote(paidUrl);
    const envelope = await signedSpend({
      allowanceId,
      recipient: splitter,
      amountStroops: '1000000',
      reference: 'not_a_reference_we_issued',
      prepare: false,
    });

    const response = await deliverEnvelope(paidUrl, { envelope });
    assert.equal(response.status, 402);
    assert.equal((await response.json()).title, 'unknown-reference');
  });

  it('refuses entirely when the developer has not opted in', { timeout: MINUTES }, async () => {
    // It is the developer who serves a free call if this goes wrong, so it is the developer's
    // switch — and off is the default.
    await optimistic(false);

    const quoted = await quote(paidUrl);
    const envelope = await signedSpend({
      allowanceId,
      recipient: splitter,
      amountStroops: quoted.amount,
      reference: quoted.reference,
      prepare: false,
    });

    const response = await deliverEnvelope(paidUrl, { envelope });
    assert.equal(response.status, 402);
    assert.equal((await response.json()).title, 'settlement-required');
  });
});
