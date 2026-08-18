/**
 * One step of a setup flow, in one of three states.
 *
 * Every step renders from the first paint; a locked one is dimmed and shows a one-line summary
 * instead of its controls. Revealing steps only once they unlock meant both flows arrived as a
 * single card in an empty viewport — which reads as unfinished rather than as focused, and gives
 * a first-time visitor no idea what they are being asked to commit to.
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

  return (
    <div
      className="panel p-6 pt-9 transition-opacity"
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
