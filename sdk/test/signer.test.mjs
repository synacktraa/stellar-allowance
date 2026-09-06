import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, hash } from '@stellar/stellar-sdk';
import { createAllowanceSigner } from '../dist/index.js';

const ALLOWANCE = 'CC7C7SNKQ3R4LOMEFKVMJHK62ZAXC3BCHXV6DA6JY2VHIHWKQ6ATBZS6';

test('signs the payload with the agent key, as 64 raw bytes', async () => {
  const agent = Keypair.random();
  const signer = createAllowanceSigner(ALLOWANCE, agent.secret());
  const payload = hash(Buffer.from('any 32 byte payload'));

  const { signatureScVal } = await signer.sign(payload);

  assert.equal(signatureScVal.switch().name, 'scvBytes');
  assert.equal(signatureScVal.bytes().length, 64);
  // What ed25519_verify checks inside __check_auth, checked the same way here.
  assert.ok(agent.verify(payload, signatureScVal.bytes()));
});

test('a different payload is a different signature', async () => {
  const signer = createAllowanceSigner(ALLOWANCE, Keypair.random().secret());
  const first = await signer.sign(hash(Buffer.from('one')));
  const second = await signer.sign(hash(Buffer.from('two')));
  assert.notDeepEqual(first.signatureScVal.bytes(), second.signatureScVal.bytes());
});

test('the address is the allowance, not the agent', () => {
  const agent = Keypair.random();
  assert.equal(createAllowanceSigner(ALLOWANCE, agent.secret()).address, ALLOWANCE);
});

test('refuses anything that is not an allowance address', () => {
  const agent = Keypair.random();
  assert.throws(
    () => createAllowanceSigner(agent.publicKey(), agent.secret()),
    /contract address/,
  );
});

test('refuses a key it cannot sign with', () => {
  assert.throws(() => createAllowanceSigner(ALLOWANCE, 'not a secret'));
});
