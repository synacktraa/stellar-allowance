'use client';

import { useEffect, useRef } from 'react';

/**
 * One step of a setup flow, in one of three states.
 *
 * Every step renders from the first paint; a locked one is dimmed and shows a one-line summary
 * instead of its controls. Revealing steps only once they unlock meant both flows arrived as a
 * single card in an empty viewport — which reads as unfinished rather than as focused, and gives
 * a first-time visitor no idea what they are being asked to commit to.
 *
 * A step also brings itself into view the moment it unlocks. Finishing one step often means
 * signing in a wallet popup, and when that closes the next thing to do is below the fold — so
 * the flow appeared to end where the screen did.
 */

export type StepState = 'locked' | 'todo' | 'done';

export function Step({
  n,
  state,
  title,
  summary,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  /** Stands in for the controls while locked, so the step's purpose is legible early. */
  summary: string;
  children?: React.ReactNode;
}) {
  const locked = state === 'locked';
  const panel = useRef<HTMLDivElement>(null);
  const was = useRef(state);

  useEffect(() => {
    const unlocked = was.current === 'locked' && state !== 'locked';
    was.current = state;
    if (!unlocked) return;

    // Never yank the page on first paint — only on a real transition, which this is, and only
    // if the step is actually off screen. Scrolling something already visible is disorienting.
    const element = panel.current;
    if (!element) return;

    const box = element.getBoundingClientRect();
    const offScreen = box.top < 0 || box.bottom > window.innerHeight;
    if (!offScreen) return;

    element.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'center',
    });
  }, [state]);

  return (
    <div
      ref={panel}
      className="panel p-6 pt-9 transition-opacity scroll-mt-20"
      style={locked ? { opacity: 0.45 } : undefined}
      aria-disabled={locked || undefined}
    >
      <span className="panel-tag">
        [ {String(n).padStart(2, '0')} · {state === 'done' ? 'DONE' : locked ? 'LOCKED' : 'TODO'} ]
      </span>
      <h2
        className="text-base font-medium mb-3"
        style={{ color: state === 'done' ? 'var(--held)' : undefined }}
      >
        {title}
      </h2>
      {locked ? (
        <p className="text-sm text-[color:var(--muted)] max-w-[52ch]">{summary}</p>
      ) : (
        children
      )}
    </div>
  );
}
