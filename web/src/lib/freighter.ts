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
export type Proof = { address: string; nonce: string; signed: string };

/**
 * Proves the connected address is yours, by signing a challenge transaction.
 *
 * The transaction has sequence number zero, which no real transaction ever has, so the network
 * could never accept it however it is signed. That is the SEP-10 pattern, and it is the standard
 * way to prove an account on Stellar.
 *
 * An earlier version asked the wallet to sign a readable *message* instead. Freighter hands that
 * to its extension as an opaque blob and signs something no reconstruction here could reproduce —
 * forty-eight combinations of payload and encoding all failed to verify. A transaction has one
 * canonical hash that both sides compute with the same library, so there is nothing to guess.
 */
export async function proveAddress(address: string): Promise<Proof> {
  const issued = await fetch('/api/auth/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!issued.ok) throw new Error('Could not start the signature.');
  const { nonce, transaction } = await issued.json();

  const result = await signTransaction(transaction, {
    networkPassphrase: PASSPHRASE,
    address,
  });
  if (result.error) throw signingError(result.error);

  return { address, nonce, signed: result.signedTxXdr };
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

/**
 * Whatever Freighter just said, as a sentence.
 *
 * It reports failures as an object about as often as a string, and `new Error(someObject)`
 * stringifies to the literal text "[object Object]" — which is what a declined signature used to
 * show the user, in red, with no other explanation.
 */
function freighterMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const shaped = error as { message?: unknown };
    if (typeof shaped.message === 'string' && shaped.message !== '') return shaped.message;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Freighter refused, without saying why.';
    }
  }
  return String(error);
}

/**
 * Declining a prompt is the commonest thing that happens here, and it is not a fault. Freighter
 * words it differently across versions, so this matches the family rather than one string.
 */
function signingError(error: unknown): Error {
  const message = freighterMessage(error);
  if (/reject|declin|denied|cancel/i.test(message)) {
    return new Error('You declined the signature in Freighter. Nothing was sent.');
  }
  return new Error(message);
}

/**
 * The inclusion fee bid, in stroops.
 *
 * Deliberately small, because **this is the number Freighter shows the user.** Soroban adds the
 * measured resource fee to it during simulation, and charges only what the transaction actually
 * uses — but the wallet displays the total bid. Bidding 2 XLM made creating an allowance look
 * like it cost 2.02 XLM when the ledger charged 0.02, which is a frightening number to show
 * somebody for no benefit. 10,000 stroops is a hundred times the network minimum.
 */
const INCLUSION_FEE = '10000';

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
  if (signed.error) throw signingError(signed.error);

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
    fee: INCLUSION_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(built);
  return signAndSubmit(address, prepared, method);
}

/** The four numbers and the list that decide what an agent may do. */
export type RuleSet = {
  maxPerCall: bigint;
  windowLedgers: number;
  windowCap: bigint;
  allowlist: string[];
};

function rulesScVal(rules: RuleSet): xdr.ScVal {
  return nativeToScVal(
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
  );
}

/** Soroban `Option<T>`: a present value, or void for `None`. */
function option<T>(value: T | undefined, encode: (v: T) => xdr.ScVal): xdr.ScVal {
  return value === undefined ? xdr.ScVal.scvVoid() : encode(value);
}

/**
 * Creates an allowance and funds it, in one signature.
 *
 * The owner deploys it themselves. That is not a detail — it is the whole reason this is one
 * confirmation rather than two. A deploy runs the contract's constructor inside the same
 * invocation, and Stellar allows a transaction carrying a Soroban call to carry nothing else,
 * so this is the only shape in which creating, naming the agent, setting the rules, moving the
 * USDC and funding the agent's account can happen together.
 *
 * The agent's account does not need to exist first. The constructor sends it XLM through the
 * native asset contract, which brings the account into being — verified on testnet, because the
 * local test harness uses a stand-in asset that need not behave the same way.
 *
 * Returns the new contract id, read back from the transaction rather than predicted: the address
 * depends on a random salt, and guessing it client-side would be a second place to be wrong.
 */
export async function deployAllowance(
  address: string,
  params: { wasm_hash: string; token: string; native: string },
  setup: { agent: string; rules: RuleSet; usdcIn: bigint; xlmToAgent: bigint },
): Promise<string> {
  const server = new rpc.Server(RPC_URL);
  const account = await server.getAccount(address);

  const built = new TransactionBuilder(account, {
    fee: INCLUSION_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.createCustomContract({
        address: Address.fromString(address),
        wasmHash: Buffer.from(params.wasm_hash, 'hex'),
        // A fresh salt, so two allowances created with identical settings still get distinct
        // addresses rather than colliding.
        salt: Buffer.from(crypto.getRandomValues(new Uint8Array(32))),
        constructorArgs: [
          nativeToScVal(address, { type: 'address' }),
          nativeToScVal(params.token, { type: 'address' }),
          nativeToScVal(params.native, { type: 'address' }),
          nativeToScVal(setup.agent, { type: 'address' }),
          rulesScVal(setup.rules),
          nativeToScVal(setup.usdcIn, { type: 'i128' }),
          nativeToScVal(setup.xlmToAgent, { type: 'i128' }),
        ],
      }),
    )
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(built);
  const hash = await signAndSubmit(address, prepared, 'Creating the allowance');

  const result = await server.getTransaction(hash);
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS || !result.returnValue) {
    throw new Error('The allowance was created but its address could not be read.');
  }
  return Address.fromScAddress(result.returnValue.address()).toString();
}

/**
 * Everything the owner changes afterwards, in one signature.
 *
 * Undefined means *leave it alone* and is sent as Soroban's `None`. That distinction carries
 * real weight: a save that only added credits must not arrive carrying an allowlist, or it would
 * overwrite the real one with whatever the form happened to be holding.
 *
 * Amounts are additive. `usdcIn` adds to the balance; it does not set it.
 */
export function write(
  address: string,
  contractId: string,
  changes: { rules?: RuleSet; usdcIn?: bigint; xlmToAgent?: bigint },
) {
  return ownerCall(address, contractId, 'write', [
    option(changes.rules, rulesScVal),
    nativeToScVal(changes.usdcIn ?? 0n, { type: 'i128' }),
    nativeToScVal(changes.xlmToAgent ?? 0n, { type: 'i128' }),
  ]);
}

/**
 * Takes USDC back out, to the owner.
 *
 * There is no destination to pass. Freighter renders a Soroban call as a contract invocation
 * rather than a legible payment, so signing one was never meaningful review of where the money
 * was going — and this is one of only two ways money leaves the contract.
 */
export function withdraw(address: string, contractId: string, stroops: bigint) {
  return ownerCall(address, contractId, 'withdraw', [
    nativeToScVal(stroops, { type: 'i128' }),
  ]);
}

/**
 * Stops the agent spending. Immediate and total.
 *
 * Moves no money, so it cannot fail for balance reasons — which is what you want from the
 * control you reach for when something has gone wrong.
 */
export function revoke(address: string, contractId: string) {
  return ownerCall(address, contractId, 'revoke', []);
}

/**
 * Lets it spend again.
 *
 * A brake you cannot release is not a brake. Without this, undoing a stop meant creating a new
 * allowance, handing the agent a new key and moving the money across — three steps to reverse
 * one click.
 */
export function resume(address: string, contractId: string) {
  return ownerCall(address, contractId, 'resume', []);
}
