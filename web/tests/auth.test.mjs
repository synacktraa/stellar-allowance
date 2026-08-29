/**
 * Proving an address is yours.
 *
 * There is no account and no password. A developer has a Stellar keypair, so the proof is a
 * signature over a challenge transaction the server built — the SEP-10 shape, with sequence
 * number zero so the network could never accept it however it is signed.
 *
 * That is testable end to end here, because a keypair signs it exactly the way a wallet does.
 * An earlier attempt asked the wallet to sign a readable *message* instead, and could not be
 * tested at all: Freighter hands the text to its extension as a blob, and forty-eight
 * reconstructions of what it signed all failed to verify.
 *
 *   npm run dev        (in another terminal)
 *   npm test
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { ORIGIN, db, prove, requireServer } from './helpers.mjs';

const challenge = (address) =>
  fetch(`${ORIGIN}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });

const verify = (body) =>
  fetch(`${ORIGIN}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

describe('proving an address is yours', { timeout: 60_000 }, () => {
  const developer = Keypair.random();
  const someoneElse = Keypair.random();

  before(requireServer);

  it('issues a transaction the network could never accept', async () => {
    const response = await challenge(developer.publicKey());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.nonce);

    const tx = TransactionBuilder.fromXDR(body.transaction, body.network_passphrase);
    // Sequence zero is the whole safety argument: a real transaction uses the account's next
    // sequence number, and zero never is one. So signing this can cost nobody anything.
    assert.equal(tx.sequence, '0');
    assert.equal(tx.source, developer.publicKey());
    assert.equal(tx.operations.length, 1);
    assert.equal(tx.operations[0].type, 'manageData');
    assert.equal(tx.operations[0].name, 'stellar-allowance auth');
  });

  it('refuses something that is not an address', async () => {
    assert.equal((await challenge('alice')).status, 400);
  });

  it('accepts a signature from the address itself', async () => {
    const proved = await verify(await prove(developer));
    assert.equal(proved.ok, true, proved.reason);
  });

  it('refuses a signature from a different key', async () => {
    const { nonce, transaction, network_passphrase } = await challenge(developer.publicKey()).then((r) => r.json());
    const tx = TransactionBuilder.fromXDR(transaction, network_passphrase);
    // Holding the address is not the same as holding the key.
    tx.sign(someoneElse);

    const proved = await verify({ address: developer.publicKey(), nonce, signed: tx.toXDR() });
    assert.equal(proved.ok, false);
    assert.equal(proved.reason, 'bad_signature');
  });

  it('refuses a different transaction, however well signed', async () => {
    const { nonce, transaction, network_passphrase } = await challenge(developer.publicKey()).then((r) => r.json());
    const original = TransactionBuilder.fromXDR(transaction, network_passphrase);

    // Perfectly valid, perfectly signed, and not what we asked for.
    const swapped = TransactionBuilder.cloneFrom(original)
      .clearOperations()
      .addOperation(Operation.manageData({ name: 'something else', value: 'x', source: developer.publicKey() }))
      .build();
    swapped.sign(developer);

    const proved = await verify({ address: developer.publicKey(), nonce, signed: swapped.toXDR() });
    assert.equal(proved.ok, false);
    assert.equal(proved.reason, 'not_the_challenge');
  });

  it('refuses a nonce that has already been used', async () => {
    const proof = await prove(developer);
    assert.equal((await verify(proof)).ok, true);

    // Replaying a captured signature buys nothing.
    const again = await verify(proof);
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'already_used');
  });

  it('burns the nonce even when the signature was wrong', async () => {
    const { nonce, transaction, network_passphrase } = await challenge(developer.publicKey()).then((r) => r.json());
    const wrong = TransactionBuilder.fromXDR(transaction, network_passphrase);
    wrong.sign(someoneElse);
    await verify({ address: developer.publicKey(), nonce, signed: wrong.toXDR() });

    // Otherwise a nonce survives a failure and can be guessed against for five minutes.
    const right = TransactionBuilder.fromXDR(transaction, network_passphrase);
    right.sign(developer);
    const retry = await verify({ address: developer.publicKey(), nonce, signed: right.toXDR() });

    assert.equal(retry.ok, false);
    assert.equal(retry.reason, 'already_used');
  });

  it('refuses a nonce that has expired', async () => {
    const proof = await prove(developer);
    await db()
      .from('auth_challenges')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('nonce', proof.nonce);

    const proved = await verify(proof);
    assert.equal(proved.ok, false);
    assert.equal(proved.reason, 'expired');
  });

  it('refuses a nonce issued for somebody else', async () => {
    const theirs = await prove(someoneElse);
    const proved = await verify({ ...theirs, address: developer.publicKey() });
    assert.equal(proved.ok, false);
    assert.equal(proved.reason, 'wrong_address');
  });
});
