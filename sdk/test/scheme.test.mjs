import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { ExactAllowanceScheme, createAllowanceSigner } from '../dist/index.js';

const ALLOWANCE = 'CC7C7SNKQ3R4LOMEFKVMJHK62ZAXC3BCHXV6DA6JY2VHIHWKQ6ATBZS6';
const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const SELLER = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

const scheme = () =>
  new ExactAllowanceScheme(createAllowanceSigner(ALLOWANCE, Keypair.random().secret()));

const requirements = (over = {}) => ({
  scheme: 'exact',
  network: 'stellar:testnet',
  payTo: SELLER,
  asset: TOKEN,
  amount: '1000',
  maxTimeoutSeconds: 60,
  extra: { areFeesSponsored: true },
  ...over,
});

test('answers to the exact scheme', () => {
  assert.equal(scheme().scheme, 'exact');
});

test('refuses requirements it cannot pay, before touching the network', async () => {
  const cases = [
    [{ scheme: 'upto' }, /Unsupported scheme/],
    [{ network: 'eip155:8453' }, /Unsupported Stellar network/],
    [{ amount: '-1' }, /positive integer/],
    [{ amount: '1.5' }, /positive integer/],
    [{ amount: 1000 }, /positive integer/],
    [{ payTo: 'not an address' }, /destination address/],
    [{ asset: SELLER }, /asset address/],
    [{ extra: {} }, /areFeesSponsored/],
    [{ extra: { areFeesSponsored: false } }, /areFeesSponsored/],
  ];
  for (const [over, message] of cases) {
    await assert.rejects(() => scheme().createPaymentPayload(2, requirements(over)), message);
  }
});

test('reports the first thing wrong, not the last', async () => {
  await assert.rejects(
    () => scheme().createPaymentPayload(2, requirements({ scheme: 'upto', amount: '-1' })),
    /Unsupported scheme/,
  );
});

test('looks up default assets the way @x402/stellar does', () => {
  assert.equal(typeof scheme().findDefaultAsset, 'function');
});
