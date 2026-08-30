/**
 * Environment access.
 *
 * Every value is read through `required()` so a missing variable fails at startup with the
 * name of what is missing, rather than surfacing later as an undefined passed into the
 * Stellar SDK and a stack trace about XDR.
 */

import { Asset } from '@stellar/stellar-sdk';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export const env = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseServiceKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),

  rpcUrl: () => required('STELLAR_RPC_URL'),
  horizonUrl: () => required('HORIZON_URL'),
  networkPassphrase: () => required('STELLAR_NETWORK_PASSPHRASE'),
  usdcSac: () => required('USDC_SAC'),

  /**
   * The native XLM asset contract, derived rather than configured.
   *
   * An allowance funds its agent's account by calling this, and it is a deterministic function
   * of the network — so making it an environment variable would only create a way for it to be
   * wrong on one deployment and right on another.
   */
  nativeSac: () => Asset.native().contractId(required('STELLAR_NETWORK_PASSPHRASE')),

  platformAddress: () => required('PLATFORM_ADDRESS'),
  platformSecret: () => required('PLATFORM_SECRET'),

  demoAgentSecret: () => required('DEMO_AGENT_SECRET'),

  // Both wasm binaries are uploaded once; every API and every user gets a cheap instance
  // created from the same hash rather than a fresh upload.
  splitterWasmHash: () => required('SPLITTER_WASM_HASH'),
  allowanceWasmHash: () => required('ALLOWANCE_WASM_HASH'),

  platformFeeBps: () => Number(process.env.PLATFORM_FEE_BPS ?? '1000'),
} as const;
