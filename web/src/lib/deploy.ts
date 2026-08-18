import {
  Address,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { randomBytes } from 'node:crypto';
import { env } from './env';
import { platformKeypair, server } from './stellar';

/**
 * Creates a new contract instance from an already-uploaded wasm, running its constructor in
 * the same transaction.
 *
 * Uploading the binary and creating an instance are separate steps on Stellar. The CLI does
 * both at once, which is why deploying feels like one action — but the upload only has to
 * happen once per binary. Every API's splitter and every user's allowance is an instance
 * pointing at the same hash, which is what makes per-API and per-user contracts affordable.
 *
 * The constructor arguments matter more than they look. A separate `init` call would leave the
 * contract briefly unowned and unconfigured, and would need a signature from whoever it
 * belongs to — which means that person needs XLM before they can own anything. Passing them
 * here makes deployment atomic and keeps the user out of it entirely.
 *
 * The platform pays.
 */
export async function deployInstance(
  wasmHash: string,
  constructorArgs: xdr.ScVal[] = [],
): Promise<string> {
  const rpcServer = server();
  const signer = platformKeypair();
  const account = await rpcServer.getAccount(signer.publicKey());

  const built = new TransactionBuilder(account, {
    fee: '5000000',
    networkPassphrase: env.networkPassphrase(),
  })
    .addOperation(
      Operation.createCustomContract({
        address: Address.fromString(signer.publicKey()),
        wasmHash: Buffer.from(wasmHash, 'hex'),
        constructorArgs,
        // A fresh salt each time, so two APIs registered with identical settings still get
        // distinct contracts. Without it the derived address would collide.
        salt: randomBytes(32),
      }),
    )
    .setTimeout(60)
    .build();

  const prepared = await rpcServer.prepareTransaction(built);
  prepared.sign(signer);

  const sent = await rpcServer.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`deploy submit failed: ${JSON.stringify(sent.errorResult)}`);
  }

  let result = await rpcServer.getTransaction(sent.hash);
  const deadline = Date.now() + 30_000;
  while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) throw new Error(`deploy timed out (${sent.hash})`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await rpcServer.getTransaction(sent.hash);
  }

  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`deploy reverted (${sent.hash})`);
  }

  const contractId = result.returnValue ? scValToNative(result.returnValue) : null;
  if (typeof contractId !== 'string' || !contractId.startsWith('C')) {
    throw new Error(`deploy returned no contract id (${sent.hash})`);
  }

  return contractId;
}
