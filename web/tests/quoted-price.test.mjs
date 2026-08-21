/**
 * A quote is a promise about a price.
 *
 * The gateway issues a 402 naming an amount, the agent pays that amount, and comes back. In
 * between, the only thing that can change is the API's row — so the question these tests ask is
 * which number the second call is measured against: the one that was quoted, or the one that is
 * current.
 *
 *   npm run dev        (in another terminal)
 *   npm test
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  archiveApi,
  db,
  deliver,
  payDirect,
  quote,
  registerApi,
  requireServer,
  setPrice,
} from './helpers.mjs';

const CENT = 100_000n; // 0.01 USDC, in base units
const MINUTES = 120_000; // chain work, so generous — but bounded, so a hang fails

describe('the price a quote named', { timeout: 4 * MINUTES }, () => {
  let api;

  before(async () => {
    await requireServer();
    api = await registerApi(CENT);
  });

  after(async () => {
    if (api) await archiveApi(api.id);
  });

  it('is written down when the quote is issued', { timeout: MINUTES }, async () => {
    const quoted = await quote(api.paid_url);

    const { data: challenge } = await db()
      .from('challenges')
      .select('amount_stroops')
      .eq('reference', quoted.reference)
      .maybeSingle();

    assert.ok(challenge, 'the 402 should have recorded a challenge');
    assert.equal(
      BigInt(challenge.amount_stroops),
      BigInt(quoted.amount),
      'the stored amount should be the amount the agent was told to pay',
    );
  });

  it('still holds after the API puts its price up', { timeout: 2 * MINUTES }, async () => {
    // The agent asks, and is told a cent.
    const quoted = await quote(api.paid_url);
    assert.equal(BigInt(quoted.amount), CENT);

    // Between the quote and the payment, the seller doubles the price. Nothing warns the agent:
    // it is already holding a 402 that says one cent.
    await setPrice(api.id, CENT * 2n);

    // So it pays a cent. This is real money moving to the splitter — irreversible from here.
    const txHash = await payDirect(quoted.recipient, quoted.amount);

    const response = await deliver(api.paid_url, { txHash, reference: quoted.reference });
    const body = await response.text();

    assert.equal(
      response.status,
      200,
      `paid the quoted price and got ${response.status}: ${body.slice(0, 200)}`,
    );
    assert.ok(body.length > 0, 'a 200 with no body is not a delivery');
    assert.equal(response.headers.get('x-allowance-delivered'), 'true');
  });

  it('is still the bar a payment has to clear', { timeout: 2 * MINUTES }, async () => {
    // The other direction, and the reason the fix is not simply "accept anything". Half the
    // quoted price buys nothing, and the price has not moved.
    await setPrice(api.id, CENT);
    const quoted = await quote(api.paid_url);

    const txHash = await payDirect(quoted.recipient, CENT / 2n);
    const response = await deliver(api.paid_url, { txHash, reference: quoted.reference });
    const body = await response.json();

    assert.equal(response.status, 402, 'an underpayment should not be delivered');
    // Named, so that a 402 arriving for some unrelated reason cannot pass for this one.
    assert.equal(body.title, 'underpaid');
    assert.equal(BigInt(body.quoted), CENT);
    assert.equal(BigInt(body.paid), CENT / 2n);

    // And the challenge stays open, so the underpayment did not also burn the reference.
    const { data: challenge } = await db()
      .from('challenges')
      .select('consumed_tx_hash')
      .eq('reference', quoted.reference)
      .maybeSingle();

    assert.equal(challenge?.consumed_tx_hash, null, 'a refused delivery should consume nothing');
  });
});
