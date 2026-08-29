/**
 * Agent accounts, as the user tab now describes them.
 *
 * Two changes of shape here, both deliberate. There is no per-call cap any more — it was the
 * rule most likely to break a working setup for a reason the owner did not control, and a single
 * call can spend at most what the window allows anyway. And the rate limit itself is optional,
 * because it is the last of this product's protections rather than the first: when there is none,
 * the balance in the contract is the limit.
 *
 *   npm run dev        (in another terminal)
 *   npm test
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { ORIGIN, db, prove, requireServer } from './helpers.mjs';

const NO_RATE_LIMIT = 10n ** 18n;

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

describe('creating an agent account', { timeout: 4 * 60_000 }, () => {
  const owner = Keypair.random();
  let splitter;
  let created;

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
  });

  const body = (extra = {}) => ({
    owner: owner.publicKey(),
    agent: Keypair.random().publicKey(),
    name: 'research',
    allowlist: [splitter],
    ...extra,
  });

  it('needs a name', async () => {
    const response = await post('/api/allowances', body({ name: '' }));
    assert.equal(response.status, 400);
  });

  it('needs at least one API it may pay', async () => {
    // An empty allowlist refuses everything, so this would be dead on arrival — and choosing who
    // may be paid is the protection the product leads with.
    const response = await post('/api/allowances', body({ allowlist: [] }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /at least one API/);
  });

  it('has no rate limit unless one is asked for', { timeout: 2 * 60_000 }, async () => {
    const response = await post('/api/allowances', body());
    created = await response.json();
    assert.equal(response.status, 201, JSON.stringify(created));

    const detail = await fetch(`${ORIGIN}/api/allowances/${created.contract_id}`).then((r) => r.json());
    assert.ok(BigInt(detail.rules.window_cap) >= NO_RATE_LIMIT, 'expected no rate limit');
    // And the per-call cap is not a second, smaller limit hiding behind it.
    assert.equal(detail.rules.max_per_call, detail.rules.window_cap);
  });

  it('lists it with its name and the agent’s XLM', async () => {
    const { allowances } = await fetch(`${ORIGIN}/api/allowances?owner=${owner.publicKey()}`).then((r) => r.json());
    const row = allowances.find((a) => a.contract_id === created.contract_id);

    assert.ok(row, 'the new agent was not listed');
    assert.equal(row.name, 'research');
    // Null is a real answer: the agent account may not have been funded into existence yet.
    assert.ok(row.xlm === null || typeof row.xlm === 'number');
    assert.deepEqual(row.can_pay.length, 1);
  });

  it('takes a rate limit when one is given', { timeout: 2 * 60_000 }, async () => {
    const response = await post(
      '/api/allowances',
      body({ name: 'capped', window_cap: '5000000', window_minutes: 15 }),
    );
    const capped = await response.json();
    assert.equal(response.status, 201, JSON.stringify(capped));

    const detail = await fetch(`${ORIGIN}/api/allowances/${capped.contract_id}`).then((r) => r.json());
    assert.equal(detail.rules.window_cap, '5000000');
    assert.equal(detail.rules.window_ledgers, 180);
  });
});

describe('renaming an agent account', { timeout: 2 * 60_000 }, () => {
  const owner = Keypair.random();
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

    const created = await post('/api/allowances', {
      owner: owner.publicKey(),
      agent: Keypair.random().publicKey(),
      name: 'first',
      allowlist: [data.splitter_contract_id],
    }).then((r) => r.json());
    contractId = created.contract_id;
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
