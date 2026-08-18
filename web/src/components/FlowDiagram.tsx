/**
 * The hero.
 *
 * The reference annotates a photograph; there is nothing decorative to annotate here, so the
 * mechanism is the subject. Three parties, two hops, and callouts naming what each one can and
 * cannot do — which is the entire argument, drawn rather than asserted.
 */
export function FlowDiagram({
  allowanceId,
  agentAddress,
}: {
  allowanceId?: string;
  agentAddress?: string;
}) {
  const short = (value?: string) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—");

  return (
    <svg
      viewBox="0 0 900 400"
      role="img"
      aria-label="An agent with no funds asks an allowance contract, which checks three rules before paying the seller"
      className="w-full h-auto"
    >
      <defs>
        <marker
          id="tip"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line-bright)" />
        </marker>
        <marker
          id="tip-accent"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
        </marker>
      </defs>

      {/* crosshairs, as in the reference */}
      {[120, 340, 560, 780].map((x) =>
        [70, 330].map((y) => (
          <g key={`${x}-${y}`} stroke="var(--line)" strokeWidth="1">
            <line x1={x - 4} y1={y} x2={x + 4} y2={y} />
            <line x1={x} y1={y - 4} x2={x} y2={y + 4} />
          </g>
        )),
      )}

      {/* --- agent --- */}
      <rect x="40" y="170" width="150" height="60" fill="none" stroke="var(--line-bright)" />
      <text x="56" y="196" fontSize="14" fill="var(--text)" fontFamily="var(--font-sans)">
        Agent
      </text>
      <text x="56" y="215" fontSize="10" fill="var(--faint)" fontFamily="var(--font-mono)">
        {short(agentAddress)}
      </text>

      {/* callout: holds nothing */}
      <line x1="115" y1="170" x2="115" y2="118" stroke="var(--line-bright)" strokeWidth="1" />
      <line x1="115" y1="118" x2="196" y2="118" stroke="var(--line-bright)" strokeWidth="1" />
      <rect x="196" y="98" width="10" height="10" fill="none" stroke="var(--line-bright)" />
      <text x="216" y="108" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)" letterSpacing="1.6">
        [ HOLDS_NOTHING ]
      </text>
      <text x="216" y="124" fontSize="10" fill="var(--faint)" fontFamily="var(--font-sans)">
        No USDC trustline. It cannot hold the asset at all.
      </text>

      {/* agent -> allowance */}
      <line
        x1="190"
        y1="200"
        x2="352"
        y2="200"
        stroke="var(--line-bright)"
        strokeWidth="1"
        markerEnd="url(#tip)"
      />
      <text x="212" y="192" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)" letterSpacing="1.4">
        asks
      </text>

      {/* --- allowance --- */}
      <rect x="360" y="150" width="180" height="100" fill="none" stroke="var(--lavender)" strokeWidth="1" />
      <text x="378" y="180" fontSize="14" fill="var(--lavender)" fontFamily="var(--font-sans)">
        Allowance
      </text>
      <text x="378" y="199" fontSize="10" fill="var(--faint)" fontFamily="var(--font-mono)">
        {short(allowanceId)}
      </text>
      <text x="378" y="222" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)" letterSpacing="0.6">
        per-call · window · allowlist
      </text>

      {/* callout: the refusal */}
      <line x1="450" y1="250" x2="450" y2="300" stroke="var(--lavender)" strokeWidth="1" />
      <line x1="450" y1="300" x2="366" y2="300" stroke="var(--lavender)" strokeWidth="1" />
      <rect x="356" y="295" width="10" height="10" fill="none" stroke="var(--lavender)" />
      <text x="196" y="299" fontSize="10" fill="var(--lavender)" fontFamily="var(--font-mono)" letterSpacing="1.6" textAnchor="end">
        [ REFUSES ]
      </text>
      <text x="196" y="315" fontSize="10" fill="var(--faint)" fontFamily="var(--font-sans)" textAnchor="end">
        Breaks a rule and the money does not move.
      </text>

      {/* allowance -> seller */}
      <line
        x1="540"
        y1="200"
        x2="702"
        y2="200"
        stroke="var(--accent)"
        strokeWidth="1"
        markerEnd="url(#tip-accent)"
      />
      <text x="566" y="192" fontSize="10" fill="var(--accent)" fontFamily="var(--font-mono)" letterSpacing="1.4">
        pays
      </text>

      {/* --- seller --- */}
      <rect x="710" y="170" width="150" height="60" fill="none" stroke="var(--line-bright)" />
      <text x="726" y="196" fontSize="14" fill="var(--text)" fontFamily="var(--font-sans)">
        Seller
      </text>
      <text x="726" y="215" fontSize="10" fill="var(--faint)" fontFamily="var(--font-mono)">
        splitter · 90 / 10
      </text>

      {/* callout: split */}
      <line x1="785" y1="230" x2="785" y2="300" stroke="var(--line-bright)" strokeWidth="1" />
      <rect x="780" y="300" width="10" height="10" fill="none" stroke="var(--line-bright)" />
      <text x="806" y="304" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)" letterSpacing="1.6">
        [ SPLIT ]
      </text>
      <text x="806" y="320" fontSize="10" fill="var(--faint)" fontFamily="var(--font-sans)">
        Fixed at creation.
      </text>
    </svg>
  );
}
