/**
 * Shared machinery for the gateway tests.
 *
 * These are integration tests in the strict sense: a real dev server, the real database, and
 * real transactions on Stellar testnet. Nothing here is stubbed, because the thing under test
 * is a decision made from three sources at once — an HTTP header, a database row, and a
 * transaction's events — and a stub of any one of them would be a stub of the bug.
 *
 * The cost is that a run takes about a minute and spends a few cents of testnet USDC.
 */

import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { createClient } from '@supabase/supabase-js';

export const ORIGIN = process.env.TEST_ORIGIN ?? 'http://localhost:3000';

const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const server = new rpc.Server(process.env.STELLAR_RPC_URL);

/** The service role key, same as the routes use. These tests read and write the real tables. */
export const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

/**
 * Refuses to run rather than reporting a false green.
 *
 * A suite that quietly skips when the server is down is worse than one that fails: the output
 * looks the same as a passing run to anyone reading CI at a glance.
 */
export async function requireServer() {
  try {
    const response = await fetch(`${ORIGIN}/api/directory`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (cause) {
    throw new Error(
      `Nothing is answering at ${ORIGIN} (${cause.message}).\n` +
        'Start it with `npm run dev` in another terminal, then run the tests again.',
    );
  }
}

/** Waits for a submitted transaction to be included, or gives up rather than hanging forever. */
async function settle(hash) {
  let result = await server.getTransaction(hash);
  const deadline = Date.now() + 45_000;
  while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) throw new Error('never included in a ledger');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await server.getTransaction(hash);
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`reverted on chain: ${hash}`);
  }
  return hash;
}

/**
 * Moves USDC straight from the wallet agent to an address, with no allowance involved.
 *
 * The direct-payer path is used deliberately. It needs no allowlist entry, so a test can
 * register a throwaway API and pay it without rewriting the rules of an allowance that the
 * demo depends on. The amount check under test is the same on both paths.
 */
export async function payDirect(recipient, amountStroops) {
  const payer = Keypair.fromSecret(process.env.WALLET_AGENT_SECRET);
  const account = await server.getAccount(payer.publicKey());

  const tx = new TransactionBuilder(account, { fee: '2000000', networkPassphrase: PASSPHRASE })
    .addOperation(
      Operation.invokeContractFunction({
        contract: process.env.USDC_SAC,
        function: 'transfer',
        args: [
          nativeToScVal(payer.publicKey(), { type: 'address' }),
          nativeToScVal(recipient, { type: 'address' }),
          nativeToScVal(BigInt(amountStroops), { type: 'i128' }),
        ],
      }),
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(payer);

  const sent = await server.sendTransaction(prepared);
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
    throw new Error(`not submitted: ${sent.status}`);
  }
  return settle(sent.hash);
}

/**
 * Registers a throwaway API through the real endpoint, which also deploys it a real splitter.
 *
 * Upstream is GitHub's zen endpoint: free, no key, and it answers with a sentence, so a
 * delivered body is visibly a delivered body.
 */
export async function registerApi(priceStroops) {
  const developer = process.env.PLATFORM_ADDRESS;

  const response = await fetch(`${ORIGIN}/api/apis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      developer_address: developer,
      payout_address: developer,
      name: `gateway test ${new Date().toISOString()}`,
      upstream_url: 'https://api.github.com/zen',
      price_stroops: String(priceStroops),
    }),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body.detail ?? body.error ?? 'could not register a test API');
  return body;
}

/** Leaves the row behind on purpose — archived APIs are invisible to the gateway and to the UI,
 *  and keeping them makes a failed run inspectable afterwards. */
export async function archiveApi(id) {
  await db().from('apis').update({ status: 'archived' }).eq('id', id);
}

/** The only way to change a price today. There is no route for it, which is precisely why the
 *  gateway comparing against the live price has gone unnoticed. */
export async function setPrice(id, priceStroops) {
  const { error } = await db()
    .from('apis')
    .update({ price_stroops: String(priceStroops) })
    .eq('id', id);
  if (error) throw new Error(`could not change the price: ${error.message}`);
}

/** Asks for a quote. Returns the 402 body, which carries the price and the reference. */
export async function quote(paidUrl) {
  const response = await fetch(paidUrl);
  if (response.status !== 402) {
    throw new Error(`expected a 402 quote, got ${response.status}`);
  }
  return response.json();
}

/** Comes back with the payment, the way an agent does on its second call. */
export function deliver(paidUrl, { txHash, reference }) {
  return fetch(paidUrl, {
    headers: {
      'x-payment-tx': txHash,
      // A direct payer cannot put the reference on-chain, so it names it here.
      'x-allowance-reference': reference,
    },
  });
}
