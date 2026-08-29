/**
 * Turning a paid URL into an address an allowance can hold.
 *
 * The allowlist stores splitter contract addresses, because that is what the contract can check
 * — it has no network access and could never resolve a URL. But nobody is handed an address.
 * What a developer gives you is the URL you call, so that is what the page asks for, and this is
 * where the two are reconciled.
 *
 * The step it replaces was a list of every registered API with checkboxes. Registration is open
 * and free, so an attacker could appear in that list looking exactly like everybody else, and
 * presenting it as a menu implied a vetting nobody performs. Resolving a URL the developer gave
 * you puts the trust decision back where it actually happened.
 *
 *   npm run dev        (in another terminal)
 *   npm test
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ORIGIN, archiveApi, registerApi, requireServer } from './helpers.mjs';

const CENT = 100_000n;

const resolve = (url) =>
  fetch(`${ORIGIN}/api/apis/resolve?url=${encodeURIComponent(url)}`);

describe('resolving a paid URL', { timeout: 120_000 }, () => {
  let api;
  let retired;

  before(async () => {
    await requireServer();
    api = await registerApi(CENT, 'https://api.github.com/zen');
    retired = await registerApi(CENT, 'https://api.github.com/zen');
    await archiveApi(retired.id);
  });

  after(async () => {
    if (api) await archiveApi(api.id);
  });

  it('finds the address a payment would go to', async () => {
    const response = await resolve(api.paid_url);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.splitter_contract_id, api.splitter_contract_id);
    assert.equal(body.id, api.id);
    // The name and price are what the owner confirms against. An address alone is unreadable,
    // which is the whole reason the old picker existed.
    assert.ok(body.name);
    assert.equal(BigInt(body.price_stroops), CENT);
  });

  it('accepts the id on its own', async () => {
    // Someone will paste the id rather than the URL. Refusing that would be pedantry.
    const response = await resolve(api.id);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).splitter_contract_id, api.splitter_contract_id);
  });

  it('ignores a query string on the URL', async () => {
    const response = await resolve(`${api.paid_url}?text=hello&size=300`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).id, api.id);
  });

  it('refuses a URL it does not know', async () => {
    const response = await resolve('https://stellar-allowance.vercel.app/api/pay/de305d54-75b4-431b-adb2-eb6b9e546014');
    assert.equal(response.status, 404);
    // Loudly, rather than by quietly allowlisting nothing. An allowance that silently failed to
    // add an API refuses every purchase later with an error about the recipient.
    assert.ok((await response.json()).error);
  });

  it('refuses an API that has been retired', async () => {
    // The gateway will not serve it, so allowlisting it would spend a signature on nothing.
    const response = await resolve(retired.paid_url);
    assert.equal(response.status, 404);
  });

  it('refuses something that is not a URL at all', async () => {
    const response = await resolve('the weather api my friend told me about');
    assert.equal(response.status, 400);
  });
});
