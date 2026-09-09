import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS, spentInWindow, sliceOf } from '../lib/dashboard/window';

const empty = () => Array.from({ length: SLOTS }, () => 0n);

test('a window slice is the ledger divided by a twenty-fourth of the width', () => {
  assert.equal(sliceOf(4_578_828, 17_280), 6359);
  // A window narrower than the slice count still gets a ledger per slice.
  assert.equal(sliceOf(100, 10), 100);
});

test('spending inside the newest slice counts in full', () => {
  const slots = empty();
  slots[6352 % SLOTS] = 200_000n;
  assert.equal(spentInWindow({ slots, head: 6352 }, 17_280, 4_578_828), 200_000n);
});

test('a slice that has aged out of the ring no longer counts', () => {
  const slots = empty();
  slots[6352 % SLOTS] = 200_000n;
  // Far enough ahead that every slot is cleared, including the one that held the spend.
  const ledger = (6352 + SLOTS) * 720;
  assert.equal(spentInWindow({ slots, head: 6352 }, 17_280, ledger), 0n);
});

test('slices still inside the window survive the roll', () => {
  const slots = empty();
  slots[6350 % SLOTS] = 10n;
  slots[6352 % SLOTS] = 200_000n;
  // Two slices on: clears 6353 and 6354, touches neither of the two above.
  assert.equal(spentInWindow({ slots, head: 6352 }, 17_280, 6354 * 720), 200_010n);
});

test('an allowance that has never paid has no window entry and has spent nothing', () => {
  assert.equal(spentInWindow(undefined, 17_280, 4_578_828), 0n);
});

test('the roll never runs backwards', () => {
  const slots = empty();
  slots[6352 % SLOTS] = 200_000n;
  // A ledger behind the head cannot happen on chain, and must not clear anything if it does.
  assert.equal(spentInWindow({ slots, head: 6352 }, 17_280, 6340 * 720), 200_000n);
});
