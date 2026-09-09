import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, page, PAGE_SIZE } from '../lib/dashboard/summary';

const ID = 'CD5DYH7TXU6PXD7EOLKRNOX2J3SQT3H5BKJG7QGUBW3LXWEX7IEPKXGZ';
const OWNER = 'GBFL6ZCLIKZDWO2QNWJX4MPE3GHFRHVN6LXZG2DELS2JQQM4NYD4IXFO';
const SELLER = 'GA4ND56VAGBNNSAEAKS2KYW6OZTUTOQ6MVLSQEXW4PV35LXUH3VTXJWV';

// What one instance entry decodes to, taken from a live allowance on testnet.
const storage = () => ({
  Name: 'Demo agent',
  Owner: OWNER,
  Token: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  AgentKey: new Uint8Array(32),
  Rules: { allowlist: [SELLER], window_cap: 250_000n, window_ledgers: 17_280 },
});

test('an instance entry becomes a row the table can render', () => {
  const row = summarize(ID, 3, storage());
  assert.equal(row.id, ID);
  assert.equal(row.index, 3);
  assert.equal(row.name, 'Demo agent');
  assert.equal(row.cap, 250_000n);
  assert.equal(row.windowLedgers, 17_280);
  assert.deepEqual(row.allowlist, [SELLER]);
  assert.equal(row.enabled, true);
});

test('the disabled flag is absent until an owner pauses, and false once they resume', () => {
  assert.equal(summarize(ID, 0, { ...storage(), Disabled: true }).enabled, false);
  assert.equal(summarize(ID, 0, { ...storage(), Disabled: false }).enabled, true);
});

test('a window in ledgers is reported in hours, because that is what the owner set', () => {
  assert.equal(summarize(ID, 0, storage()).windowHours, 24);
  const hourly = { ...storage(), Rules: { ...storage().Rules, window_ledgers: 720 } };
  assert.equal(summarize(ID, 0, hourly).windowHours, 1);
});

test('pages are fifteen rows, and the last one is short', () => {
  const rows = Array.from({ length: 37 }, (_, i) => i);
  assert.equal(PAGE_SIZE, 15);
  assert.deepEqual(page(rows, 1).slice(0, 2), [0, 1]);
  assert.equal(page(rows, 1).length, 15);
  assert.equal(page(rows, 3).length, 7);
  assert.deepEqual(page(rows, 3), [30, 31, 32, 33, 34, 35, 36]);
});

test('a page beyond the end is empty rather than an error', () => {
  assert.deepEqual(page([1, 2, 3], 9), []);
});
