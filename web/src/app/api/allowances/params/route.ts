import { env } from '@/lib/env';

/**
 * What a browser needs in order to deploy an allowance itself.
 *
 * The owner's wallet now builds and signs the deploy, which is what collapses creating and
 * funding into one confirmation. To build it, the client needs three values it cannot invent:
 * which binary to instantiate, and the two asset contracts the constructor moves money through.
 *
 * None of them are secret — the wasm hash and both asset contracts are public ledger facts, and
 * anyone can read them off the chain already. They are served rather than inlined at build time
 * so there is exactly one place that decides which binary is current. Baking them into the
 * bundle would mean a rebuild every time the contract changes, and a stale tab deploying the
 * previous version.
 */
export async function GET() {
  return Response.json({
    wasm_hash: env.allowanceWasmHash(),
    token: env.usdcSac(),
    native: env.nativeSac(),
    network_passphrase: env.networkPassphrase(),
  });
}
