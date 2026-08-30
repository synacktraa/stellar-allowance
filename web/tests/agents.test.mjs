/**
 * Allowances, as the user tab now describes them.
 *
 * The shape that matters here: the owner deploys their own contract. A deploy runs its
 * constructor in the same invocation, so one signature creates the allowance, names its agent,
 * sets the rules, moves USDC in and funds the agent's account. The platform no longer deploys
 * anything, and this API no longer creates — it *records*, and only what the chain confirms.
 *
 * These tests therefore deploy for real. An owner is funded by friendbot and deploys with no
 * USDC, which is legal and keeps the suite from needing a funded USDC balance per run.
 *
 *   npm run dev        (in another terminal)
 *   npm test
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  Address,
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  StrKey,
  xdr,
} from '@stellar/stellar-sdk';
import { randomBytes } from 'node:crypto';
import { ORIGIN, db, prove, requireServer } from './helpers.mjs';

const NO_RATE_LIMIT = 10n ** 18n;
const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE;
const server = new rpc.Server(process.env.STELLAR_RPC_URL);

const post = (path, body) =>
  fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const patch = (path, body) =>
  fetch(`${ORIGIN}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A brand-new account with XLM and nothing else. */
async function fundedAccount() {
  const keypair = Keypair.random();
  const response = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(keypair.publicKey())}`,
  );
  if (!response.ok) throw new Error(`friendbot refused: ${response.status}`);
  return keypair;
}

/**
 * Deploys an allowance the way the browser now will: one signed transaction that creates the
 * contract and runs its constructor.
 *
 * `usdcIn` defaults to zero so a test owner needs only XLM. That is a real supported state —
 * an allowance set up now and funded later.
 */
async function deployAllowance(owner, { agent, allowlist, usdcIn = 0n, xlmToAgent = 20_000_000n }) {
  const params = await fetch(`${ORIGIN}/api/allowances/params`).then((r) => r.json());
  const addr = (a) => nativeToScVal(a, { type: 'address' });

  const rules = nativeToScVal(
    {
      max_per_call: NO_RATE_LIMIT,
      window_ledgers: 17280,
      window_cap: NO_RATE_LIMIT,
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
          nativeToScVal(usdcIn, { type: 'i128' }),
          nativeToScVal(xlmToAgent, { type: 'i128' }),
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

  return Address.fromScAddress(xdr.ScVal.fromXDR(result.returnValue.toXDR()).address()).toString();
}

describe('what a client needs to deploy', () => {
  before(requireServer);

  it('serves the wasm hash and both asset contracts', async () => {
    const response = await fetch(`${ORIGIN}/api/allowances/params`);
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.match(body.wasm_hash, /^[0-9a-f]{64}$/, 'a sha256 of the binary');
    assert.ok(body.token.startsWith('C'), 'USDC asset contract');
    assert.ok(body.native.startsWith('C'), 'native asset contract');
    assert.equal(
      body.native,
      Asset.native().contractId(PASSPHRASE),
      'derived from the network, not configured separately',
    );
  });
});

describe('recording an allowance', { timeout: 5 * 60_000 }, () => {
  let owner;
  let agent;
  let splitter;
  let contractId;

  before(async () => {
    await requireServer();
    const { data } = await db()
      .from('apis')
      .select('splitter_contract_id')
      .eq('status', 'active')
      .not('splitter_contract_id', 'is', null)
      .limit(1)
      .single();
    splitter = data.splitter_contract_id;

    owner = await fundedAccount();
    agent = Keypair.random();
    contractId = await deployAllowance(owner, { agent: agent.publicKey(), allowlist: [splitter] });
  });

  const body = (extra = {}) => ({
    owner: owner.publicKey(),
    agent: agent.publicKey(),
    contract_id: contractId,
    ...extra,
  });

  it('ignores a name the caller tries to supply', async () => {
    // Nothing in this request is the caller's to choose, which is why it needs no signature.
    // A name from the caller would be the one exception, and the only thing worth racing the
    // real owner to plant.
    const response = await post('/api/allowances', body({ name: 'chosen by an attacker' }));
    assert.equal(response.status, 201);
    assert.match((await response.json()).name, /^allowance-\d+$/);
  });

  it('refuses a contract address that is not one', async () => {
    const response = await post('/api/allowances', body({ contract_id: 'CNONSENSE' }));
    assert.equal(response.status, 400, 'malformed, refused before the chain is consulted');
  });

  it('refuses a well-formed contract that does not exist', async () => {
    // Correct checksum, nothing behind it. This is the case that has to reach the chain to be
    // caught, which is the check that stops anyone claiming an address they invented.
    const nowhere = StrKey.encodeContract(randomBytes(32));
    const response = await post('/api/allowances', body({ contract_id: nowhere }));
    assert.equal(response.status, 404);
  });

  it('refuses a contract owned by somebody else', async () => {
    const response = await post('/api/allowances', body({ owner: Keypair.random().publicKey() }));
    assert.equal(response.status, 403, 'the chain says who owns it, not the caller');
  });

  it('refuses a claim about a different agent', async () => {
    const response = await post('/api/allowances', body({ agent: Keypair.random().publicKey() }));
    assert.equal(response.status, 400);
  });

  it('is recorded once, and saying so twice is not an error', async () => {
    const again = await post('/api/allowances', body());
    assert.equal(again.status, 200, 'already recorded, which is not a failure');
    assert.equal((await again.json()).recorded, false);
  });

  it('lists it with its name, its rules and the agent XLM the constructor sent', async () => {
    const response = await fetch(`${ORIGIN}/api/allowances?owner=${owner.publicKey()}`);
    const { allowances } = await response.json();
    const row = allowances.find((a) => a.contract_id === contractId);

    assert.ok(row, 'the allowance should be listed');
    assert.match(row.name, /^allowance-\d+$/, 'a placeholder, renamed later');
    assert.equal(row.balance, '0', 'deployed unfunded, which is legal');
    assert.equal(row.xlm, 2, 'the constructor created and funded the agent account');
    assert.deepEqual(row.rules.allowlist, [splitter]);
  });

  it('finds it by the agent key alone, which is all an agent knows', async () => {
    const response = await fetch(`${ORIGIN}/api/allowances?agent=${agent.publicKey()}`);
    const { allowances } = await response.json();
    assert.equal(allowances.length, 1);
    assert.equal(allowances[0].contract_id, contractId);
  });
});

describe('renaming an allowance', { timeout: 2 * 60_000 }, () => {
  let owner;
  const stranger = Keypair.random();
  let contractId;

  before(async () => {
    await requireServer();
    const { data } = await db()
      .from('apis')
      .select('splitter_contract_id')
      .eq('status', 'active')
      .not('splitter_contract_id', 'is', null)
      .limit(1)
      .single();

    const funded = await fundedAccount();
    owner = funded;
    const agent = Keypair.random();
    contractId = await deployAllowance(owner, {
      agent: agent.publicKey(),
      allowlist: [data.splitter_contract_id],
    });
    await post('/api/allowances', {
      owner: owner.publicKey(),
      agent: agent.publicKey(),
      contract_id: contractId,
    });
  });

  it('will not rename without a signature', async () => {
    const response = await patch(`/api/allowances/${contractId}`, {
      address: owner.publicKey(),
      name: 'renamed',
    });
    assert.equal(response.status, 401);
  });

  it('renames it for the owner', async () => {
    const response = await patch(`/api/allowances/${contractId}`, {
      ...(await prove(owner)),
      name: 'renamed',
    });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  });

  it('refuses somebody else holding a perfectly good signature', async () => {
    const response = await patch(`/api/allowances/${contractId}`, {
      ...(await prove(stranger)),
      name: 'mine now',
    });
    assert.equal(response.status, 404);
  });

  it('refuses a name that is not a name', async () => {
    // Surrounding whitespace is trimmed rather than refused — a typo to fix, not an error to
    // report. These are names no trimming rescues.
    for (const bad of ['', '   ', 'slash/es', 'star*', 'x'.repeat(33)]) {
      const response = await patch(`/api/allowances/${contractId}`, {
        ...(await prove(owner)),
        name: bad,
      });
      assert.equal(response.status, 400, JSON.stringify(bad) + ' was not refused');
    }
  });

  it('trims a name rather than refusing it', async () => {
    const response = await patch(`/api/allowances/${contractId}`, {
      ...(await prove(owner)),
      name: '  spaced out  ',
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).name, 'spaced out');
  });
});
