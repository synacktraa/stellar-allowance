'use client';

import { useEffect, useState } from 'react';

/**
 * The two runs, side by side.
 *
 * Same agent, same API, same number of attempts. The only difference is where the money sits,
 * so the columns are deliberately identical in every other respect — the contrast has to come
 * from the outcome, not from the presentation.
 */

type Row = {
  n: number;
  delivered: boolean;
  refused: boolean;
  reason?: string;
  amount?: string;
  status?: number;
  body?: string;
  txHash?: string;
  /** USDC left, in the place that holds it: the agent's wallet, or the contract. */
  remaining?: string;
  remainingLabel?: string;
};

const ATTEMPTS = 7;

function usdc(stroops?: string) {
  if (!stroops) return '—';
  return (Number(stroops) / 1e7).toFixed(2);
}

function Column({
  title, tag, rows, running, done, tone, verdict, holds, startedWith, rules,
}: {
  title: string;
  tag: string;
  rows: Row[];
  running: boolean;
  done: boolean;
  tone: 'drained' | 'held';
  /** Why this column stopped. Both deliver 5 of 7 — the reason is the entire difference. */
  verdict: string;
  /** Where this side's money sits: a wallet it controls, or a contract it does not. */
  holds: string;
  /** The balance before the run. Null until prepare has reported it. */
  startedWith: number | null;
  /** What is enforced against this side. Empty for the wallet, which is the point. */
  rules: string[];
}) {
  const delivered = rows.filter((r) => r.delivered).length;
  const last = rows[rows.length - 1];
  const toneColor = tone === 'drained' ? 'var(--drained)' : 'var(--held)';

  // One slot per attempt, always. Rendering only the rows that have arrived left both panels as
  // empty boxes until someone pressed the button, which reads as broken rather than as ready.
  const pending = ATTEMPTS - rows.length - (running ? 1 : 0);

  return (
    <div className="panel p-5 pt-8">
      <span className="panel-tag">{tag}</span>

      <h3 className="text-base font-medium mb-1">{title}</h3>
      <p className="label mb-3">{ATTEMPTS} attempts · 0.10 USDC each</p>

      {/* The rules in force, stated before the run rather than inferred from the refusals.
          One column has none, and that emptiness is the thing being demonstrated. */}
      <div className="flex flex-wrap gap-1.5 mb-4 min-h-[22px]">
        {rules.length === 0 ? (
          <span className="chip" style={{ borderColor: 'var(--drained)', color: 'var(--drained)' }}>
            no limits
          </span>
        ) : (
          rules.map((rule) => (
            <span key={rule} className="chip" style={{ borderColor: 'var(--lavender)', color: 'var(--lavender)' }}>
              {rule}
            </span>
          ))
        )}
      </div>

      <div className="space-y-1.5 num text-xs">
        {rows.map((row) => (
          <div key={row.n} className="flex gap-3 items-baseline">
            <span className="text-[color:var(--faint)] w-4">{String(row.n).padStart(2, '0')}</span>
            {row.delivered ? (
              <>
                <span className="text-[color:var(--accent)]">{usdc(row.amount)}</span>
                <span className="text-[color:var(--muted)] truncate">{row.body}</span>
              </>
            ) : (
              <span style={{ color: toneColor }}>refused — {row.reason}</span>
            )}
          </div>
        ))}

        {running && (
          <div className="flex gap-3 items-baseline text-[color:var(--faint)]">
            <span className="w-4">{String(rows.length + 1).padStart(2, '0')}</span>
            <span className="animate-pulse">waiting for a ledger…</span>
          </div>
        )}

        {Array.from({ length: Math.max(0, pending) }, (_, i) => (
          <div
            key={`ghost-${i}`}
            className="flex gap-3 items-baseline text-[color:var(--line-bright)]"
            aria-hidden="true"
          >
            <span className="w-4">
              {String(ATTEMPTS - pending + i + 1).padStart(2, '0')}
            </span>
            <span>········</span>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-[color:var(--line)] flex items-baseline justify-between">
        <div>
          <p className="label">delivered</p>
          <p className="num text-lg" style={{ color: done ? undefined : 'var(--line-bright)' }}>
            {done ? `${delivered}/${ATTEMPTS}` : `—/${ATTEMPTS}`}
          </p>
        </div>
        <div className="text-right">
          <p className="label">{holds}</p>
          {/* A closing balance on its own is unreadable — 0.00 and 0.60 only mean something
              against what each side started with. Both spent the same 0.50. */}
          <p className="num text-2xl">
            <span className="text-[color:var(--faint)]">
              {startedWith === null ? '—' : startedWith.toFixed(2)}
            </span>
            <span className="text-[color:var(--faint)] text-base"> → </span>
            <span style={{ color: done ? toneColor : 'var(--line-bright)' }}>
              {done ? Number(last?.remaining ?? 0).toFixed(2) : '—'}
            </span>
            <span className="text-sm text-[color:var(--faint)]"> USDC</span>
          </p>
        </div>
      </div>

      {/* Both columns deliver five of seven. Printing only the counts makes them look
          identical, so the sentence that distinguishes them has to be on screen too. */}
      {done && (
        <p className="text-sm mt-4 leading-relaxed" style={{ color: toneColor }}>
          {verdict}
        </p>
      )}
    </div>
  );
}

export function DemoRunner({ apiId, allowanceId }: { apiId: string; allowanceId: string }) {
  const [left, setLeft] = useState<Row[]>([]);
  const [right, setRight] = useState<Row[]>([]);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'running' | 'done'>('idle');
  const [start, setStart] = useState<{ left: number; right: number } | null>(null);
  const [rules, setRules] = useState<string[]>([]);

  // Read the live rules off the contract rather than hard-coding them here. A demo that states
  // limits the chain is not actually enforcing would be the one lie this page cannot afford.
  useEffect(() => {
    fetch(`/api/allowances/${allowanceId}`)
      .then((r) => r.json())
      .then((body) => {
        if (!body?.rules) return;
        const usdcOf = (v: string) => (Number(v) / 1e7).toFixed(2);
        const minutes = Math.round(body.rules.window_ledgers / 12);
        setRules([
          `max ${usdcOf(body.rules.max_per_call)} per call`,
          `max ${usdcOf(body.rules.window_cap)} per ${minutes} min`,
          `${body.rules.allowlist.length} allowed recipient${body.rules.allowlist.length === 1 ? '' : 's'}`,
        ]);
      })
      .catch(() => setRules([]));
  }, [allowanceId]);

  async function run() {
    setLeft([]);
    setRight([]);

    // Put both sides back to their starting position first. This is a public page spending real
    // testnet USDC, so without it the tenth visitor watches two empty columns refuse everything
    // for the same reason, which is the opposite of what the demo is for.
    setPhase('preparing');
    setStart(null);
    const prepared = await fetch('/api/demo/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiId, allowanceId }),
    })
      .then((r) => r.json())
      .catch(() => null);

    // Where each side began. Without it the closing figures are unreadable: 0.00 and 0.60 say
    // nothing until you know they started at 0.50 and 1.10 — that the same half a dollar left
    // both, and only one of them had anything behind it.
    if (prepared?.start) {
      setStart({
        left: Number(prepared.start.wallet) / 1e7,
        right: Number(prepared.start.allowance) / 1e7,
      });
    }

    setPhase('running');

    /** Seven purchases down one column, filling in as each ledger closes. */
    const column = async (
      mode: 'unprotected' | 'allowance',
      set: typeof setLeft,
    ) => {
      for (let n = 1; n <= ATTEMPTS; n += 1) {
        const response = await fetch('/api/demo/step', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode, apiId, allowanceId }),
        });
        const result = await response.json();
        set((rows) => [...rows, { n, ...result }]);
      }
    };

    // Side by side, not one after the other. They spend from different accounts, so nothing is
    // contended — and running them sequentially meant ninety seconds of watching, most of it
    // with one column sitting empty. Racing them is also the more honest picture: the same
    // seven attempts, at the same moment, ending differently.
    await Promise.all([column('unprotected', setLeft), column('allowance', setRight)]);

    setPhase('done');
  }

  const busy = phase === 'preparing' || phase === 'running';

  return (
    <div>
      <div className="flex items-center gap-4 mb-5">
        <button
          onClick={run}
          disabled={busy}
          className="chip chip-accent px-4 py-2.5 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          {busy ? 'running…' : phase === 'done' ? 'run again' : 'run both'}
        </button>
        <span className="label">
          {phase === 'preparing'
            ? 'putting both sides back to the same starting position…'
            : phase === 'running'
              ? `${left.length + right.length} of ${ATTEMPTS * 2} settled — each waits for a ledger`
              : 'both columns at once · about 50 seconds'}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Column
          title="The agent holds its own wallet"
          tag="[ TODAY ]"
          rows={left}
          running={phase === 'running' && left.length < ATTEMPTS}
          done={left.length === ATTEMPTS}
          tone="drained"
          verdict="Nothing refused it. Seven retries, seven payments — and it would have paid for the eighth."
          holds="in its own wallet"
          startedWith={start?.left ?? null}
          rules={[]}
        />
        <Column
          title="The agent has an allowance"
          tag="[ WITH_ALLOWANCE ]"
          rows={right}
          running={phase === 'running' && right.length < ATTEMPTS}
          done={right.length === ATTEMPTS}
          tone="held"
          verdict="Refused the sixth, with money still in the contract. The rule stopped it, not the balance."
          holds="in the contract"
          startedWith={start?.right ?? null}
          rules={rules}
        />
      </div>
    </div>
  );
}
