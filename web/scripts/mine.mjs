/**
 * Buy from your own API, using your own agent.
 *
 *   npm run mine            -- seven attempts
 *   npm run mine 3          -- three attempts
 *
 * Reads USER_AGENT_SECRET and MY_API from .env.local. The allowance is looked up from the
 * agent's own key, so there is no contract id to paste — an agent knows who it is, and that is
 * enough to find what it is allowed to ask.
 *
 * This is the same path a real agent takes: get refused with a price, ask the contract, come
 * back and point at the payment.
 */

import { Contract, Keypair, TransactionBuilder, nativeToScVal, rpc } from '@stellar/stellar-sdk';

const attempts = Number(process.argv[2] ?? 7);

const url = process.env.MY_API;
const secret = process.env.USER_AGENT_SECRET;

if (!url || !secret) {
  console.error('Set MY_API and USER_AGENT_SECRET in web/.env.local');
  process.exit(1);
}

const passphrase = process.env.STELLAR_NETWORK_PASSPHRASE;
const server = new rpc.Server(process.env.STELLAR_RPC_URL);
const agent = Keypair.fromSecret(secret);
const origin = new URL(url).origin;

// --- find the allowance this agent belongs to -----------------------------
const lookup = await fetch(`${origin}/api/allowances?agent=${agent.publicKey()}`);
const { allowances = [] } = await lookup.json();

if (allowances.length === 0) {
  console.error(`No allowance found for agent ${agent.publicKey()}.`);
  console.error('Create one at /user, choosing the same agent key.');
  process.exit(1);
}

const allowanceId = allowances[0].contract_id;

async function state() {
  const response = await fetch(`${origin}/api/allowances/${allowanceId}`);
  return response.ok ? response.json() : null;
}

const usdc = (stroops) => (Number(stroops ?? 0) / 1e7).toFixed(2);

const before = await state();
console.log(`agent      ${agent.publicKey()}`);
console.log(`allowance  ${allowanceId}`);
console.log(`balance    ${usdc(before?.balance)} USDC`);
console.log(`window     ${usdc(before?.spent_in_window)} / ${usdc(before?.rules.window_cap)} used`);
console.log(`per call   max ${usdc(before?.rules.max_per_call)}`);
console.log(`allowed    ${before?.rules.allowlist.length} recipient(s)`);
console.log(`api        ${url}\n`);

if (before && Number(before.balance) === 0) {
  console.log('The allowance has no money in it. Add some at /user first.\n');
}

/** Translates a host error into the rule that stopped it. */
function why(detail) {
  if (/#7/.test(detail)) return 'over the window cap';
  if (/#5/.test(detail)) return 'over the per-call cap';
  if (/#6/.test(detail)) return 'recipient not on the allowlist';
  if (/#4/.test(detail)) return 'agent revoked';
  if (/#10|allowed range/.test(detail)) return 'allowance is empty';
  return detail.split('\n')[0].slice(0, 80);
}

let delivered = 0;

for (let n = 1; n <= attempts; n += 1) {
  const started = Date.now();

  const quote = await fetch(url);
  if (quote.status === 200) {
    console.log(`${n}. free — no payment required`);
    delivered += 1;
    continue;
  }
  if (quote.status !== 402) {
    console.log(`${n}. unexpected ${quote.status} — is the dev server running?`);
    break;
  }

  const { amount, recipient, reference } = await quote.json();

  const account = await server.getAccount(agent.publicKey());
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
    // Simulation runs the rules, so a refusal shows up before anything is submitted.
    prepared = await server.prepareTransaction(tx);
  } catch (cause) {
    console.log(`${n}. REFUSED — ${why(cause instanceof Error ? cause.message : String(cause))}`);
    continue;
  }

  prepared.sign(agent);
  const sent = await server.sendTransaction(prepared);

  // Only PENDING and DUPLICATE mean the network took it. TRY_AGAIN_LATER is neither an error
  // nor an acceptance — treating it as success is how a script ends up polling forever for a
  // transaction that was never queued.
  if (sent.status === 'ERROR') {
    console.log(`${n}. rejected before inclusion`);
    continue;
  }
  if (sent.status === 'TRY_AGAIN_LATER') {
    console.log(`${n}. network asked us to retry — skipping this one`);
    continue;
  }

  // A submitted transaction is not a guaranteed one. It can be dropped before any ledger
  // includes it, and then it stays NOT_FOUND forever — so this needs a deadline, or the
  // script waits for something that is never coming.
  let result = await server.getTransaction(sent.hash);
  const deadline = Date.now() + 45_000;
  while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 1000));
    result = await server.getTransaction(sent.hash);
  }

  if (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    console.log(`${n}. gave up waiting — never included (${sent.hash.slice(0, 12)}…)`);
    continue;
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    console.log(`${n}. reverted on chain (${sent.hash.slice(0, 12)}…)`);
    continue;
  }

  const delivery = await fetch(url, { headers: { 'x-payment-tx': sent.hash } });
  const body = (await delivery.text()).replace(/\s+/g, ' ').slice(0, 48);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (delivery.ok) delivered += 1;
  console.log(`${n}. ${usdc(amount)} USDC -> ${delivery.status} ${body}  (${seconds}s)`);
}

const after = await state();
console.log(`\n${delivered}/${attempts} delivered`);
console.log(`balance    ${usdc(after?.balance)} USDC  (was ${usdc(before?.balance)})`);
console.log(`window     ${usdc(after?.spent_in_window)} / ${usdc(after?.rules.window_cap)} used`);
