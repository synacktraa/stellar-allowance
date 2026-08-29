/**
 * Records one real run of the demo, for the landing page to replay.
 *
 *   npm run dev            (in another terminal)
 *   npm run record-demo
 *
 * The page used to run this live on every visit. That could not hold: one demo agent and one
 * allowance are shared by everyone, so two visitors at once drive the same Stellar accounts and
 * collide on the sequence number — and every visit spent real USDC that only came back if a
 * flush happened to follow. Neither problem is fixable by adding money.
 *
 * So the page replays a recording instead. That is only honest if the recording is a real run,
 * which is why this script is committed rather than the JSON alone: anyone with testnet funds
 * can re-run it and get their own, and every receipt in the file is a transaction hash that
 * either exists on chain or does not.
 *
 * Writes src/lib/demo-run.json. Costs about 1.4 USDC, most of which flushes back.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'src', 'lib', 'demo-run.json');

const origin = process.env.DEMO_ORIGIN ?? 'http://localhost:3000';
const apiId = process.env.DEMO_API_ID;
const allowanceId = process.env.ALLOWANCE_CONTRACT_ID;
const secret = process.env.DEMO_RECORDER_SECRET;

if (!apiId || !allowanceId) {
  console.error('DEMO_API_ID and ALLOWANCE_CONTRACT_ID must be set. Run `npm run seed-demo` first.');
  process.exit(1);
}

const ATTEMPTS = 7;
const headers = { 'content-type': 'application/json', ...(secret ? { 'x-demo-recorder': secret } : {}) };

const post = (path, body) =>
  fetch(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());

// --- level the two sides, or refuse to record ------------------------------

const prepared = await post('/api/demo/prepare', { apiId, allowanceId });

if (!prepared.ready) {
  console.error(`\nCannot record: ${prepared.error ?? 'the demo could not be reset.'}\n`);
  if (prepared.start) {
    console.error(`  wallet     ${Number(prepared.start.wallet) / 1e7}`);
    console.error(`  allowance  ${Number(prepared.start.allowance) / 1e7}\n`);
  }
  process.exit(1);
}

console.log(`start      ${Number(prepared.start.wallet) / 1e7} USDC on both sides`);

// --- run both columns ------------------------------------------------------
//
// Sequentially, unlike the page, which raced them. A recording has no one waiting on it, and
// two columns at once means two transactions from accounts whose sequence numbers we do not
// want to think about.

async function column(mode) {
  const rows = [];
  for (let n = 1; n <= ATTEMPTS; n += 1) {
    const result = await post('/api/demo/step', { mode, apiId, allowanceId });
    rows.push({
      n,
      delivered: Boolean(result.delivered),
      ...(result.delivered
        ? { amount: String(result.amount), txHash: result.txHash, body: result.body }
        : { reason: result.reason }),
      remaining: String(result.remaining),
    });
    process.stdout.write(result.delivered ? '.' : 'x');
  }
  console.log(`  ${mode}`);
  return rows;
}

const wallet = await column('unprotected');
const allowance = await column('allowance');

// --- the rules that did the refusing ---------------------------------------

const detail = await fetch(`${origin}/api/allowances/${allowanceId}`).then((r) => r.json());

const recording = {
  recordedAt: new Date().toISOString().slice(0, 10),
  network: 'testnet',
  explorer: 'https://stellar.expert/explorer/testnet/tx/{hash}',
  attempts: ATTEMPTS,
  price: '0.10',
  start: {
    wallet: String(Number(prepared.start.wallet) / 1e7),
    allowance: String(Number(prepared.start.allowance) / 1e7),
  },
  rules: detail.rules,
  wallet,
  allowance,
};

await writeFile(out, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');

const paid = (rows) => rows.filter((r) => r.delivered).length;
console.log(`\nwrote src/lib/demo-run.json — ${paid(wallet)}/${ATTEMPTS} against ${paid(allowance)}/${ATTEMPTS}`);
