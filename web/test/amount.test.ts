import test from 'node:test';
import assert from 'node:assert/strict';
import { toBase, usdc } from '../lib/demo/params';

test('a typed amount becomes the integer the contract counts in', () => {
  assert.equal(toBase('1'), 10_000_000n);
  assert.equal(toBase('0.25'), 2_500_000n);
  assert.equal(toBase('0.0000001'), 1n);
  assert.equal(toBase(' 12.5 '), 125_000_000n);
});

test('an amount finer than USDC can hold is refused rather than rounded', () => {
  assert.throws(() => toBase('0.00000001'), /7 decimals/);
});

test('anything that is not digits and a point is refused', () => {
  assert.throws(() => toBase('1e5'), /not an amount/);
  assert.throws(() => toBase('-1'), /not an amount/);
  assert.throws(() => toBase(''), /not an amount/);
});

test('the two directions agree', () => {
  assert.equal(usdc(toBase('0.250')), '0.250');
});
