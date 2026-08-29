'use client';

import { isUnlimited, LEDGERS_PER_MINUTE } from '@/lib/rules';

/**
 * The agent accounts an owner has, one row each.
 *
 * A row is one agent keypair and the contract that holds its money. Two balances, because they
 * are different things and confusing them wastes an afternoon: **XLM** is the agent's own, for
 * transaction fees, and running out of it stops the agent in a way that looks like a refusal.
 * **Credits** are the USDC in the contract, which the agent can ask to spend and never holds.
 *
 * No contract ids and no public keys. They identify nothing to a person — choosing between two
 * of them is guesswork — and everything that needs one is behind the row.
 */

export type AgentRow = {
  contract_id: string;
  agent_address: string;
  name: string | null;
  /** The agent's own XLM, for fees. Null when the account does not exist yet. */
  xlm: number | null;
  /** USDC in the contract. Null when the chain could not be read. */
  balance: string | null;
  revoked: boolean | null;
  rules: {
    max_per_call: string;
    window_cap: string;
    window_ledgers: number;
    allowlist: string[];
  } | null;
  /** The names of the APIs it may pay, already resolved. */
  can_pay: string[];
};

const usdc = (stroops: string | null) => (stroops === null ? '—' : (Number(stroops) / 1e7).toFixed(2));

/** Two names and a count. A list of five APIs in a table cell is a wall, not information. */
function summarise(names: string[]): string {
  if (names.length === 0) return 'nothing yet';
  const shown = names.slice(0, 2).join(', ');
  const rest = names.length - 2;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

function rateLimit(rules: AgentRow['rules']): string {
  if (!rules) return '—';
  if (isUnlimited(rules.window_cap)) return 'none';
  const minutes = Math.round(rules.window_ledgers / LEDGERS_PER_MINUTE);
  return `${(Number(rules.window_cap) / 1e7).toFixed(2)} / ${minutes} min`;
}

export function AgentTable({
  agents,
  onOpen,
}: {
  agents: AgentRow[];
  onOpen: (agent: AgentRow) => void;
}) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-[color:var(--line)]">
            <th className="label text-left font-normal px-4 py-3 whitespace-nowrap">name</th>
            <th className="label text-right font-normal px-4 py-3 whitespace-nowrap">xlm</th>
            <th className="label text-right font-normal px-4 py-3 whitespace-nowrap">credits</th>
            <th className="label text-left font-normal px-4 py-3 whitespace-nowrap">can pay</th>
            <th className="label text-left font-normal px-4 py-3 whitespace-nowrap">rate limit</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => {
            const stopped = agent.revoked === true;
            // A stopped agent recedes, but its controls do not — turning it back on is the thing
            // you most likely came to do.
            const faded = stopped ? { opacity: 0.5 } : undefined;
            // XLM is a fee balance, not spending money. Low means the agent stops working, and
            // that failure reads as a refusal unless it is called out here.
            const dry = agent.xlm !== null && agent.xlm < 1;

            return (
              <tr
                key={agent.contract_id}
                onClick={() => onOpen(agent)}
                className="border-b border-[color:var(--line)] last:border-0 cursor-pointer hover:bg-[color:var(--panel-2)]"
              >
                <td className="px-4 py-3 whitespace-nowrap" style={faded}>
                  <span>{agent.name ?? 'unnamed'}</span>
                  {stopped && (
                    <span
                      className="chip ml-2 px-1.5 py-0.5 align-middle"
                      style={{ borderColor: 'var(--drained)', color: 'var(--drained)' }}
                    >
                      stopped
                    </span>
                  )}
                </td>

                <td
                  className="px-4 py-3 num text-right whitespace-nowrap"
                  style={{ ...faded, color: dry ? 'var(--drained)' : undefined }}
                  title={dry ? 'too little XLM to pay transaction fees' : undefined}
                >
                  {agent.xlm === null ? '—' : agent.xlm.toFixed(2)}
                </td>

                <td
                  className="px-4 py-3 num text-right whitespace-nowrap"
                  style={{ ...faded, color: 'var(--accent)' }}
                >
                  {usdc(agent.balance)}
                </td>

                <td className="px-4 py-3 max-w-[260px] truncate" style={faded} title={agent.can_pay.join(', ')}>
                  {summarise(agent.can_pay)}
                </td>

                <td className="px-4 py-3 num whitespace-nowrap" style={faded}>
                  {rateLimit(agent.rules)}
                </td>

                <td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                  <button onClick={() => onOpen(agent)} className="chip px-3 py-1.5 cursor-pointer">
                    open
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
