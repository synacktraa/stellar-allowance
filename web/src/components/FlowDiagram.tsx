/**
 * The mechanism, drawn rather than asserted.
 *
 * Three parties, two hops, and a note on each naming what it can and cannot do — which is the
 * whole argument. It reads top to bottom so it survives a narrow column: the previous version
 * was a 900-wide SVG whose 10px labels rendered at about 4px on a phone, and whose refusal
 * caption was anchored at x = -34, outside its own viewBox, so it was clipped on every screen.
 *
 * Plain elements rather than SVG, because the captions are sentences and sentences need to
 * wrap. SVG text does not.
 */

function Node({
  name,
  detail,
  accent,
}: {
  name: string;
  detail: string;
  accent?: boolean;
}) {
  const colour = accent ? 'var(--lavender)' : 'var(--line-bright)';
  return (
    <div
      className="border px-4 py-3 bg-[color:var(--panel)]/60"
      style={{ borderColor: colour }}
    >
      <p
        className="text-sm font-medium"
        style={{ color: accent ? 'var(--lavender)' : 'var(--text)' }}
      >
        {name}
      </p>
      <p className="num text-[11px] text-[color:var(--faint)] break-all mt-0.5">{detail}</p>
    </div>
  );
}

function Note({ tag, children, tone }: { tag: string; children: string; tone: string }) {
  return (
    <div className="flex gap-2 pl-4 pt-2">
      <span
        className="mt-[5px] h-[7px] w-[7px] shrink-0 border"
        style={{ borderColor: tone }}
      />
      <p className="text-[11px] leading-relaxed text-[color:var(--faint)] min-w-0">
        <span className="label mr-1.5" style={{ color: tone }}>
          [ {tag} ]
        </span>
        {children}
      </p>
    </div>
  );
}

/** A labelled hop. The line is the edge; the word on it says what travels. */
function Hop({ label, accent }: { label: string; accent?: boolean }) {
  // `--line-bright` is a hairline colour for borders; at 1px on a near-black ground it reads as
  // nothing at all, so the unpaid hop takes the muted grey instead.
  const colour = accent ? 'var(--accent)' : 'var(--muted)';
  return (
    <div className="flex items-center gap-2 pl-4 h-10" aria-hidden="true">
      <span className="relative flex flex-col items-center self-stretch">
        <span className="w-px flex-1" style={{ background: colour }} />
        <span
          className="block h-0 w-0 border-x-[3px] border-x-transparent border-t-[5px]"
          style={{ borderTopColor: colour }}
        />
      </span>
      <span className="label" style={{ color: colour }}>
        {label}
      </span>
    </div>
  );
}

export function FlowDiagram({
  allowanceId,
  agentAddress,
}: {
  allowanceId?: string;
  agentAddress?: string;
}) {
  const short = (value?: string) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—');

  return (
    <figure className="m-0">
      <p className="sr-only">
        An agent that holds no funds asks an allowance contract to pay. The contract checks a
        per-call cap, a rolling window and an allowlist, and refuses anything outside them.
        Payments it does make go to the seller&rsquo;s splitter contract, which divides them
        ninety-ten.
      </p>

      <div aria-hidden="true">
        <Node name="Agent" detail={short(agentAddress)} />
        <Note tag="HOLDS_NOTHING" tone="var(--muted)">
          No USDC trustline. It cannot hold the asset at all.
        </Note>

        <Hop label="asks" />

        <Node name="Allowance" detail={short(allowanceId)} accent />
        <Note tag="REFUSES" tone="var(--lavender)">
          Per-call cap, rolling window, allowlist. Break one and the money does not move.
        </Note>

        <Hop label="pays" accent />

        <Node name="Seller" detail="splitter · 90 / 10" />
        <Note tag="SPLIT" tone="var(--muted)">
          Fixed when the contract was created. Nobody can change the share afterwards.
        </Note>
      </div>
    </figure>
  );
}
