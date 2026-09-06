import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AllowanceRefused, refusalFrom } from '../dist/index.js';

test('every discriminant gets its rule', () => {
  const expected = {
    101: 'not-set-up',
    102: 'allowlist',
    103: 'malformed',
    104: 'wrong-asset',
    105: 'not-a-transfer',
    106: 'window',
    107: 'stopped',
    108: 'invalid-amount',
    109: 'name-too-long',
  };
  for (const [code, rule] of Object.entries(expected)) {
    const refusal = refusalFrom(`HostError: Error(Contract, #${code})`);
    assert.ok(refusal instanceof AllowanceRefused);
    assert.equal(refusal.code, Number(code));
    assert.equal(refusal.rule, rule);
  }
});

test('#101 is not read as #1', () => {
  assert.equal(refusalFrom('Error(Contract, #101)').code, 101);
  assert.equal(refusalFrom('Error(Contract, #106)').rule, 'window');
});

test('a code this contract does not define is not a refusal', () => {
  // 1 through 13 belong to the Stellar Asset Contract, not to this one.
  assert.equal(refusalFrom('Error(Contract, #10)'), undefined);
  assert.equal(refusalFrom('Error(Auth, InvalidAction)'), undefined);
  assert.equal(refusalFrom('connection refused'), undefined);
});

test('a hash mark somewhere else in the message is not a refusal', () => {
  assert.equal(refusalFrom('Error(Auth, InvalidAction), invocation #106'), undefined);
  assert.equal(refusalFrom('Error(Storage, MissingValue) at entry #101'), undefined);
});

test('carries the host error it was read from', () => {
  const detail = 'HostError: Error(Contract, #107), nonce 8891';
  assert.equal(refusalFrom(detail).detail, detail);
});
