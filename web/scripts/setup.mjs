/**
 * Creates every account this project needs, and writes them into .env.local.
 *
 *   npm run setup
 *
 * Four accounts, because the demo has to show two different things happening to two different
 * agents:
 *
 *   platform  deploys allowances and splitters and pays their fees
 *   owner     owns the demo allowance; the only account that can fund or change it
 *   demo      the agent with an allowance — deliberately given no USDC trustline
 *   wallet    the agent holding its own USDC, which is what an agent looks like today
 *
 * The `wallet` agent gets a USDC trustline and the other two Gs do too; the demo agent never
 * gets one, which is not an oversight but the point — it cannot hold the asset it spends.
 *
 * Safe to re-run. Existing values in .env.local are kept, so this fills gaps rather than
 * replacing accounts you have already funded.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env.local');

const HORIZON = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);

const horizon = new Horizon.Server(HORIZON);

// --- .env.local, as an editable map ---------------------------------------

let raw = '';
try {
  raw = await readFile(envPath, 'utf8');
} catch {
  raw = await readFile(join(here, '..', '.env.example'), 'utf8');
  console.log('starting from .env.example\n');
}

/** Replaces a key in place if present, appends it otherwise — comments survive either way. */
function set(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

function get(text, key) {
  return text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() || '';
}

// --- account creation -----------------------------------------------------

async function fund(publicKey) {
  const response = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!response.ok && response.status !== 400) {
    throw new Error(`friendbot refused ${publicKey}: ${response.status}`);
  }
}

async function addTrustline(keypair) {
  const account = await horizon.loadAccount(keypair.publicKey());
  const has = account.balances.some(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
  );
  if (has) return false;

  const tx = new TransactionBuilder(account, { fee: '100000', networkPassphrase: PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  await horizon.submitTransaction(tx);
  return true;
}

/**
 * @param label     what this account is for, in the log
 * @param addressKey / secretKey  where it lives in .env.local
 * @param trustline whether it should be able to hold USDC
 */
async function ensure(text, label, addressKey, secretKey, trustline) {
  const existing = get(text, secretKey);
  let keypair;

  if (existing) {
    keypair = Keypair.fromSecret(existing);
    console.log(`${label.padEnd(9)} reusing  ${keypair.publicKey()}`);
  } else {
    keypair = Keypair.random();
    console.log(`${label.padEnd(9)} created  ${keypair.publicKey()}`);
  }

  await fund(keypair.publicKey());

  if (trustline) {
    const added = await addTrustline(keypair);
    if (added) console.log(`${''.padEnd(9)} trustline added for USDC`);
  }

  let next = set(text, secretKey, keypair.secret());
  if (addressKey) next = set(next, addressKey, keypair.publicKey());
  return next;
}

// --- run ------------------------------------------------------------------

console.log('Creating testnet accounts. Nothing here costs money.\n');

raw = await ensure(raw, 'platform', 'PLATFORM_ADDRESS', 'PLATFORM_SECRET', true);
raw = await ensure(raw, 'owner', null, 'OWNER_SECRET', true);
// No trustline, on purpose: this agent must not be able to hold the asset it spends.
raw = await ensure(raw, 'demo', 'DEMO_AGENT_ADDRESS', 'DEMO_AGENT_SECRET', false);
raw = await ensure(raw, 'wallet', 'WALLET_AGENT_ADDRESS', 'WALLET_AGENT_SECRET', true);

await writeFile(envPath, raw, 'utf8');

const platform = Keypair.fromSecret(get(raw, 'PLATFORM_SECRET')).publicKey();
const owner = Keypair.fromSecret(get(raw, 'OWNER_SECRET')).publicKey();

console.log(`
written to web/.env.local

Each account holds 10,000 testnet XLM, which pays transaction fees. They hold no USDC, and
friendbot does not issue any — so the demo needs some sent in once:

  1. https://faucet.circle.com  →  Stellar Testnet  →  paste each address

     platform  ${platform}
     owner     ${owner}

     5 USDC each is plenty. The platform funds the demo agents; the owner funds the demo
     allowance.

  2. npm run migrate      create the database tables
  3. npm run seed-demo    register the demo API and allowance
  4. npm run dev
`);
