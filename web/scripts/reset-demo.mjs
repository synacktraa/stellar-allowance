/**
 * Resets the demo to a known state.
 *
 *   node --env-file=.env.local scripts/reset-demo.mjs <splitter-C...>
 *
 * Deploys a fresh allowance, funds it, and tops the unprotected agent back up to 0.5 USDC.
 *
 * A used spend window is not something you can clear on demand — it clears by time passing,
 * which is the whole point of it. So between rehearsals the fastest reset is a new contract,
 * which is also what a real user gets when they set one up.
 *
 * Prints the ALLOWANCE_CONTRACT_ID to use for the next run.
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
import { randomBytes } from 'node:crypto';

const splitter = process.argv[2];
if (!splitter?.startsWith('C')) {
  console.error('usage: reset-demo.mjs <splitter-contract-id>');
  process.exit(1);
}

const passphrase = process.env.STELLAR_NETWORK_PASSPHRASE;
const rpcServer = new rpc.Server(process.env.STELLAR_RPC_URL);
const horizon = new Horizon.Server(process.env.HORIZON_URL);
const platform = Keypair.fromSecret(process.env.PLATFORM_SECRET);
const owner = Keypair.fromSecret(process.env.OWNER_SECRET);
const agentAddress = process.env.DEMO_AGENT_ADDRESS;
const walletAgent = process.env.WALLET_AGENT_ADDRESS;
const usdc = process.env.USDC_SAC;

const DEPOSIT = 20_000_000n; // 2 USDC
const RULES = { maxPerCall: 1_000_000n, windowLedgers: 180, windowCap: 5_000_000n };

async function submit(tx, signer) {
  const prepared = await rpcServer.prepareTransaction(tx);
  prepared.sign(signer);
  const sent = await rpcServer.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(JSON.stringify(sent.errorResult));
  let result = await rpcServer.getTransaction(sent.hash);
  while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    await new Promise((r) => setTimeout(r, 1000));
    result = await rpcServer.getTransaction(sent.hash);
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`reverted: ${sent.hash}`);
  }
  return result.returnValue ? scValToNative(result.returnValue) : null;
}

async function build(signer, operation) {
  const account = await rpcServer.getAccount(signer.publicKey());
  return new TransactionBuilder(account, { fee: '5000000', networkPassphrase: passphrase })
    .addOperation(operation)
    .setTimeout(60)
    .build();
}

// 1. fresh allowance
const contractId = await submit(
  await build(
    platform,
    Operation.createCustomContract({
      address: Address.fromString(platform.publicKey()),
      wasmHash: Buffer.from(process.env.ALLOWANCE_WASM_HASH, 'hex'),
      salt: randomBytes(32),
    }),
  ),
  platform,
);
console.log(`allowance:  ${contractId}`);

// 2. init, owned by the owner, spendable by the agent, allowlisting only this splitter
await submit(
  await build(
    owner,
    new Contract(contractId).call(
      'init',
      nativeToScVal(owner.publicKey(), { type: 'address' }),
      nativeToScVal(usdc, { type: 'address' }),
      nativeToScVal(agentAddress, { type: 'address' }),
      nativeToScVal(
        {
          max_per_call: RULES.maxPerCall,
          window_ledgers: RULES.windowLedgers,
          window_cap: RULES.windowCap,
          allowlist: [Address.fromString(splitter)],
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
console.log(`initialised, allowlisting ${splitter.slice(0, 8)}...`);

// 3. fund it
await submit(
  await build(
    owner,
    new Contract(contractId).call(
      'deposit',
      nativeToScVal(owner.publicKey(), { type: 'address' }),
      nativeToScVal(DEPOSIT, { type: 'i128' }),
    ),
  ),
  owner,
);
console.log(`funded:     ${Number(DEPOSIT) / 1e7} USDC`);

// 4. top the unprotected agent back to 0.5 USDC
const account = await horizon.loadAccount(owner.publicKey());
const held = account.balances.find((b) => b.asset_code === 'USDC');
const walletAccount = await horizon.loadAccount(walletAgent);
const walletHeld = Number(walletAccount.balances.find((b) => b.asset_code === 'USDC')?.balance ?? 0);
const topUp = (0.5 - walletHeld).toFixed(7);

if (Number(topUp) > 0 && Number(held?.balance ?? 0) >= Number(topUp)) {
  const tx = new TransactionBuilder(account, { fee: '10000', networkPassphrase: passphrase })
    .addOperation(
      Operation.payment({
        destination: walletAgent,
        asset: new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'),
        amount: topUp,
      }),
    )
    .setTimeout(60)
    .build();
  tx.sign(owner);
  await horizon.submitTransaction(tx);
  console.log(`topped up unprotected agent by ${topUp} USDC`);
}

console.log(`\nrun the demo with:\n  --allowance ${contractId}`);
