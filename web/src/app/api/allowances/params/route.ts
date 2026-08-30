import { env } from '@/lib/env';
import { MAX_BODY_BYTES } from '@/lib/limits';

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
    // For agents, not browsers. The client SDK is handed one secret and nothing else, so it
    // derives everything it needs from the paid URL it was asked to buy — including which
    // network to talk to and where. A public endpoint either way.
    rpc_url: env.rpcUrl(),

    // So the SDK can refuse an oversized body before anyone pays for it, rather than hardcoding
    // a number that would go stale in every published version the day this changes. The gateway
    // enforces it regardless — the SDK is not in the path when somebody uses curl.
    max_body_bytes: MAX_BODY_BYTES,
  });
}
