import test from 'node:test';
import assert from 'node:assert/strict';
import { pickOffer } from '../lib/x402/offer';

const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const SELLER = 'GA4ND56VAGBNNSAEAKS2KYW6OZTUTOQ6MVLSQEXW4PV35LXUH3VTXJWV';
const url = 'https://xlm-quote-api.vercel.app/api/quote';

const accepts = (over: Record<string, unknown> = {}) => [
  {
    scheme: 'exact',
    network: 'stellar:testnet',
    amount: '100000',
    asset: USDC,
    payTo: SELLER,
    maxTimeoutSeconds: 300,
    ...over,
  },
];

test('an offer on testnet in USDC is taken, and the payout address comes with it', () => {
  const result = pickOffer(url, { accepts: accepts() });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.offer.payTo, SELLER);
  assert.equal(result.ok && result.offer.amount, 100_000n);
  assert.equal(result.ok && result.offer.host, 'xlm-quote-api.vercel.app');
  assert.equal(result.ok && result.offer.path, '/api/quote');
});

test('an offer on another network is not one we can pay', () => {
  const result = pickOffer(url, { accepts: accepts({ network: 'stellar:pubnet' }) });
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /testnet/);
});

test('an offer in another asset is not one we can pay', () => {
  const result = pickOffer(url, { accepts: accepts({ asset: 'CAAA' }) });
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /USDC/);
});

test('a URL that asks for nothing cannot be allowlisted', () => {
  const result = pickOffer(url, { accepts: [] });
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /does not ask for payment/);
});

test('the first payable offer wins when a seller lists several', () => {
  const result = pickOffer(url, {
    accepts: [...accepts({ network: 'stellar:pubnet' }), ...accepts({ amount: '250' })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.offer.amount, 250n);
});
