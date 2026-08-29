'use client';

import { useEffect, useRef, useState } from 'react';
import run from '@/lib/demo-run.json';

/**
 * The two runs, side by side — replayed from a recording.
 *
 * Same agent, same API, same number of attempts. The only difference is where the money sits,
 * so the columns are deliberately identical in every other respect: the contrast has to come
 * from the outcome, not from the presentation.
 *
 * This used to run live on every visit, and could not keep doing so. One demo agent and one
 * allowance are shared by everybody, so two visitors at once drove the same Stellar accounts
 * and collided on the sequence number; and every visit spent real USDC that only returned if a
 * flush happened to follow. Neither is fixable by adding money.
 *
 * What replaces it is not a mock-up. `npm run record-demo` performs a real run and writes
 * `demo-run.json`, and every delivered row here carries the transaction hash that paid for it —
 * so a visitor can click through to the chain instead of taking the page's word for it. That is
 * a stronger claim than watching numbers appear, not a weaker one: a live run is gone the
 * moment it ends, and a hash is permanent.
 */

type Row = {
  n: number;
  delivered: boolean;
  reason?: string;
  amount?: string;
  body?: string;
  txHash?: string;
  /** USDC left, in the place that holds it: the agent's wallet, or the contract. */
  remaining: string;
};

const ATTEMPTS = run.attempts;

/** Compressed. Each of these really took about seven seconds, which the caption says. */
const REVEAL_MS = 1400;

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];

const explorer = (hash: string) => run.explorer.replace('{hash}', hash);

/**
 * What actually happened, rather than what usually happens.
 *
 * These two lines used to be constants. That meant the page asserted "the rule stopped it, not
 * the balance" on runs where the balance had stopped it — printing the demo's single claim at
 * the exact moment it was untrue. A sentence about a run has to be read off the run.
 */
function verdictFor(side: 'wallet' | 'allowance', rows: Row[]): string {
  if (rows.length === 0) return '';

  const delivered = rows.filter((r) => r.delivered).length;
  const refusal = rows.find((r) => !r.delivered);
  const left = Number(rows[rows.length - 1]?.remaining ?? 0).toFixed(2);

  if (side === 'wallet') {
    return refusal
      ? `Paid ${delivered}, then stopped only because the money ran out. Nothing refused it — ` +
          'there was nothing left to refuse.'
      : 'Nothing refused it. Seven retries, seven payments — and it would have paid for the eighth.';
  }

  if (!refusal) {
    return `All ${delivered} inside the caps, with ${left} USDC still in the contract.`;
  }

  // The difference that matters. A contract that ran dry stopped for the same reason the wallet
  // did, and saying otherwise would claim the rules did work they did not do.
  if (/empty/.test(refusal.reason ?? '')) {
    return `Refused the ${ORDINALS[refusal.n] ?? `#${refusal.n}`} because the contract was ` +
      'empty, not because a rule fired. Top it up to see the limit do the work.';
  }

  return `Refused the ${ORDINALS[refusal.n] ?? `#${refusal.n}`} — ${refusal.reason} — with ` +
    `${left} USDC still in the contract. The rule stopped it, not the balance.`;
}

function usdc(stroops?: string) {
  if (!stroops) return '—';
  return (Number(stroops) / 1e7).toFixed(2);
}

/** The limits as they stood on the contract when this was recorded. */
function ruleChips(): string[] {
  const amount = (v: string) => (Number(v) / 1e7).toFixed(2);
  const minutes = Math.round(run.rules.window_ledgers / 12);
  const allowed = run.rules.allowlist.length;
  return [
    `max ${amount(run.rules.max_per_call)} per call`,
    `max ${amount(run.rules.window_cap)} per ${minutes} min`,
    `${allowed} allowed recipient${allowed === 1 ? '' : 's'}`,
  ];
}

