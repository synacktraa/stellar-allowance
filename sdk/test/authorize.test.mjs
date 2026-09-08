import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Address, Keypair, Networks, hash, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { createAllowanceSigner } from '../dist/index.js';
import { authorizeAllowanceEntries } from '../dist/authorize.js';

const ALLOWANCE = 'CC7C7SNKQ3R4LOMEFKVMJHK62ZAXC3BCHXV6DA6JY2VHIHWKQ6ATBZS6';
const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const SELLER = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

function unsignedEntry(from) {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(TOKEN).toScAddress(),
        functionName: 'transfer',
        args: [
          nativeToScVal(from, { type: 'address' }),
          nativeToScVal(SELLER, { type: 'address' }),
          nativeToScVal('1000', { type: 'i128' }),
        ],
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: invocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(from).toScAddress(),
        nonce: new xdr.Int64(1234),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVec([]),
      }),
    ),
  });
}

const signerFor = (allowance) => createAllowanceSigner(allowance, Keypair.random().secret());

test('signs the allowance entry and sets the expiration', async () => {
  const [entry] = await authorizeAllowanceEntries(
    [unsignedEntry(ALLOWANCE)], signerFor(ALLOWANCE), 4242, Networks.TESTNET,
  );

  const credentials = entry.credentials().address();
  assert.equal(credentials.signatureExpirationLedger(), 4242);
  assert.equal(credentials.signature().switch().name, 'scvBytes');
  assert.equal(credentials.signature().bytes().length, 64);
});

test('leaves entries belonging to someone else alone', async () => {
  const other = Keypair.random().publicKey();

  const [entry] = await authorizeAllowanceEntries(
    [unsignedEntry(other)], signerFor(ALLOWANCE), 4242, Networks.TESTNET,
  );

  assert.equal(entry.credentials().address().signature().vec().length, 0);
  assert.equal(entry.credentials().address().signatureExpirationLedger(), 0);
});

test('picks its own entry out of a list', async () => {
  const entries = [
    unsignedEntry(Keypair.random().publicKey()),
    unsignedEntry(ALLOWANCE),
    unsignedEntry(Keypair.random().publicKey()),
  ];

  const signed = await authorizeAllowanceEntries(
    entries, signerFor(ALLOWANCE), 4242, Networks.TESTNET,
  );

  assert.equal(signed.length, 3);
  assert.equal(signed[1].credentials().address().signature().switch().name, 'scvBytes');
  for (const i of [0, 2]) {
    assert.equal(signed[i].credentials().address().signature().vec().length, 0);
  }
});

test('signs over the payload the host will rebuild', async () => {
  const agent = Keypair.random();
  const signer = createAllowanceSigner(ALLOWANCE, agent.secret());

  const [entry] = await authorizeAllowanceEntries(
    [unsignedEntry(ALLOWANCE)], signer, 4242, Networks.TESTNET,
  );

  // The host hashes this preimage and hands the result to __check_auth as `payload`.
  const credentials = entry.credentials().address();
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(Networks.TESTNET)),
      nonce: credentials.nonce(),
      invocation: entry.rootInvocation(),
      signatureExpirationLedger: credentials.signatureExpirationLedger(),
    }),
  );
  const payload = hash(preimage.toXDR());

  assert.ok(agent.verify(payload, credentials.signature().bytes()));
});
