'use client';

import { useState } from 'react';

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
  title, tag, rows, running, done, tone,
}: {
  title: string;
  tag: string;
  rows: Row[];
  running: boolean;
  done: boolean;
  tone: 'drained' | 'held';
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
      <p className="label mb-4">{ATTEMPTS} attempts · 0.10 USDC each</p>

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
          <p className="label">{last?.remainingLabel ?? 'left at the end'}</p>
          <p
            className="num text-lg"
            style={{ color: done ? toneColor : 'var(--line-bright)' }}
          >
            {done ? `${Number(last?.remaining ?? 0).toFixed(2)} USDC` : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}

export function DemoRunner({ apiId, allowanceId }: { apiId: string; allowanceId: string }) {
  const [left, setLeft] = useState<Row[]>([]);
  const [right, setRight] = useState<Row[]>([]);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'left' | 'right' | 'done'>('idle');

  async function run() {
    setLeft([]);
    setRight([]);

    // Put both sides back to their starting position first. This is a public page spending real
    // testnet USDC, so without it the tenth visitor watches two empty columns refuse everything
    // for the same reason, which is the opposite of what the demo is for.
    setPhase('preparing');
    await fetch('/api/demo/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiId, allowanceId }),
    }).catch(() => null);

    for (const mode of ['unprotected', 'allowance'] as const) {
      setPhase(mode === 'unprotected' ? 'left' : 'right');
      const set = mode === 'unprotected' ? setLeft : setRight;

      for (let n = 1; n <= ATTEMPTS; n += 1) {
        const response = await fetch('/api/demo/step', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode, apiId, allowanceId }),
        });
        const result = await response.json();
        set((rows) => [...rows, { n, ...result }]);
      }
    }

    setPhase('done');
  }

  const busy = phase === 'preparing' || phase === 'left' || phase === 'right';

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
            : busy
              ? 'each purchase waits for a ledger — about 7s'
              : 'takes about 90 seconds'}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Column
          title="The agent holds its own wallet"
          tag="[ TODAY ]"
          rows={left}
          running={phase === 'left'}
          done={left.length === ATTEMPTS}
          tone="drained"
        />
        <Column
          title="The agent has an allowance"
          tag="[ WITH_ALLOWANCE ]"
          rows={right}
          running={phase === 'right'}
          done={right.length === ATTEMPTS}
          tone="held"
        />
      </div>
    </div>
  );
}
