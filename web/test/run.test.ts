import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AllowanceRefused } from '@stellar-allowance/sdk';
import type { DemoEvent } from '../lib/demo/events';
import { runDemo, type Deps } from '../lib/demo/run';

const wants = {
  scheme: 'exact',
  network: 'stellar:testnet',
  amount: '100000',
  asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  payTo: 'GA4ND56VAGBNNSAEAKS2KYW6OZTUTOQ6MVLSQEXW4PV35LXUH3VTXJWV',
  maxTimeoutSeconds: 300,
  extra: { areFeesSponsored: true },
};

function fakeDeps(): Deps & { calls: string[] } {
  const calls: string[] = [];
  let paid = 0;
  return {
    calls,
    fund: async () => {
      calls.push('fund');
    },
    trustline: async () => {
      calls.push('trustline');
    },
    swap: async () => {
      calls.push('swap');
      return '1.9034';
    },
    seller: async () => {
      calls.push('seller');
      return { url: 'https://s/api', wants };
    },
    deploy: async () => {
      calls.push('deploy');
      return { id: 'CALLOW', index: 0 };
    },
    pay: async () => {
      calls.push('pay');
      paid += 1;
      if (paid === 3) throw new AllowanceRefused(106, 'Error(Contract, #106)');
      return { hash: `h${paid}`, payer: 'CALLOW' };
    },
    refuse: async () => {
      calls.push('refuse');
      return new AllowanceRefused(102, 'Error(Contract, #102)');
    },
  };
}

test('the run resolves every step, in order, with both refusals where the story puts them', async () => {
  const deps = fakeDeps();
  const events: DemoEvent[] = [];
  for await (const e of runDemo(deps)) events.push(e);

  const done = events.filter((e) => e.state !== 'started');
  assert.deepEqual(
    done.map((e) => `${e.id}:${e.state}`),
    ['fund:done', 'trustline:done', 'swap:done', 'deploy:done', 'pay-1:done', 'stranger:refused', 'pay-2:done', 'pay-3:refused'],
  );
  assert.equal(done.find((e) => e.id === 'stranger')?.rule, 'allowlist');
  assert.equal(done.find((e) => e.id === 'pay-3')?.rule, 'window');
  assert.deepEqual(deps.calls, ['fund', 'trustline', 'swap', 'seller', 'deploy', 'pay', 'refuse', 'pay', 'pay']);
});

test('a step that throws ends the run with a failed event and nothing after it', async () => {
  const deps = fakeDeps();
  deps.swap = async () => {
    throw new Error('friendbot returned 429');
  };
  const events: DemoEvent[] = [];
  for await (const e of runDemo(deps)) events.push(e);

  const last = events.at(-1)!;
  assert.equal(last.id, 'swap');
  assert.equal(last.state, 'failed');
  assert.match(last.sub!, /429/);
  assert.ok(!events.some((e) => e.id === 'deploy'));
});

test('the baked run carries the same steps the generator emits, in the same order', async () => {
  // The page opens on a recording, and a recording is a copy. This is what makes it a stale one:
  // rename a step or change what it does and the file on disk still says the old thing, on the
  // first screen, until someone re-bakes. Titles and order are compared because those are what a
  // reader sees before pressing anything.
  // From test-dist/test back to the source tree: the recording the page imports, not a copy.
  const path = join(__dirname, '../../lib/demo/baked.json');
  const baked = JSON.parse(readFileSync(path, 'utf8')) as { events: DemoEvent[] };

  const events: DemoEvent[] = [];
  for await (const e of runDemo(fakeDeps())) events.push(e);
  const emitted = [...new Map(events.map((e) => [e.id, e])).values()];

  assert.deepEqual(
    baked.events.map((e) => `${e.id}:${e.title}`),
    emitted.map((e) => `${e.id}:${e.title}`),
  );
});
