import { Keypair, Networks, contract } from '@stellar/stellar-sdk';
import { generateAllowanceSalt } from '@stellar-allowance/sdk';
import { USDC_SAC, WASM_HASH } from '../demo/params';
import { RPC_URL } from './read';

/** Freighter's signer satisfies this, and so does a Keypair, which is how tests drive it. */
export interface Signing {
  owner: string;
  signTransaction: contract.ClientOptions['signTransaction'];
}

export interface Rules {
  allowlist: string[];
  cap: bigint;
  windowLedgers: number;
}

/** Only what the owner touched. Everything left out keeps whatever the contract already holds. */
export interface Changes {
  name?: string;
  rules?: Rules;
  deposit?: bigint;
}

const onChain = (rules: Rules) => ({
  allowlist: rules.allowlist,
  window_cap: rules.cap,
  window_ledgers: rules.windowLedgers,
});

const options = (signing: Signing) => ({
  networkPassphrase: Networks.TESTNET,
  rpcUrl: RPC_URL,
  publicKey: signing.owner,
  signTransaction: signing.signTransaction,
});

const hashOf = (sent: { getTransactionResponse?: { txHash?: string } }) =>
  sent.getTransactionResponse?.txHash ?? '';

/**
 * Deploy and fund in one signature.
 *
 * The constructor pulls the deposit from the owner inside the same invocation, so an allowance
 * cannot exist in the half-made state where it looks ready and refuses everything. The agent's
 * keypair is made here, in the owner's browser, and its secret is shown once and never stored.
 */
export async function createAllowance(
  signing: Signing,
  index: number,
  name: string,
  deposit: bigint,
  rules: Rules,
): Promise<{ id: string; secret: string; hash: string }> {
  const agent = Keypair.random();
  const deployment = await contract.Client.deploy(
    {
      setup: {
        owner: signing.owner,
        agent_key: agent.rawPublicKey(),
        name,
        spending: { token: USDC_SAC, initial_deposit: deposit },
        rules: onChain(rules),
      },
    },
    { ...options(signing), wasmHash: WASM_HASH, salt: generateAllowanceSalt(signing.owner, index) },
  );
  const sent = await deployment.signAndSend();
  return {
    id: sent.result.options.contractId,
    secret: agent.secret(),
    hash: hashOf(sent),
  };
}

interface OnChainRules {
  allowlist: string[];
  window_cap: bigint;
  window_ledgers: number;
}

// A Client builds its methods from the deployed contract's own spec, at runtime, so the owner
// surface has to be written down somewhere for the compiler. Here is that somewhere, and it is
// the whole of it: nothing else about an allowance can be changed after it exists.
interface AllowanceClient {
  write(args: {
    name?: string;
    rules?: OnChainRules;
    deposit: bigint;
  }): Promise<contract.AssembledTransaction<unknown>>;
  withdraw(args: { amount: bigint; to?: string }): Promise<contract.AssembledTransaction<unknown>>;
  enable(): Promise<contract.AssembledTransaction<unknown>>;
  disable(): Promise<contract.AssembledTransaction<unknown>>;
}

const clientFor = async (id: string, signing: Signing): Promise<AllowanceClient> =>
  (await contract.Client.from({ ...options(signing), contractId: id })) as unknown as AllowanceClient;

/**
 * One signature for everything the owner changed.
 *
 * The contract reads an absent field as leave it alone rather than clear it, so renaming,
 * re-rulings and topping up arrive together and the owner approves once.
 */
export async function saveAllowance(
  id: string,
  signing: Signing,
  changes: Changes,
): Promise<string> {
  const client = await clientFor(id, signing);
  const tx = await client.write({
    name: changes.name,
    rules: changes.rules && onChain(changes.rules),
    deposit: changes.deposit ?? 0n,
  });
  return hashOf(await tx.signAndSend());
}

/** Always back to the owner. The contract would take a destination; the interface does not ask. */
export async function withdrawFrom(id: string, signing: Signing, amount: bigint): Promise<string> {
  const client = await clientFor(id, signing);
  const tx = await client.withdraw({ amount, to: undefined });
  return hashOf(await tx.signAndSend());
}

/** Stops or restarts the agent. Moves no money, so it cannot fail over a balance. */
export async function setEnabled(id: string, signing: Signing, enabled: boolean): Promise<string> {
  const client = await clientFor(id, signing);
  const tx = enabled ? await client.enable() : await client.disable();
  return hashOf(await tx.signAndSend());
}
