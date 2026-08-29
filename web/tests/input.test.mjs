/**
 * A paid API that takes input.
 *
 * Until now the gateway could sell one shape of request: a GET with nothing attached. That is
 * enough to prove money moves, and not enough to sell anything real — an API worth paying for
 * almost always needs to be told what to do.
 *
 * Two things are under test. Query parameters have always been forwarded but were never
 * exercised, and POST did not exist at all.
 *
 *   npm run dev        (in another terminal)
 *   npm test
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  ORIGIN,
  archiveApi,
  deliver,
  payDirect,
  quote,
  registerApi,
  requireServer,
} from './helpers.mjs';

const CENT = 100_000n; // 0.01 USDC
const MINUTES = 120_000;

// Long enough that it could not have travelled in a query string, which is the reason POST
// exists here rather than a stylistic preference.
const LONG = `BEGIN:VCARD
VERSION:3.0
FN:Stellar Allowance
ORG:On-chain spending limits for agents that pay for API calls
URL:https://stellar-allowance.vercel.app
NOTE:${'x'.repeat(400)}
END:VCARD`;

describe('a paid API that takes input', { timeout: 4 * MINUTES }, () => {
  let api;

  before(async () => {
    await requireServer();
    // Our own API this time, not someone else's. It is the thing being sold.
    api = await registerApi(CENT, `${ORIGIN}/api/demo/qr`);
  });

  after(async () => {
    if (api) await archiveApi(api.id);
  });

  it('is not reachable except through the gateway', async () => {
    // Otherwise there is no reason to pay: the endpoint would answer anyone who asked.
    const response = await fetch(`${ORIGIN}/api/demo/qr?text=free`);
    assert.equal(response.status, 401);
  });

  it('passes query parameters through to the API', { timeout: 2 * MINUTES }, async () => {
    const paidUrl = `${api.paid_url}?text=STELLAR`;

    const quoted = await quote(paidUrl);
    const txHash = await payDirect(quoted.recipient, quoted.amount);
    const response = await deliver(paidUrl, { txHash, reference: quoted.reference });
    const body = await response.json();

    assert.equal(response.status, 200);
    // Echoed back, so this proves the parameter arrived rather than merely that something did.
    assert.equal(body.text, 'STELLAR');
    assert.ok(body.svg.startsWith('<svg'), 'should have encoded something');
  });

  it('quotes a POST the same as a GET', { timeout: MINUTES }, async () => {
    const quoted = await quote(api.paid_url, { method: 'POST', body: { text: 'hello' } });

    assert.equal(BigInt(quoted.amount), CENT);
    assert.ok(quoted.reference, 'a POST should be issued a reference like any other request');
    assert.equal(quoted.recipient, api.splitter_contract_id);
  });

  it('delivers a POST, body and all', { timeout: 2 * MINUTES }, async () => {
    const sent = { text: LONG, size: 400, ecc: 'H' };

    // The body goes twice: once to be refused, once to be delivered. That is how 402 works.
    const quoted = await quote(api.paid_url, { method: 'POST', body: sent });
    const txHash = await payDirect(quoted.recipient, quoted.amount);

    const response = await deliver(api.paid_url, {
      txHash,
      reference: quoted.reference,
      method: 'POST',
      body: sent,
    });
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body).slice(0, 200));
    assert.equal(body.text, LONG, 'the whole body should have reached the API');
    assert.equal(body.size, 400);
    assert.equal(body.ecc, 'H');
    assert.ok(body.svg.includes('viewBox'), 'should have encoded the long payload');
  });
});
