import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFreeIndex } from '../lib/allowance/index';

test('the first index whose derived address is absent is free', () => {
  const addresses = ['CA', 'CB', 'CC', 'CD'];
  assert.equal(pickFreeIndex(addresses, new Set(['CA', 'CB'])), 2);
  assert.equal(pickFreeIndex(addresses, new Set()), 0);
});

test('an archived allowance still occupies its index', () => {
  const addresses = ['CA', 'CB', 'CC'];
  assert.equal(pickFreeIndex(addresses, new Set(['CA'])), 1);
});

test('a full window is an error rather than a wrong answer', () => {
  const addresses = ['CA', 'CB'];
  assert.throws(() => pickFreeIndex(addresses, new Set(addresses)), /no free index in the first 2/);
});
