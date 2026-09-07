import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { STELLAR_TESTNET_CAIP2 } from '@x402/stellar';
import type { RpcConfig } from '@x402/stellar';
import type { Network } from '@x402/core/types';
import { ExactAllowanceScheme } from './scheme.js';
import { createAllowanceSigner } from './signer.js';

export interface AllowanceOptions {
  /** The allowance's contract id. Defaults to `STELLAR_ALLOWANCE_ID`. */
  id?: string;
  /** The agent's secret. Defaults to `STELLAR_ALLOWANCE_SECRET`. */
  secret?: string;
  /** A custom RPC. The public testnet RPC is the default. */
  rpc?: RpcConfig;
  /**
   * Which network the allowance is on, CAIP-2. Defaults to `stellar:testnet`.
   *
   * `stellar:pubnet` also needs `rpc.url`. SDF publishes an RPC for testnet and futurenet
   * but not for mainnet, so there is no default to fall back on.
   */
  network?: Network;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * An allowance an agent can spend from.
 *
 * The id says which allowance pays and the secret is the agent's proof it may ask. What a
 * stolen secret can spend is what the owner's rules allow, and those are checked on chain.
 */
export class Allowance {
  /** The allowance's contract id. */
  readonly address: string;
  /** Register this on an `x402Client` of your own instead of using `fetch`. */
  readonly scheme: ExactAllowanceScheme;
  /** `fetch`, with a 402 handled in the middle. A closure, so destructuring it works. */
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  constructor({ id, secret, rpc, network = STELLAR_TESTNET_CAIP2 }: AllowanceOptions = {}) {
    this.address = required(id ?? process.env.STELLAR_ALLOWANCE_ID, 'STELLAR_ALLOWANCE_ID');
    const agentSecret = required(
      secret ?? process.env.STELLAR_ALLOWANCE_SECRET,
      'STELLAR_ALLOWANCE_SECRET',
    );

    this.scheme = new ExactAllowanceScheme(
      createAllowanceSigner(this.address, agentSecret),
      rpc,
    );

    // One network, the caller's, so a seller cannot move an agent onto a chain nobody
    // opted into. The default is testnet, where the contract is meant to run.
    //
    // x402Client's spend controls default to USDC only and $1 a payment. An allowance
    // holds one token the owner chose and a window cap the owner set, both enforced by
    // the contract, and a client-side cap on top of them refuses payments the owner
    // allowed. They are off here.
    const client = new x402Client()
      .setSpendControls(false)
      .register(network, this.scheme);
    this.fetch = wrapFetchWithPayment(globalThis.fetch, client);
  }
}
