/**
 * Proving an address is yours.
 *
 * There is no account and no password. A developer has a Stellar keypair, so the proof is a
 * signature over a nonce the server issued — which means the whole thing can be exercised here
 * with a keypair, exactly as a wallet would do it.
 *
 * What cannot be tested here is Freighter. The browser half asks the extension to sign, and how
 * it encodes what comes back is the one seam these tests do not cover.
 *
 *   npm run dev        (in another terminal)
 *   npm test
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { ORIGIN, db, requireServer } from './helpers.mjs';

const challenge = (address) =>
  fetch(`${ORIGIN}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });

/** Signs the exact text the server says it will rebuild, the way a wallet would. */
const sign = (keypair, message) => keypair.sign(Buffer.from(message, 'utf8')).toString('base64');

describe('proving an address is yours', { timeout: 60_000 }, () => {
  const developer = Keypair.random();
  const someoneElse = Keypair.random();

  before(requireServer);

  it('issues a nonce, and says what will be signed', async () => {
    const response = await challenge(developer.publicKey());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.nonce);
    // The wallet prompt has to be readable. Teaching people to approve noise is its own risk.
    assert.match(body.message, /Stellar Allowance/);
    assert.match(body.message, new RegExp(developer.publicKey()));
    assert.match(body.message, new RegExp(body.nonce.replace(/[-_]/g, '.')));
    assert.match(body.message, /moves no money/);
  });

  it('refuses something that is not an address', async () => {
    assert.equal((await challenge('alice')).status, 400);
  });

  it('accepts a signature from the address itself', async () => {
    const { nonce, message } = await challenge(developer.publicKey()).then((r) => r.json());
    const proved = await proof({
      address: developer.publicKey(),
      nonce,
      signature: sign(developer, message),
    });
    assert.equal(proved.ok, true, proved.reason);
  });

  it('refuses a signature from a different key', async () => {
    const { nonce, message } = await challenge(developer.publicKey()).then((r) => r.json());
    // The whole point: holding the address is not the same as holding the key.
    const proved = await proof({
      address: developer.publicKey(),
      nonce,
      signature: sign(someoneElse, message),
    });
    assert.equal(proved.ok, false);
    assert.equal(proved.reason, 'bad_signature');
  });

  it('refuses a nonce that has already been used', async () => {
    const { nonce, message } = await challenge(developer.publicKey()).then((r) => r.json());
    const signature = sign(developer, message);

    assert.equal((await proof({ address: developer.publicKey(), nonce, signature })).ok, true);
    // Replaying a captured signature buys nothing.
    const again = await proof({ address: developer.publicKey(), nonce, signature });
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'already_used');
  });

  it('burns the nonce even when the signature was wrong', async () => {
    const { nonce, message } = await challenge(developer.publicKey()).then((r) => r.json());
    await proof({ address: developer.publicKey(), nonce, signature: sign(someoneElse, message) });

    // Otherwise a nonce survives a failed attempt and can be guessed against for five minutes.
    const retry = await proof({
      address: developer.publicKey(),
      nonce,
      signature: sign(developer, message),
    });
    assert.equal(retry.ok, false);
    assert.equal(retry.reason, 'already_used');
  });

  it('refuses a nonce that has expired', async () => {
    const { nonce, message } = await challenge(developer.publicKey()).then((r) => r.json());
    await db()
      .from('auth_challenges')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('nonce', nonce);

    const proved = await proof({
      address: developer.publicKey(),
      nonce,
      signature: sign(developer, message),
    });
    assert.equal(proved.ok, false);
    assert.equal(proved.reason, 'expired');
  });

  it('refuses a nonce issued for somebody else', async () => {
    const { nonce } = await challenge(someoneElse.publicKey()).then((r) => r.json());
    const proved = await proof({
      address: developer.publicKey(),
      nonce,
      signature: sign(developer, 'anything'),
    });
    assert.equal(proved.ok, false);
    assert.equal(proved.reason, 'wrong_address');
  });
});

/** Exercises verifyProof through a route, so the test covers what a caller actually reaches. */
async function proof(body) {
  const response = await fetch(`${ORIGIN}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}
