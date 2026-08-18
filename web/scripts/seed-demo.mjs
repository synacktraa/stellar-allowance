/**
 * Builds the landing page demo: an API, an allowance, and two funded agents.
 *
 *   npm run dev          (in another terminal — this talks to it)
 *   npm run seed-demo
 *
 * The demo API's developer is the platform itself. That is not a shortcut, it is what makes the
 * demo survive being public: every run spends real testnet USDC, and flushing a splitter whose
 * developer is the platform returns 90% as the developer share and 10% as the fee — the whole
 * amount. The money goes round rather than away, so `/api/demo/prepare` can reset both agents
 * before each run without anyone topping it up by hand.
 *
 * Writes DEMO_API_ID and ALLOWANCE_CONTRACT_ID back into .env.local. Those two are read when
 * the landing page is *built*, not per request, so restart `npm run dev` afterwards.
 *
 * Safe to re-run: it reuses an existing demo API and allowance rather than making more.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Asset,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env.local');

const origin = process.env.DEMO_ORIGIN ?? 'http://localhost:3000';
const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const server = new rpc.Server(process.env.STELLAR_RPC_URL);
const horizon = new Horizon.Server(process.env.HORIZON_URL);

const platform = process.env.PLATFORM_ADDRESS;
const owner = Keypair.fromSecret(process.env.OWNER_SECRET);
const demoAgent = process.env.DEMO_AGENT_ADDRESS;
const walletAgent = process.env.WALLET_AGENT_ADDRESS;

const NAME = 'GitHub Zen (demo)';
const PRICE = '1000000'; // 0.10 USDC

async function alive() {
  try {
    await fetch(`${origin}/api/directory`);
    return true;
  } catch {
    return false;
  }
}

if (!(await alive())) {
  console.error(`Nothing is answering at ${origin}.\nStart it with \`npm run dev\` first.`);
  process.exit(1);
}

async function submit(operation, signer) {
  const account = await server.getAccount(signer.publicKey());
  const tx = new TransactionBuilder(account, { fee: '5000000', networkPassphrase: PASSPHRASE })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(signer);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(JSON.stringify(sent.errorResult));

  let result = await server.getTransaction(sent.hash);
  const deadline = Date.now() + 45_000;
  while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) throw new Error('never included in a ledger');
    await new Promise((r) => setTimeout(r, 1000));
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`reverted: ${sent.hash}`);
  }
}

async function usdcOf(address) {
  const account = await horizon.loadAccount(address);
  const line = account.balances.find(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
  );
  return Number(line?.balance ?? 0);
}

// --- 1. the API -----------------------------------------------------------

const listed = await fetch(`${origin}/api/apis?developer=${platform}`).then((r) => r.json());
let api = (listed.apis ?? []).find((row) => row.name === NAME);

if (api) {
  console.log(`api        reusing  ${api.id}`);
} else {
  const response = await fetch(`${origin}/api/apis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      developer_address: platform,
      payout_address: platform,
      name: NAME,
      upstream_url: 'https://api.github.com/zen',
      price_stroops: PRICE,
    }),
  });
  api = await response.json();
  if (!response.ok) throw new Error(api.error ?? 'could not register the demo API');
  console.log(`api        created  ${api.id}`);
}

console.log(`splitter            ${api.splitter_contract_id}`);

// --- 2. the allowance -----------------------------------------------------

const mine = await fetch(`${origin}/api/allowances?owner=${owner.publicKey()}`).then((r) =>
  r.json(),
);
let allowanceId = (mine.allowances ?? []).find((a) => a.agent_address === demoAgent)?.contract_id;

if (allowanceId) {
  console.log(`allowance  reusing  ${allowanceId}`);
} else {
  const response = await fetch(`${origin}/api/allowances`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      owner: owner.publicKey(),
      agent: demoAgent,
      max_per_call: '1000000', // 0.10 — one purchase
      window_cap: '5000000', // 0.50 — five, then it refuses
      // Two minutes. A run of seven attempts takes about fifty seconds, so the cap still binds
      // within a run, but it has cleared before the next visitor arrives.
      window_ledgers: 24,
      allowlist: [api.splitter_contract_id],
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'could not create the demo allowance');
  allowanceId = body.contract_id;
  console.log(`allowance  created  ${allowanceId}`);
}

// --- 3. money -------------------------------------------------------------

const ownerUsdc = await usdcOf(owner.publicKey());
const platformUsdc = await usdcOf(platform);

if (ownerUsdc < 2 || platformUsdc < 1) {
  console.log(`
Not enough USDC to fund the demo.

  owner     ${ownerUsdc.toFixed(2)}  (needs 2+)
  platform  ${platformUsdc.toFixed(2)}  (needs 1+)

Send testnet USDC from https://faucet.circle.com, then run this again:

  owner     ${owner.publicKey()}
  platform  ${platform}
`);
} else {
  const inAllowance = Number(
    (await fetch(`${origin}/api/allowances/${allowanceId}`).then((r) => r.json())).balance ?? 0,
  );

  if (inAllowance < 10_000_000) {
    await submit(
      new Contract(allowanceId).call(
        'deposit',
        nativeToScVal(owner.publicKey(), { type: 'address' }),
        nativeToScVal(BigInt(12_000_000 - inAllowance), { type: 'i128' }),
      ),
      owner,
    );
    console.log('allowance  funded to 1.20 USDC');
  }

  // The unprotected agent gets exactly its allotment. "It spent everything it had" only reads
  // as a consequence of having no limit if it visibly had something to begin with.
  const held = await usdcOf(walletAgent);
  if (held < 0.5) {
    const account = await horizon.loadAccount(platform);
    const tx = new TransactionBuilder(account, { fee: '10000', networkPassphrase: PASSPHRASE })
      .addOperation(
        Operation.payment({
          destination: walletAgent,
          asset: new Asset('USDC', USDC_ISSUER),
          amount: (0.5 - held).toFixed(7),
        }),
      )
      .setTimeout(60)
      .build();
    tx.sign(Keypair.fromSecret(process.env.PLATFORM_SECRET));
    await horizon.submitTransaction(tx);
    console.log('wallet     funded to 0.50 USDC');
  }
}

// --- 4. write it down -----------------------------------------------------

let raw = await readFile(envPath, 'utf8');
const set = (text, key, value) => {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(text)
    ? text.replace(pattern, `${key}=${value}`)
    : `${text.trimEnd()}\n${key}=${value}\n`;
};
raw = set(raw, 'DEMO_API_ID', api.id);
raw = set(raw, 'ALLOWANCE_CONTRACT_ID', allowanceId);
await writeFile(envPath, raw, 'utf8');

console.log(`
written to web/.env.local

  DEMO_API_ID=${api.id}
  ALLOWANCE_CONTRACT_ID=${allowanceId}

Restart \`npm run dev\` — the landing page reads these at build time, not per request.
`);
