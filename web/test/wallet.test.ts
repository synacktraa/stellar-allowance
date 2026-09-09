import assert from 'node:assert/strict';
import test from 'node:test';
import { Networks } from '@stellar/stellar-sdk';
import { resume, signWith, suggestDefaults, type Freighter } from '../lib/dashboard/wallet';
import { toBase } from '../lib/demo/params';

const OWNER = 'GDMZZTTZHDUMLPWC5AQLAKZZCPZRZGZCJ4QVM4O3VZLRO6EGTDZJSJLT';

const wallet = (over: Partial<Freighter> = {}): Freighter => ({
  isConnected: async () => ({ isConnected: true }),
  isAllowed: async () => ({ isAllowed: true }),
  getAddress: async () => ({ address: OWNER }),
  getNetwork: async () => ({ network: 'TESTNET', networkPassphrase: Networks.TESTNET }),
  requestAccess: async () => ({ address: OWNER }),
  ...over,
});

test('an approval this browser already granted is read back without a prompt', async () => {
  let prompted = false;
  const address = await resume(
    wallet({
      requestAccess: async () => {
        prompted = true;
        return { address: OWNER };
      },
    }),
  );
  assert.equal(address, OWNER);
  assert.equal(prompted, false, 'resuming must not ask for access again');
});

test('nothing to resume when the extension is absent', async () => {
  assert.equal(await resume(wallet({ isConnected: async () => ({ isConnected: false }) })), null);
});

test('nothing to resume when this site was never approved', async () => {
  assert.equal(await resume(wallet({ isAllowed: async () => ({ isAllowed: false }) })), null);
});

test('an approved wallet on the wrong network says so rather than loading', async () => {
  await assert.rejects(
    resume(
      wallet({
        getNetwork: async () => ({ network: 'PUBLIC', networkPassphrase: Networks.PUBLIC }),
      }),
    ),
    /PUBLIC/,
  );
});

test('a wallet that refuses to sign says why, rather than returning an empty envelope', async () => {
  const sign = signWith(async () => ({
    signedTxXdr: '',
    signerAddress: '',
    error: { code: -4, message: 'User declined access' },
  }));
  await assert.rejects(sign('AAAAAg=='), /User declined access/);
});

test('a signature that succeeds is handed on untouched', async () => {
  const sign = signWith(async () => ({ signedTxXdr: 'AAAAsigned', signerAddress: OWNER }));
  assert.equal((await sign('AAAAAg==')).signedTxXdr, 'AAAAsigned');
});

test('the new-allowance form suggests a cap the wallet can actually reach', () => {
  // Five is the number worth guarding; a wallet holding less than that gets its own balance,
  // because a cap above the balance is a rule that can never bind.
  assert.deepEqual(suggestDefaults('100'), { deposit: '20', cap: '5' });
  assert.deepEqual(suggestDefaults('17.0898550'), { deposit: '17.089855', cap: '5' });
  assert.deepEqual(suggestDefaults('6'), { deposit: '6', cap: '5' });
  assert.deepEqual(suggestDefaults('3'), { deposit: '3', cap: '3' });
});

test('a wallet with no USDC is suggested the same numbers, not zeros', () => {
  // Zero in both fields reads as a broken form. The deploy is what says the wallet holds no
  // USDC, and it says so in words.
  assert.deepEqual(suggestDefaults(undefined), { deposit: '20', cap: '5' });
  assert.deepEqual(suggestDefaults('0'), { deposit: '20', cap: '5' });
});

test('a suggestion is always something toBase will take', () => {
  // String(1e-7) is '1e-7', which the amount parser refuses. Every suggestion goes through the
  // parser the form will hand it to.
  for (const held of ['100', '17.0898550', '6', '3', '0.0000001', '0', undefined]) {
    const { deposit, cap } = suggestDefaults(held);
    assert.doesNotThrow(() => toBase(deposit), `deposit for ${held}`);
    assert.doesNotThrow(() => toBase(cap), `cap for ${held}`);
  }
});
