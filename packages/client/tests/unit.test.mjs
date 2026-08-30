/**
 * The parts that can be decided without a network.
 *
 * Everything here is a pure function on purpose. Choosing which allowance to ask, and turning a
 * contract's error code into a sentence, are the two places this package makes a real decision —
 * and both are testable in microseconds if they are kept away from the chain.
 *
 *   npm test        (builds first — these run against dist/)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AllowanceRefused, chooseAllowance, originOf, refusalFrom } from '../dist/index.js';

describe('finding the gateway', () => {
  it('takes the origin of the paid URL', () => {
    assert.equal(originOf('https://pay.example.com/api/pay/abc123?text=hi'), 'https://pay.example.com');
    assert.equal(originOf('http://localhost:3000/api/pay/abc'), 'http://localhost:3000');
  });

  it('keeps a non-standard port', () => {
    assert.equal(originOf('https://example.com:8443/api/pay/abc'), 'https://example.com:8443');
  });

  it('does not guess at the path', () => {
    // The origin is the only part of a URL safe to derive. A gateway behind a base path, or a
    // proxy that rewrites, would break anything that assumed `/api/pay/<id>`.
    assert.equal(originOf('https://example.com/gateway/v2/pay/abc'), 'https://example.com');
  });

  it('refuses something that is not a URL', () => {
    assert.throws(() => originOf('not a url'), /valid URL/);
  });
});

describe('reading a refusal', () => {
  const cases = [
    ['#4', 'stopped'],
    ['#5', 'per-call'],
    ['#6', 'allowlist'],
    ['#7', 'rate-limit'],
    ['#8', 'history-full'],
    ['#10', 'empty'],
  ];

  for (const [code, rule] of cases) {
    it(`${code} is ${rule}`, () => {
      const refusal = refusalFrom(`HostError: Error(Contract, ${code}) ...`);
      assert.equal(refusal?.rule, rule);
      assert.ok(refusal.message.length > 0, 'and says so in words');
    });
  }

  it('does not read #10 as #1', () => {
    // The obvious implementation is /#1/.test(detail), which matches inside "#10" and reports
    // the wrong rule with total confidence.
    assert.equal(refusalFrom('Error(Contract, #10)').rule, 'empty');
  });

  it('returns null for something that is not a contract refusal', () => {
    assert.equal(refusalFrom('connect ECONNREFUSED 127.0.0.1:8000'), null);
  });
});

describe('choosing which allowance to ask', () => {
  const forSeller = {
    contract_id: 'CAAA',
    rules: { allowlist: ['CSELLER'] },
  };
  const forOther = {
    contract_id: 'CBBB',
    rules: { allowlist: ['CELSEWHERE'] },
  };

  it('picks the only one when there is only one', () => {
    assert.equal(chooseAllowance([forSeller], 'CSELLER').contract_id, 'CAAA');
  });

  it('picks by who is being paid when an agent has several', () => {
    // Nothing stops two allowances naming the same agent key. The 402 says who it wants paid,
    // and exactly one allowance is allowed to pay them.
    assert.equal(chooseAllowance([forOther, forSeller], 'CSELLER').contract_id, 'CAAA');
  });

  it('returns null when none of them may pay that recipient', () => {
    assert.equal(chooseAllowance([forOther], 'CSELLER'), null);
  });

  it('returns null when the agent has no allowances at all', () => {
    assert.equal(chooseAllowance([], 'CSELLER'), null);
  });
});

describe('AllowanceRefused', () => {
  it('carries the rule that stopped it, so it can be caught by name', () => {
    const error = new AllowanceRefused('allowlist', 'nope');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'AllowanceRefused');
    assert.equal(error.rule, 'allowlist');
  });
});
