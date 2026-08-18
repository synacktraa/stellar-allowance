/**
 * One-off setup for a demo that pays for itself.
 *
 *   node --env-file=.env.local scripts/demo-loop.mjs
 *
 * The landing page demo spends real testnet USDC on every run — 0.5 from an unprotected agent
 * and up to 0.5 from an allowance. The original demo API paid out to a throwaway developer
 * account whose key nobody holds, so every run moved money one way and out. After a handful of
 * visitors both columns read "empty", which is not the argument the page is making.
 *
 * This registers a demo API whose developer *is* the platform. Then a flush returns 90% to the
 * platform as the developer and 10% to the platform as the fee — the whole amount, minus XLM
 * transaction fees, which the platform has in the thousands. The money goes round instead of
 * away, and `/api/demo/prepare` can top the two agents back up before every run.
 *
 * It then allowlists the new splitter on the demo allowance, which only the owner can do.
 *
 * Prints the DEMO_API_ID to set. Safe to re-run: it reuses an existing self-paying API.
 */

import {
  Address,
  Asset,
  Contract,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';

const passphrase = process.env.STELLAR_NETWORK_PASSPHRASE;
const server = new rpc.Server(process.env.STELLAR_RPC_URL);
const horizon = new Horizon.Server(process.env.HORIZON_URL);

const platform = process.env.PLATFORM_ADDRESS;
const owner = Keypair.fromSecret(process.env.OWNER_SECRET);
const allowanceId = process.env.ALLOWANCE_CONTRACT_ID;
const origin = process.env.DEMO_ORIGIN ?? 'http://localhost:3000';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

async function submit(tx, signer) {
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
  return result.returnValue ? scValToNative(result.returnValue) : null;
}

async function build(signer, operation, fee = '5000000') {
  const account = await server.getAccount(signer.publicKey());
  return new TransactionBuilder(account, { fee, networkPassphrase: passphrase })
    .addOperation(operation)
    .setTimeout(60)
    .build();
}

// --- 1. a demo API that pays the platform ---------------------------------

const listed = await fetch(`${origin}/api/apis?developer=${platform}`).then((r) => r.json());
let api = (listed.apis ?? []).find((row) => row.name === 'GitHub Zen (demo)');

if (api) {
  console.log(`reusing:    ${api.id}`);
} else {
  const response = await fetch(`${origin}/api/apis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      developer_address: platform,
      payout_address: platform,
      name: 'GitHub Zen (demo)',
      upstream_url: 'https://api.github.com/zen',
      price_stroops: '1000000',
    }),
  });
  api = await response.json();
  if (!response.ok) throw new Error(api.error ?? 'could not register the demo API');
  console.log(`registered: ${api.id}`);
}

const splitter = api.splitter_contract_id;
console.log(`splitter:   ${splitter}`);

// --- 2. let the demo allowance pay it -------------------------------------

const config = await fetch(`${origin}/api/allowances/${allowanceId}`).then((r) => r.json());
const allowlist = config.rules.allowlist;

if (allowlist.includes(splitter)) {
  console.log('allowlist:  already includes it');
} else {
  await submit(
    await build(
      owner,
      new Contract(allowanceId).call(
        'set_rules',
        nativeToScVal(
          {
            max_per_call: BigInt(config.rules.max_per_call),
            // Two minutes. A full run of seven attempts takes about fifty seconds, so the cap
            // still binds within a run — but it clears before the next visitor arrives, rather
            // than showing them seven refusals and none of the contrast.
            window_ledgers: 24,
            window_cap: BigInt(config.rules.window_cap),
            allowlist: [...allowlist, splitter].map((a) => Address.fromString(a)),
          },
          {
            type: {
              max_per_call: ['symbol', 'i128'],
              window_ledgers: ['symbol', 'u32'],
              window_cap: ['symbol', 'i128'],
              allowlist: ['symbol', null],
            },
          },
        ),
      ),
    ),
    owner,
  );
  console.log('allowlist:  added, window set to 24 ledgers (~2 min)');
}

// --- 3. seed the platform so it has something to lend out ------------------

const ownerAccount = await horizon.loadAccount(owner.publicKey());
const ownerUsdc = Number(
  ownerAccount.balances.find((b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER)
    ?.balance ?? 0,
);

// Leave the owner a little for depositing into the allowance by hand; the rest funds the loop.
const seed = Math.max(0, ownerUsdc - 0.5);

if (seed > 0.01) {
  const tx = new TransactionBuilder(ownerAccount, { fee: '10000', networkPassphrase: passphrase })
    .addOperation(
      Operation.payment({
        destination: platform,
        asset: new Asset('USDC', USDC_ISSUER),
        amount: seed.toFixed(7),
      }),
    )
    .setTimeout(60)
    .build();
  tx.sign(owner);
  await horizon.submitTransaction(tx);
  console.log(`seeded:     ${seed.toFixed(2)} USDC to the platform`);
} else {
  console.log('seeded:     platform already funded');
}

console.log(`\nset in .env.local:\n  DEMO_API_ID=${api.id}`);
