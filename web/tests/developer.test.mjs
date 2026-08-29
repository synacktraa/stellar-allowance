/**
 * The developer surface, which used to be read-only and unauthenticated.
 *
 * A price could be set once and never changed, an upstream URL was fixed at registration, and
 * there was no way to retire an API at all — every one a column the database always had and the
 * interface never offered. Making them editable means they now need to be defended, which is
 * what the signature is for.
 *
 *   npm run dev        (in another terminal)
 *   npm test
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { ORIGIN, archiveApi, prove, registerApi, requireServer } from './helpers.mjs';

const CENT = 100_000n;
const post = (path, body) =>
  fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const patch = (path, body) =>
  fetch(`${ORIGIN}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const handle = () => `t${Math.random().toString(36).slice(2, 10)}`;

describe('a developer with a handle', { timeout: 120_000 }, () => {
  const alice = Keypair.random();
  const mallory = Keypair.random();
  const mine = handle();

  before(requireServer);

  it('reports no handle for a wallet that has never been here', async () => {
    const body = await fetch(`${ORIGIN}/api/developers?address=${alice.publicKey()}`).then((r) => r.json());
    // Not a 404 — arriving for the first time is the normal case, and the page has to tell it
    // apart from something going wrong.
    assert.equal(body.username, null);
  });

  it('will not claim a handle without a signature', async () => {
    const response = await post('/api/developers', { address: alice.publicKey(), username: mine });
    assert.equal(response.status, 401);
  });

  it('claims one with a signature', async () => {
    const response = await post('/api/developers', { ...(await prove(alice)), username: mine });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal((await fetch(`${ORIGIN}/api/developers?address=${alice.publicKey()}`).then((r) => r.json())).username, mine);
  });

  it('refuses a handle somebody else already has', async () => {
    const response = await post('/api/developers', { ...(await prove(mallory)), username: mine });
    assert.equal(response.status, 409);
  });

  it('refuses to rename an address that already has one', async () => {
    // A handle that moved would repoint every "@alice/weather" anyone had written down.
    const response = await post('/api/developers', { ...(await prove(alice)), username: handle() });
    assert.equal(response.status, 409);
  });

  it('refuses a handle that is not a handle', async () => {
    // A fresh wallet, so a rejection can only be about the shape of the handle. Reusing alice
    // here would have got 409 "already @something" and looked like the format check working.
    for (const bad of ['ab', 'has spaces', '-leading', 'a'.repeat(21), '']) {
      const response = await post('/api/developers', {
        ...(await prove(Keypair.random())),
        username: bad,
      });
      assert.equal(response.status, 400, `${JSON.stringify(bad)} was not refused`);
    }
  });

  it('takes the capitals off rather than refusing them', async () => {
    // Handles are case-insensitive, so "Alice" is a typo to fix, not an error to report.
    const shouty = Keypair.random();
    const wanted = handle().toUpperCase();
    const response = await post('/api/developers', { ...(await prove(shouty)), username: wanted });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).username, wanted.toLowerCase());
  });
});

describe('editing an API', { timeout: 4 * 60_000 }, () => {
  const owner = Keypair.random();
  const mallory = Keypair.random();
  let api;

  before(async () => {
    await requireServer();
    api = await registerApi(CENT, 'https://api.github.com/zen', owner.publicKey());
  });

  after(async () => {
    if (api) await archiveApi(api.id);
  });

  it('will not change a price without a signature', async () => {
    const response = await patch(`/api/apis/${api.id}`, {
      address: owner.publicKey(),
      price_stroops: '200000',
    });
    assert.equal(response.status, 401);
  });

  it('changes the price for the developer who owns it', async () => {
    const response = await patch(`/api/apis/${api.id}`, {
      ...(await prove(owner)),
      price_stroops: '200000',
    });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));

    // The gateway quotes the new price from the next request onward.
    const quoted = await fetch(api.paid_url).then((r) => r.json());
    assert.equal(BigInt(quoted.amount), 200_000n);
  });

  it('refuses somebody else holding a perfectly good signature', async () => {
    // Mallory can prove she is Mallory. That is not the question being asked.
    const response = await patch(`/api/apis/${api.id}`, {
      ...(await prove(mallory)),
      price_stroops: '1',
    });
    assert.equal(response.status, 404);
  });

  it('will not touch the payout address', async () => {
    // Fixed in the splitter at deployment. The route offers no way to ask, which is the point:
    // it is why a developer does not have to trust us with their money.
    const response = await patch(`/api/apis/${api.id}`, {
      ...(await prove(owner)),
      payout_address: mallory.publicKey(),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Nothing to change/);
  });

  it('disables it, and the gateway stops selling it', async () => {
    const response = await patch(`/api/apis/${api.id}`, { ...(await prove(owner)), enabled: false });
    assert.equal(response.status, 200);

    assert.equal((await fetch(api.paid_url)).status, 404);
    // And it cannot be newly allowlisted, since nobody should point an allowance at a URL that
    // is not answering.
    const resolved = await fetch(`${ORIGIN}/api/apis/resolve?url=${encodeURIComponent(api.paid_url)}`);
    assert.equal(resolved.status, 404);
  });

  it('leaves a disabled API listed, so its earnings stay reachable', async () => {
    // Filtering these out took the collect button away with the row, while the confirmation
    // promised that anything uncollected stayed collectable. It was true on chain and false
    // everywhere a person could see.
    const { apis } = await fetch(`${ORIGIN}/api/apis?developer=${owner.publicKey()}`).then((r) => r.json());
    const listed = apis.find((row) => row.id === api.id);

    assert.ok(listed, "a disabled API disappeared from its own developer's list");
    assert.equal(listed.status, 'archived');
  });

  it('enables it again, and the gateway sells it once more', async () => {
    const response = await patch(`/api/apis/${api.id}`, { ...(await prove(owner)), enabled: true });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));

    // A switch, not a trapdoor.
    assert.equal((await fetch(api.paid_url)).status, 402);
  });

  it('refuses an enabled flag that is not a boolean', async () => {
    const response = await patch(`/api/apis/${api.id}`, { ...(await prove(owner)), enabled: 'yes' });
    assert.equal(response.status, 400);
  });
});