function Column({
  title, tag, rows, shown, tone, holds, startedWith, rules, side,
}: {
  title: string;
  tag: string;
  rows: Row[];
  /** How many attempts have been revealed so far. */
  shown: number;
  tone: 'drained' | 'held';
  /** Where this side's money sits: a wallet it controls, or a contract it does not. */
  holds: string;
  startedWith: number;
  /** What is enforced against this side. Empty for the wallet, which is the point. */
  rules: string[];
  side: 'wallet' | 'allowance';
}) {
  const visible = rows.slice(0, shown);
  const done = shown >= ATTEMPTS;
  const delivered = visible.filter((r) => r.delivered).length;
  const last = visible[visible.length - 1];
  const toneColor = tone === 'drained' ? 'var(--drained)' : 'var(--held)';

  // One slot per attempt, always. Rendering only the rows that have arrived left both panels as
  // empty boxes before the replay reached them, which reads as broken rather than as pending.
  const pending = ATTEMPTS - visible.length;

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
        {visible.map((row) => (
          <div key={row.n} className="flex gap-3 items-baseline">
            <span className="text-[color:var(--faint)] w-4">{String(row.n).padStart(2, '0')}</span>
            {row.delivered && row.txHash ? (
              <>
                <span className="text-[color:var(--accent)]">{usdc(row.amount)}</span>
                {/* The receipt is the proof. Anything else here would be a picture of one. */}
                <a
                  href={explorer(row.txHash)}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="see this payment on chain"
                  className="text-[color:var(--muted)] truncate underline decoration-dotted underline-offset-2 hover:text-[color:var(--accent)] transition-colors"
                >
                  {row.body}
                </a>
              </>
            ) : (
              <span style={{ color: toneColor }}>refused — {row.reason}</span>
            )}
          </div>
        ))}

        {Array.from({ length: Math.max(0, pending) }, (_, i) => (
          <div
            key={`ghost-${i}`}
            className="flex gap-3 items-baseline text-[color:var(--line-bright)]"
            aria-hidden="true"
          >
            <span className="w-4">{String(ATTEMPTS - pending + i + 1).padStart(2, '0')}</span>
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
          {/* A closing balance on its own is unreadable — 0.50 and 0.70 only mean something
              against what each side started with. Both spent from the same 1.20. */}
          <p className="num text-2xl">
            <span className="text-[color:var(--faint)]">{startedWith.toFixed(2)}</span>
            <span className="text-[color:var(--faint)] text-base"> → </span>
            <span style={{ color: done ? toneColor : 'var(--line-bright)' }}>
              {done ? Number(last?.remaining ?? 0).toFixed(2) : '—'}
            </span>
            <span className="text-sm text-[color:var(--faint)]"> USDC</span>
          </p>
        </div>
      </div>

      {/* Both columns pay for most of their attempts. Printing only the counts makes them look
          similar, so the sentence that distinguishes them has to be on screen too. */}
      {done && (
        <p className="text-sm mt-4 leading-relaxed" style={{ color: toneColor }}>
          {verdictFor(side, rows)}
        </p>
      )}
    </div>
  );
}

export function DemoRunner() {
  const [shown, setShown] = useState(0);
  const host = useRef<HTMLDivElement | null>(null);

  // Plays itself when it comes into view, once. There is no button because there is nothing to
  // trigger — the run already happened, and asking a visitor to press play before showing them
  // the evidence only puts a step in front of it.
  useEffect(() => {
    const node = host.current;
    if (!node) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let started = false;

    const begin = () => {
      if (started) return;
      started = true;

      // Someone who has asked for less motion wants the outcome, not the reveal.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setShown(ATTEMPTS);
        return;
      }

      timer = setInterval(() => {
        setShown((n) => {
          if (n + 1 >= ATTEMPTS && timer) clearInterval(timer);
          return Math.min(n + 1, ATTEMPTS);
        });
      }, REVEAL_MS);
    };

    // Polled, rather than IntersectionObserver or a scroll listener.
    //
    // Both of those are tidier, and both proved unobservable: IO never fired under the preview
    // renderer this was built in, and window scroll events never arrived there either — so the
    // reveal could only be confirmed by reloading the page already scrolled to it, which is not
    // how anybody reads it. Polling depends on no event being delivered, works the same whether
    // the window or some container scrolls, and can be watched anywhere.
    //
    // It costs one getBoundingClientRect every quarter second, and only until it fires.
    const check = () => {
      const box = node.getBoundingClientRect();
      const onScreen = box.top < window.innerHeight * 0.85 && box.bottom > 0;
      if (!onScreen) return;
      begin();
      if (poll) clearInterval(poll);
    };

    check();
    poll = setInterval(check, 250);

    return () => {
      if (poll) clearInterval(poll);
      if (timer) clearInterval(timer);
    };
  }, []);

  const recorded = new Date(`${run.recordedAt}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div ref={host}>
      <p className="label mb-5">
        a real run, recorded {recorded} on {run.network} · each purchase took about 7 seconds,
        almost all of it waiting for a ledger to close · every receipt below links to the chain
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Column
          side="wallet"
          title="The agent holds its own wallet"
          tag="[ TODAY ]"
          rows={run.wallet}
          shown={shown}
          tone="drained"
          holds="in its own wallet"
          startedWith={Number(run.start.wallet)}
          rules={[]}
        />
        <Column
          side="allowance"
          title="The agent has an allowance"
          tag="[ WITH_ALLOWANCE ]"
          rows={run.allowance}
          shown={shown}
          tone="held"
          holds="in the contract"
          startedWith={Number(run.start.allowance)}
          rules={ruleChips()}
        />
      </div>
    </div>
  );
}
