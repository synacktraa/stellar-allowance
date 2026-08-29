'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Which APIs this allowance may pay, named by their URL rather than their address.
 *
 * This replaces a list of every registered API with a checkbox beside each. Registration is open
 * and free, so anyone could appear in that list looking exactly as legitimate as everybody else,
 * and putting them in a menu implied a vetting nobody performs. Nothing but the owner's own
 * intent separates "an API I meant to use" from "an API someone registered hoping to be picked".
 *
 * Intent arrives with the URL: somebody handed it over, outside this app. So that is what is
 * asked for. The address is still what gets written to the contract — an address is all a
 * contract can check — but the owner never has to think in addresses, and the trust decision
 * stays where it actually happened.
 *
 * A paste resolves on its own. The button appears only once there is something to confirm,
 * because "add" is meaningless until you can see what you are adding.
 */

export type Allowed = {
  /** The address written to the contract. Identity here, because it is identity on chain. */
  splitter_contract_id: string;
  name: string;
  /** Absent for an entry read back off an existing allowance, where only the address is known. */
  price_stroops?: string;
  paid_url?: string;
};

const usdc = (stroops: string) => (Number(stroops) / 1e7).toFixed(2);
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function AllowlistInput({
  value,
  onChange,
  example,
}: {
  value: Allowed[];
  onChange: (next: Allowed[]) => void;
  /** A URL to try when you have not been given one yet. Absent once you have. */
  example?: { paid_url: string; name: string } | null;
}) {
  const [text, setText] = useState('');
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<Allowed | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Ignore an answer that arrives after a newer one. Typing a URL fires several lookups and they
  // do not necessarily come back in order.
  const latest = useRef(0);

  /**
   * Everything the new text implies, decided here rather than in the effect.
   *
   * Clearing the previous answer belongs with the keystroke that invalidated it — doing it in
   * the effect meant a synchronous setState on every render pass, and a cascade to go with it.
   */
  function type(next: string) {
    setText(next);
    setFound(null);
    setProblem(null);
    setLooking(next.trim().length >= 8);
  }

  useEffect(() => {
    const typed = text.trim();
    if (typed.length < 8) return;

    const attempt = ++latest.current;

    // Enough of a pause that it resolves once at the end of a paste rather than on every
    // keystroke of someone typing it out.
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/apis/resolve?url=${encodeURIComponent(typed)}`);
        const body = await response.json();
        if (attempt !== latest.current) return;

        if (!response.ok) {
          setProblem(body.error ?? 'That URL could not be resolved.');
        } else if (value.some((a) => a.splitter_contract_id === body.splitter_contract_id)) {
          setProblem(`${body.name} is already on the list.`);
        } else {
          setFound(body);
        }
      } catch {
        if (attempt === latest.current) setProblem('Could not reach the gateway.');
      } finally {
        if (attempt === latest.current) setLooking(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [text, value]);

  function add() {
    if (!found) return;
    onChange([...value, found]);
    type('');
  }

  return (
    <div>
      <label className="block mb-2">
        <span className="label block mb-1.5">which APIs may be paid</span>
        <input
          value={text}
          onChange={(e) => type(e.target.value)}
          placeholder="paste the paid URL the API gave you"
          spellCheck={false}
          className="w-full bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2.5 text-sm num"
        />
      </label>

      {/* One slot for whatever the box has to say, so the layout does not jump between states. */}
      <div className="min-h-[92px] mb-3">
        {looking && <p className="label pt-2">looking it up…</p>}

        {problem && !looking && (
          <p className="text-sm pt-2" style={{ color: 'var(--drained)' }}>
            {problem}
          </p>
        )}

        {found && !looking && (
          <div className="border border-[color:var(--line-bright)] bg-[color:var(--panel-2)] p-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm truncate">{found.name}</p>
              <p className="num text-xs text-[color:var(--faint)] truncate">
                {found.price_stroops ? `${usdc(found.price_stroops)} USDC / call · ` : ''}
                pays {short(found.splitter_contract_id)}
              </p>
            </div>
            <button
              onClick={add}
              className="chip chip-accent px-3 py-2 whitespace-nowrap cursor-pointer"
            >
              add
            </button>
          </div>
        )}

        {!looking && !problem && !found && example && value.length === 0 && (
          <p className="label pt-2 leading-relaxed">
            nothing to hand?{' '}
            <button
              onClick={() => type(example.paid_url)}
              className="underline cursor-pointer hover:text-[color:var(--accent)]"
            >
              try our {example.name}
            </button>{' '}
            — ours, and said so
          </p>
        )}
      </div>

      {/* What is on the list, and what it means. An empty list is a real state, not a missing
          one: the contract refuses everything, which is the right place to start. */}
      {value.length === 0 ? (
        <p className="label">
          nothing allowlisted yet — the contract would refuse every payment
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {value.map((api) => (
            <span
              key={api.splitter_contract_id}
              className="chip flex items-center gap-2"
              style={{ borderColor: 'var(--lavender)', color: 'var(--lavender)' }}
              title={api.splitter_contract_id}
            >
              {api.name}
              <button
                onClick={() =>
                  onChange(value.filter((a) => a.splitter_contract_id !== api.splitter_contract_id))
                }
                aria-label={`remove ${api.name}`}
                className="cursor-pointer opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
