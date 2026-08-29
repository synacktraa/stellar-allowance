import { Transaction, rpc } from '@stellar/stellar-sdk';
import { server } from './stellar';
import { db } from './supabase';

/**
 * Delivering on the network's acceptance rather than the ledger's.
 *
 * A ledger closes about every five seconds and nothing changes that. But *waiting* for one is a
 * choice, and this is the code that declines to. The gateway simulates the agent's transaction
 * itself — the allowance's rules run during simulation, so a refusal is known immediately —
 * submits it, and answers once the network has taken it.
 *
 * This is card authorization. The shop hands over the coffee at auth, not at settlement, and
 * accepts a small, bounded, measurable risk of never being paid for that one cup.
 *
 * The risk here: simulation reads state *now* and the ledger applies it about five seconds
 * later. Two purchases in flight from one agent can both see the same headroom and only one can
 * have it; an owner can revoke inside the gap. Either way the developer served one call for
 * nothing, so the outcome is recorded and an agent whose transactions bounce goes back to
 * waiting like everybody else.
 */

/** How long a demotion lasts. Long enough to matter, short enough to heal without anyone's help. */
const DEMOTION_MINUTES = 60;

/** The contract's error codes, in words, so a refusal says which rule refused it. */
export function ruleFor(detail: string): string {
  if (/#4/.test(detail)) return 'the agent has been revoked';
  if (/#5/.test(detail)) return 'over the per-call cap';
  if (/#6/.test(detail)) return 'the recipient is not on the allowlist';
  if (/#7/.test(detail)) return 'over the window cap';
  if (/#10/.test(detail)) return 'the allowance is empty';
  return detail.split('\n')[0].slice(0, 120);
}

export type SubmitResult =
  | { ok: true; hash: string }
  | { ok: false; reason: 'refused_by_the_allowance' | 'not_submitted'; detail: string };

/**
 * Checks the transaction for ourselves, then puts it on the network.
 *
 * The agent has already simulated this — it had to, to build the footprint — but that result is
 * a claim by the sender and claims are not evidence. Simulating again is the whole basis for
 * answering early, and it costs about half a second.
 *
 * Submission matters as much as simulation. `PENDING` means the network validated the signature,
 * the sequence number and the fee and has taken the transaction; simulation checks none of those.
 * Delivering on a simulation alone would hand out goods for a transaction that could never have
 * been submitted at all.
 */
export async function simulateAndSubmit(transaction: Transaction): Promise<SubmitResult> {
  const rpcServer = server();

  const simulation = await rpcServer.simulateTransaction(transaction);
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    const detail = 'error' in simulation ? String(simulation.error) : 'simulation failed';
    return { ok: false, reason: 'refused_by_the_allowance', detail: ruleFor(detail) };
  }

  const sent = await rpcServer.sendTransaction(transaction);
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
    return { ok: false, reason: 'not_submitted', detail: sent.status };
  }

  return { ok: true, hash: sent.hash };
}

/**
 * Has this agent's optimism gone wrong recently?
 *
 * Demotion rather than a ban: the agent keeps buying, it just waits for the ledger like everyone
 * did before. It lifts itself after an hour, because the usual cause is two purchases racing
 * rather than anything an agent chose to do.
 */
export async function isDemoted(agent: string): Promise<boolean> {
  const { data } = await db()
    .from('agent_reliability')
    .select('demoted_at')
    .eq('agent_address', agent)
    .maybeSingle<{ demoted_at: string | null }>();

  if (!data?.demoted_at) return false;
  return Date.now() - new Date(data.demoted_at).getTime() < DEMOTION_MINUTES * 60_000;
}

/**
 * Waits for the ledger to take a position, and writes down what it decided.
 *
 * Runs after the response has gone, so nobody is kept waiting for it. Without this the gateway
 * would have no idea how often its optimism is misplaced, which is exactly the number a
 * developer needs to decide whether to leave the switch on.
 */
export async function recordSettlement(hash: string, reference: string, agent: string) {
  const rpcServer = server();
  const deadline = Date.now() + 40_000;

  let result = await rpcServer.getTransaction(hash);
  while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await rpcServer.getTransaction(hash);
  }

  const settled = result.status === rpc.Api.GetTransactionStatus.SUCCESS;
  const supabase = db();

  await supabase.from('requests').update({ settled }).eq('reference', reference);

  const { data: existing } = await supabase
    .from('agent_reliability')
    .select('delivered, reverted')
    .eq('agent_address', agent)
    .maybeSingle<{ delivered: number; reverted: number }>();

  await supabase.from('agent_reliability').upsert(
    {
      agent_address: agent,
      delivered: Number(existing?.delivered ?? 0) + (settled ? 1 : 0),
      reverted: Number(existing?.reverted ?? 0) + (settled ? 0 : 1),
      // Cleared on a clean settlement, so the demotion is a response to what is happening now
      // rather than a record of what once did.
      demoted_at: settled ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'agent_address' },
  );
}
