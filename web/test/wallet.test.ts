import assert from 'node:assert/strict';
import test from 'node:test';
import { Networks } from '@stellar/stellar-sdk';
import { resume, signWith, type Freighter } from '../lib/dashboard/wallet';

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
