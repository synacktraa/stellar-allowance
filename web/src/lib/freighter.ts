'use client';

import {
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import {
  getAddress,
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api';

/**
 * Owner actions, signed in the user's own wallet.
 *
 * Depositing and withdrawing move the user's money, so only they can authorise it. That is not
 * a limitation to work around — it is the reason the platform can be trusted with the rest.
 */

const RPC_URL = 'https://soroban-testnet.stellar.org';
const PASSPHRASE = 'Test SDF Network ; September 2015';

export type Wallet = { address: string; network: string };

export async function connect(): Promise<Wallet> {
  const installed = await isConnected();
  if (!installed.isConnected) {
    throw new Error('Freighter is not installed.');
  }

  const access = await requestAccess();
  if (access.error) throw new Error(access.error);

  const network = await getNetwork();
  if (network.error) throw new Error(network.error);

  // A wrong network produces failures that look like bugs in this app, so catch it at connect.
  if (network.network !== 'TESTNET') {
    throw new Error(`Freighter is on ${network.network}. Switch it to Testnet.`);
  }

  const address = await getAddress();
  if (address.error) throw new Error(address.error);

  return { address: address.address, network: network.network };
}

/**
 * Builds, simulates, signs in Freighter, and submits.
 *
 * The simulate step is not optional. Without it the transaction carries no storage footprint
 * and no resource fee, and fails with an error that describes neither.
 */
async function ownerCall(
  address: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const server = new rpc.Server(RPC_URL);
  const account = await server.getAccount(address);

  const built = new TransactionBuilder(account, {
    fee: '2000000',
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(built);

  const signed = await signTransaction(prepared.toXDR(), {
    networkPassphrase: PASSPHRASE,
    address,
  });
  if (signed.error) throw new Error(signed.error);

  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signed.signedTxXdr, PASSPHRASE),
  );
  if (sent.status === 'ERROR') throw new Error('The network rejected the transaction.');

  let result = await server.getTransaction(sent.hash);
  const deadline = Date.now() + 45_000;
  while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the ledger to close.');
    await new Promise((r) => setTimeout(r, 1000));
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`${method} was reverted by the contract.`);
  }

  return sent.hash;
}

export function deposit(address: string, contractId: string, stroops: bigint) {
  return ownerCall(address, contractId, 'deposit', [
    nativeToScVal(address, { type: 'address' }),
    nativeToScVal(stroops, { type: 'i128' }),
  ]);
}

export function withdraw(address: string, contractId: string, stroops: bigint) {
  return ownerCall(address, contractId, 'withdraw', [
    nativeToScVal(address, { type: 'address' }),
    nativeToScVal(stroops, { type: 'i128' }),
  ]);
}

export function revoke(address: string, contractId: string) {
  return ownerCall(address, contractId, 'revoke', []);
}
