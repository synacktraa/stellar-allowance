'use client';

import {
  Address,
  Contract,
  Operation,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import {
  getAddress,
  getNetwork,
  isAllowed,
  isConnected,
  requestAccess,
  signMessage,
  signTransaction,
} from '@stellar/freighter-api';

/**
 * Owner actions, signed in the user's own wallet.
 *
 * Depositing and withdrawing move the user's money, so only they can authorise it. That is not
 * a limitation to work around — it is the reason the platform can be trusted with the rest.
 */

const RPC_URL = 'https://soroban-testnet.stellar.org';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const PASSPHRASE = 'Test SDF Network ; September 2015';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

/** What a signed request carries. No session, no cookie — proof travels with each action. */
export type Proof = { address: string; nonce: string; signature: string };

/**
 * Proves the connected address is yours, by signing a nonce the server issued.
 *
 * Costs nothing and touches no network: a message signature is not a transaction. The server
 * decides the exact text and rebuilds it from the stored nonce, so the wallet prompt shows
 * something a person can read rather than a string of noise to approve out of habit.
 */
export async function proveAddress(address: string): Promise<Proof> {
  const issued = await fetch('/api/auth/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!issued.ok) throw new Error('Could not start the signature.');
  const { nonce, message } = await issued.json();

  const result = await signMessage(message, { address });
  if (result.error) {
    throw new Error(String((result.error as { message?: string }).message ?? result.error));
  }

  return { address, nonce, signature: asBase64(result.signedMessage) };
}

/**
 * Freighter's signature has arrived in more than one shape across its versions — a base64
 * string, raw bytes, and a serialised Buffer. The server only ever wants base64, so the
 * normalising happens here rather than being guessed at on both sides.
 */
function asBase64(signed: unknown): string {
  if (typeof signed === 'string') return signed;

  const bytes =
    signed instanceof Uint8Array
      ? signed
      : signed && typeof signed === 'object' && Array.isArray((signed as { data?: number[] }).data)
        ? Uint8Array.from((signed as { data: number[] }).data)
        : null;

  if (!bytes) throw new Error('The wallet returned a signature in a shape this app cannot read.');
  return btoa(String.fromCharCode(...bytes));
}

export type Wallet = { address: string; network: string };

/** What the wallet can actually pay with. Absent means the account does not exist yet. */
export type Balances = { xlm: number; usdc: number; hasUsdcTrustline: boolean };

/**
 * Restores an existing connection without prompting.
 *
 * Freighter only shows its approval popup the first time. After that `requestAccess` resolves
 * silently — so a page that keeps the connection in component state shows a Connect button
 * that, when clicked, appears to do nothing. The fix is not to re-ask on click; it is to stop
 * forgetting across navigations in the first place.
 *
 * Returns null rather than throwing: not being connected yet is the ordinary case on first
 * visit, not an error worth showing anyone.
 */
export async function restore(): Promise<Wallet | null> {
  try {
    const installed = await isConnected();
    if (!installed.isConnected) return null;

    const allowed = await isAllowed();
    if (!allowed.isAllowed) return null;

    const address = await getAddress();
    if (address.error || !address.address) return null;

    const network = await getNetwork();
    if (network.error || network.network !== 'TESTNET') return null;

    return { address: address.address, network: network.network };
  } catch {
    return null;
  }
}

/**
 * What the connected wallet holds.
 *
 * Read before signing anything that spends, so an insufficient balance is named on screen
 * rather than surfacing as a reverted transaction whose error mentions neither the asset nor
 * the shortfall.
 */
export async function balances(address: string): Promise<Balances> {
  const response = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (!response.ok) return { xlm: 0, usdc: 0, hasUsdcTrustline: false };

  const account = await response.json();
  const lines: Array<Record<string, string>> = account.balances ?? [];

  const native = lines.find((b) => b.asset_type === 'native');
  const usdc = lines.find(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
  );

  return {
    xlm: Number(native?.balance ?? 0),
    usdc: Number(usdc?.balance ?? 0),
    hasUsdcTrustline: Boolean(usdc),
  };
}

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

/** Signs in Freighter, submits, and waits for the ledger to close. */
async function signAndSubmit(
  address: string,
  transaction: Transaction,
  describe: string,
): Promise<string> {
  const server = new rpc.Server(RPC_URL);

  const signed = await signTransaction(transaction.toXDR(), {
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
    throw new Error(`${describe} was rejected on chain.`);
  }

  return sent.hash;
}

/**
 * Builds, simulates, signs in Freighter, and submits a contract call.
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
  return signAndSubmit(address, prepared, method);
}

/**
 * Brings the agent's account into existence, paid for out of the owner's wallet.
 *
 * A faucet would be one line here, and would be a testnet-shaped hole in the product: on
 * mainnet nobody hands you a funded account, so the owner has to create the agent's. Doing it
 * the real way now means this step does not have to be rewritten to ship, and the owner sees
 * the true cost of running an agent — this XLM pays for the agent's own transaction fees, and
 * is the only asset it will ever hold.
 *
 * `createAccount` is a classic operation, so it needs no simulation: there is no contract to
 * run and no storage footprint to discover.
 */
export async function createAgentAccount(
  address: string,
  agentPublicKey: string,
  startingBalanceXlm: string,
): Promise<string> {
  const server = new rpc.Server(RPC_URL);
  const account = await server.getAccount(address);

  const built = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.createAccount({
        destination: agentPublicKey,
        startingBalance: startingBalanceXlm,
      }),
    )
    .setTimeout(120)
    .build();

  return signAndSubmit(address, built, 'Funding the agent');
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

/**
 * Replaces the rules on a live allowance.
 *
 * The spend window is deliberately not reset by this. If it were, an agent sitting at its cap
 * could be handed a fresh one by any edit — including an edit that lowers the cap.
 */
export function setRules(
  address: string,
  contractId: string,
  rules: {
    maxPerCall: bigint;
    windowLedgers: number;
    windowCap: bigint;
    allowlist: string[];
  },
) {
  return ownerCall(address, contractId, 'set_rules', [
    nativeToScVal(
      {
        max_per_call: rules.maxPerCall,
        window_ledgers: rules.windowLedgers,
        window_cap: rules.windowCap,
        allowlist: rules.allowlist.map((a) => Address.fromString(a)),
      },
      {
        type: {
          max_per_call: ['symbol', 'i128'],
          window_ledgers: ['symbol', 'u32'],
          window_cap: ['symbol', 'i128'],
          allowlist: ['symbol', null],
        },
      },
    ),
  ]);
}
