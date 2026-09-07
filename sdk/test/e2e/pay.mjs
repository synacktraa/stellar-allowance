// Pays the live seller from the allowance that setup.mjs created.
//
//   npm run e2e
//
// Not in CI: it needs funded testnet accounts, a deployed allowance and two live third
// parties. The allowance's own window cap would also exhaust under a per-commit test loop.

import { decodePaymentResponseHeader } from '@x402/core/http';
import { Allowance, AllowanceRefused } from '../../dist/index.js';

const url = process.env.E2E_PAID_URL;
if (!url) throw new Error('E2E_PAID_URL is not set. Run: npm run e2e:setup');

const allowance = new Allowance();
console.log('allowance', allowance.address);
console.log('paying   ', url, '\n');

try {
  const response = await allowance.fetch(url);
  console.log('status', response.status);
  console.log(await response.text());

  const settled = response.headers.get('payment-response');
  if (settled) {
    const receipt = decodePaymentResponseHeader(settled);
    console.log('\nsettled by the facilitator');
    console.log('  success    ', receipt.success);
    console.log('  transaction', receipt.transaction);
    console.log('  payer      ', receipt.payer);
    console.log(`  explorer    https://stellar.expert/explorer/testnet/tx/${receipt.transaction}`);
  }
} catch (error) {
  if (error instanceof AllowanceRefused) {
    console.log('refused by the allowance');
    console.log('  rule  ', error.rule);
    console.log('  code  ', error.code);
    console.log('  detail', error.detail.split('\n')[0]);
    process.exit(1);
  }
  throw error;
}
