/**
 * The client SDK, buying for real.
 *
 * The unit tests in `packages/client` cover the decisions this package makes without a network.
 * This covers the one thing they cannot: that an agent holding nothing but a secret key can buy
 * a call, and that it is refused when it asks to pay somebody its owner never approved.
 *
 * That second test is the product's actual claim. An agent told — by a prompt, by a poisoned
 * search result, by anything — to pay an address nobody vetted does not get to. Not because the
 * agent's code declines, but because the network does.
 *
 *   npm run dev        (in another terminal)
 *   npm test
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  Address,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { randomBytes } from 'node:crypto';
import { Allowance, AllowanceRefused } from '../../packages/client/dist/index.js';
import { ORIGIN, archiveApi, registerApi, requireServer } from './helpers.mjs';

const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE;
const server = new rpc.Server(process.env.STELLAR_RPC_URL);
const PRICE = 1_000_000n; // 0.10 USDC

const addr = (a) => nativeToScVal(a, { type: 'address' });
const i128 = (n) => nativeToScVal(BigInt(n), { type: 'i128' });

/** Deploys and funds an allowance in one signed transaction, as the browser does. */
async function deployAllowance(owner, { agent, allowlist, usdcIn, xlmToAgent }) {
  const params = await fetch(`${ORIGIN}/api/allowances/params`).then((r) => r.json());
  const rules = nativeToScVal(
    {
      max_per_call: 10n ** 18n,
      window_ledgers: 17280,
      window_cap: 10n ** 18n,
      allowlist: allowlist.map((a) => Address.fromString(a)),
    },
    {
      type: {
        max_per_call: ['symbol', 'i128'],
        window_ledgers: ['symbol', 'u32'],
        window_cap: ['symbol', 'i128'],
        allowlist: ['symbol', null],
      },
    },
  );

  const account = await server.getAccount(owner.publicKey());
  const tx = new TransactionBuilder(account, { fee: '20000000', networkPassphrase: PASSPHRASE })
    .addOperation(
      Operation.createCustomContract({
        address: Address.fromString(owner.publicKey()),
        wasmHash: Buffer.from(params.wasm_hash, 'hex'),
        salt: randomBytes(32),
        constructorArgs: [
          addr(owner.publicKey()),
          addr(params.token),
          addr(params.native),
          addr(agent),
          rules,
          i128(usdcIn),
          i128(xlmToAgent),
        ],
      }),
    )
    .setTimeout(90)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(owner);
  const sent = await server.sendTransaction(prepared);

  let result = await server.getTransaction(sent.hash);
  const deadline = Date.now() + 90_000;
  while (result.status === 'NOT_FOUND' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== 'SUCCESS') throw new Error(`deploy failed: ${result.status}`);

  const contractId = Address.fromScAddress(result.returnValue.address()).toString();
  await fetch(`${ORIGIN}/api/allowances`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owner: owner.publicKey(), agent, contract_id: contractId }),
  });
  return contractId;
}

describe('buying with the client SDK', { timeout: 6 * 60_000 }, () => {
  // The platform holds USDC and a trustline; a friendbot account has neither, and an allowance
  // has to be funded with something the agent can actually spend.
  const owner = Keypair.fromSecret(process.env.PLATFORM_SECRET);
  const agent = Keypair.random();

  let allowed;
  let forbidden;
  let client;

  before(async () => {
    await requireServer();

    // Two APIs. The allowance is told about one of them and not the other, which is the whole
    // experiment: the difference between them is not in the agent's code.
    allowed = await registerApi(PRICE.toString());
    forbidden = await registerApi(PRICE.toString());

    await deployAllowance(owner, {
      agent: agent.publicKey(),
      allowlist: [allowed.splitter_contract_id],
      usdcIn: PRICE * 2n,
      xlmToAgent: 50_000_000n, // 5 XLM, for the agent's own fees
    });

    client = new Allowance(agent.secret());
  });

  after(async () => {
    await archiveApi(allowed.id);
    await archiveApi(forbidden.id);
  });

  it('knows its own address without being told', () => {
    assert.equal(client.address, agent.publicKey());
  });

  it('buys a call from one secret key and nothing else', async () => {
    // No contract id anywhere. The agent knows its key; the allowance is found from it.
    const response = await client.fetch(allowed.paid_url);

    // Read once. A Response body is a stream, so consuming it for an assertion message and then
    // again for the assertion itself fails on the second read.
    const body = await response.text();
    assert.equal(response.status, 200, body);
    assert.ok(body.length > 0, 'the API answered');
  });

  it('refuses to pay an API its owner never allowed', async () => {
    // The prompt-injection case, and the reason this product exists. The agent is asking
    // politely and correctly; the contract is what says no.
    await assert.rejects(
      () => client.fetch(forbidden.paid_url),
      (error) => {
        assert.ok(error instanceof AllowanceRefused, `expected a refusal, got ${error}`);
        assert.equal(error.rule, 'allowlist');
        return true;
      },
    );
  });

  it('passes through a URL that never asks for payment', async () => {
    // Safe to point at anything. Nothing is signed and no money moves for a 200.
    const response = await client.fetch(`${ORIGIN}/api/allowances/params`);
    assert.equal(response.status, 200);
    assert.ok((await response.json()).wasm_hash);
  });

  it('will not take a Request object, and says why', async () => {
    await assert.rejects(
      () => client.fetch(new Request(allowed.paid_url)),
      /body can only be read once/,
    );
  });

  it('refuses an oversized body before paying for it', async () => {
    const { max_body_bytes } = await fetch(`${ORIGIN}/api/allowances/params`).then((r) => r.json());
    await assert.rejects(
      () =>
        client.fetch(allowed.paid_url, {
          method: 'POST',
          body: 'x'.repeat(max_body_bytes + 1),
        }),
      /Refused here so it is not paid for first/,
    );
  });
});
