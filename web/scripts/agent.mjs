/**
 * A buying agent, in the two shapes that matter.
 *
 *   node --env-file=.env.local scripts/agent.mjs <paid-url> --unprotected [--times N]
 *   node --env-file=.env.local scripts/agent.mjs <paid-url> --allowance <C...> [--times N]
 *
 * `--unprotected` is how agents work today: the agent holds the wallet and pays directly, so
 * there is nothing between it and the money. `--allowance` gives it no funds at all; it can only
 * ask a contract, and the contract answers.
 *
 * The same script, the same API, the same loop. Only where the money sits changes.
 */

import {
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';

const args = process.argv.slice(2);
const url = args[0];
const mode = args.includes('--allowance') ? 'allowance' : 'unprotected';
const allowanceId = args[args.indexOf('--allowance') + 1];
const times = args.includes('--times') ? Number(args[args.indexOf('--times') + 1]) : 1;

if (!url || url.startsWith('--')) {
  console.error('usage: agent.mjs <paid-url> [--unprotected | --allowance <C...>] [--times N]');
  process.exit(1);
}

const passphrase = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const rpcServer = new rpc.Server(process.env.STELLAR_RPC_URL);
const usdc = process.env.USDC_SAC;

// Two different agents, because the difference is the whole point. The unprotected one holds
// USDC. The allowance one holds no USDC and has no trustline for it, so it could not hold any
// even if it wanted to — its only route to spending anything is asking the contract.
const agent = Keypair.fromSecret(
  mode === 'allowance' ? process.env.DEMO_AGENT_SECRET : process.env.WALLET_AGENT_SECRET,
);

async function settle(tx) {
  const sent = await rpcServer.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    return { ok: false, reason: 'rejected before inclusion' };
  }
  let result = await rpcServer.getTransaction(sent.hash);
  while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    await new Promise((r) => setTimeout(r, 1000));
    result = await rpcServer.getTransaction(sent.hash);
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    return { ok: false, reason: 'refused on-chain', hash: sent.hash };
  }
  return { ok: true, hash: sent.hash };
}

/**
 * The agent holds the money and moves it itself. Nothing is positioned to say no.
 *
 * The reference cannot travel on-chain here: Soroban transactions have no memo, and a token
 * transfer has no field for arbitrary data. So it goes in the HTTP header instead, and the
 * gateway falls back to consuming the transaction hash once globally.
 */
async function payDirectly({ amount, recipient }) {
  const account = await rpcServer.getAccount(agent.publicKey());
  const tx = new TransactionBuilder(account, { fee: '2000000', networkPassphrase: passphrase })
    .addOperation(
      Operation.invokeContractFunction({
        contract: usdc,
        function: 'transfer',
        args: [
          nativeToScVal(agent.publicKey(), { type: 'address' }),
          nativeToScVal(recipient, { type: 'address' }),
          nativeToScVal(BigInt(amount), { type: 'i128' }),
        ],
      }),
    )
    .setTimeout(60)
    .build();

  let prepared;
  try {
    prepared = await rpcServer.prepareTransaction(tx);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    // The only thing that ever stops this agent is running out. Nothing refused it.
    if (/not within the allowed range|#10/.test(detail)) {
      return { ok: false, reason: 'wallet empty - nothing left to spend' };
    }
    return { ok: false, reason: `could not pay - ${detail.split('\n')[0]}` };
  }
  prepared.sign(agent);
  return settle(prepared);
}

/**
 * The agent holds nothing. It asks, and the contract decides.
 *
 * The reference is an argument to spend(), so it ends up in the contract's event and the
 * gateway can read it back off the chain. That is the binding a direct payer cannot produce.
 */
async function payViaAllowance({ amount, recipient, reference }) {
  const account = await rpcServer.getAccount(agent.publicKey());
  const tx = new TransactionBuilder(account, { fee: '2000000', networkPassphrase: passphrase })
    .addOperation(
      new Contract(allowanceId).call(
        'spend',
        nativeToScVal(recipient, { type: 'address' }),
        nativeToScVal(BigInt(amount), { type: 'i128' }),
        nativeToScVal(reference, { type: 'symbol' }),
      ),
    )
    .setTimeout(60)
    .build();

  let prepared;
  try {
    prepared = await rpcServer.prepareTransaction(tx);
  } catch (cause) {
    // Simulation runs the rules, so a refusal is visible before anything is submitted.
    // Keep the reason: blocked and broken look identical without it.
    const detail = cause instanceof Error ? cause.message : String(cause);
    const refused = /ExceedsWindow|#7/.test(detail)
      ? 'over the window cap'
      : /ExceedsPerCall|#5/.test(detail)
        ? 'over the per-call cap'
        : /RecipientNotAllowed|#6/.test(detail)
          ? 'recipient not on the allowlist'
          : /Revoked|#4/.test(detail)
            ? 'agent revoked'
            : detail;
    return { ok: false, reason: refused };
  }
  prepared.sign(agent);
  return settle(prepared);
}

async function buyOnce(n) {
  const first = await fetch(url);
  if (first.status === 200) {
    console.log(`${n}. free - no payment required`);
    return true;
  }
  if (first.status !== 402) {
    console.log(`${n}. unexpected ${first.status}`);
    return false;
  }

  const { amount, recipient, reference } = await first.json();
  const paid =
    mode === 'allowance'
      ? await payViaAllowance({ amount, recipient, reference })
      : await payDirectly({ amount, recipient });

  if (!paid.ok) {
    console.log(`${n}. REFUSED - ${paid.reason}`);
    return false;
  }

  const headers = { 'x-payment-tx': paid.hash };
  if (mode !== 'allowance') headers['x-allowance-reference'] = reference;

  const second = await fetch(url, { headers });
  const body = await second.text();
  const preview = body.replace(/\s+/g, ' ').slice(0, 56);
  console.log(
    `${n}. paid ${(Number(amount) / 1e7).toFixed(2)} USDC -> ${second.status} ${preview}`,
  );
  return second.ok;
}

console.log(`mode:  ${mode}${mode === 'allowance' ? ` (${allowanceId.slice(0, 8)}...)` : ''}`);
console.log(`agent: ${agent.publicKey().slice(0, 8)}...\n`);

let bought = 0;
for (let i = 1; i <= times; i += 1) {
  if (await buyOnce(i)) bought += 1;
}

console.log(`\n${bought}/${times} delivered`);
