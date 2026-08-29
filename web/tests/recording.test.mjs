/**
 * The landing page replays a recording rather than spending money on every visitor.
 *
 * That trade is only honest if the recording is a real run and stays one. A JSON file is easy to
 * edit, and a plausible-looking number typed by hand would be indistinguishable from a measured
 * one — so these check the properties a real run cannot violate and a doctored one probably
 * would.
 *
 * No network, no chain, no server. This is the one suite that runs anywhere.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const run = JSON.parse(
  readFileSync(new URL('../src/lib/demo-run.json', import.meta.url), 'utf8'),
);

const HASH = /^[0-9a-f]{64}$/;
const stroops = (usdc) => BigInt(Math.round(Number(usdc) * 1e7));

describe('the recorded run', () => {
  it('names when and where it was recorded', () => {
    assert.match(run.recordedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(run.network, 'testnet');
    assert.ok(run.explorer.includes('{hash}'), 'receipts need somewhere to link to');
  });

  it('starts both sides level', () => {
    // The claim the whole page rests on. An unequal start measures the funding, not the rules,
    // and the live demo shipped that way more than once.
    assert.equal(
      run.start.wallet,
      run.start.allowance,
      'the two columns must begin with the same money',
    );
  });

  for (const side of ['wallet', 'allowance']) {
    describe(side, () => {
      const rows = run[side];

      it('has one row per attempt', () => {
        assert.equal(rows.length, run.attempts);
        assert.deepEqual(
          rows.map((r) => r.n),
          Array.from({ length: run.attempts }, (_, i) => i + 1),
        );
      });

      it('can prove every delivery', () => {
        for (const row of rows.filter((r) => r.delivered)) {
          assert.match(row.txHash, HASH, `attempt ${row.n} has no usable transaction hash`);
          assert.ok(row.body, `attempt ${row.n} delivered nothing`);
        }
      });

      it('says why every refusal happened', () => {
        for (const row of rows.filter((r) => !r.delivered)) {
          assert.ok(row.reason, `attempt ${row.n} was refused for no stated reason`);
          assert.ok(!row.txHash, `attempt ${row.n} was refused but carries a payment`);
        }
      });

      it('adds up', () => {
        // Start, minus the price times the deliveries, is what should be left. A figure typed by
        // hand almost certainly breaks this; a measured one cannot.
        const delivered = rows.filter((r) => r.delivered).length;
        const expected = stroops(run.start[side]) - BigInt(delivered) * stroops(run.price);
        const actual = stroops(rows[rows.length - 1].remaining);
        assert.equal(actual, expected, `${delivered} paid, but the closing balance disagrees`);
      });
    });
  }

  it('shows the two outcomes it exists to contrast', () => {
    const paid = (side) => run[side].filter((r) => r.delivered).length;
    assert.equal(paid('wallet'), run.attempts, 'nothing should have stopped the unprotected agent');
    assert.ok(paid('allowance') < run.attempts, 'a rule has to refuse something, or there is no story');

    const stopped = run.allowance.find((r) => !r.delivered);
    assert.ok(
      !/empty/.test(stopped.reason),
      'the allowance must be stopped by a rule, not by running out — that is the same failure as the other column',
    );
  });
});
