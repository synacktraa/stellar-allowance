/**
 * Where the money sits, which is the whole difference.
 *
 * Two panels rather than one drawing, stacked and sharing a grid: the holder starts in the same
 * place in both and the destinations end in the same place, so the only thing the eye has to
 * compare is what happens in between. On the left both destinations look identical to the thing
 * holding the money. On the right one of them is cut.
 */
export function Where() {
  return (
    <figure className="where">
      <div className="pair">
        <svg
          className="dia"
          viewBox="0 0 640 150"
          role="img"
          aria-label="With the money in the agent, the agent pays the seller and can pay a stranger exactly the same way."
        >
          <defs>
            <marker id="tip-a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path className="tip" d="M0 0 L8 4 L0 8 z" />
            </marker>
          </defs>

          <text className="head" x="0" y="11">
            MONEY IN THE AGENT
          </text>

          <rect className="box" x="1" y="36" width="130" height="54" />
          <text className="lab" x="16" y="60">
            Agent
          </text>
          <text className="sub" x="16" y="78">
            key and USDC
          </text>

          <rect className="box" x="478" y="24" width="160" height="42" />
          <text className="lab mid" x="558" y="50">
            Seller
          </text>

          <rect className="box" x="478" y="96" width="160" height="42" />
          <text className="lab mid" x="558" y="122">
            Stranger
          </text>

          <path className="edge" d="M131 56 L474 42" markerEnd="url(#tip-a)" />
          <text className="edge-lab mid" x="308" y="36">
            pays
          </text>

          <path className="edge" d="M131 76 L474 114" markerEnd="url(#tip-a)" />
          <text className="edge-lab mid" x="308" y="112">
            pays
          </text>
        </svg>

        <svg
          className="dia"
          viewBox="0 0 640 150"
          role="img"
          aria-label="With the money in a contract, the agent asks, the contract pays the seller, and the payment to a stranger is refused before anything moves."
        >
          <defs>
            <marker id="tip-b" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path className="tip" d="M0 0 L8 4 L0 8 z" />
            </marker>
          </defs>

          <text className="head" x="0" y="11">
            MONEY IN A CONTRACT
          </text>

          <rect className="box" x="1" y="41" width="130" height="54" />
          <text className="lab" x="16" y="65">
            Agent
          </text>
          <text className="sub" x="16" y="83">
            key, 0.00
          </text>

          <rect className="box hot" x="186" y="28" width="172" height="80" />
          <text className="lab" x="202" y="54">
            Allowance
          </text>
          <text className="sub" x="202" y="74">
            holds the USDC
          </text>
          <text className="sub" x="202" y="92">
            holds the rules
          </text>

          <rect className="box" x="478" y="24" width="160" height="42" />
          <text className="lab mid" x="558" y="50">
            Seller
          </text>

          <rect className="box no" x="478" y="96" width="160" height="42" />
          <text className="lab mid" x="558" y="122">
            Stranger
          </text>

          <path className="edge" d="M131 68 L182 68" markerEnd="url(#tip-b)" />
          <text className="edge-lab mid" x="156" y="60">
            asks
          </text>

          <path className="edge" d="M358 56 L474 42" markerEnd="url(#tip-b)" />
          <text className="edge-lab mid" x="416" y="36">
            pays
          </text>

          <path className="edge cut" d="M358 84 L474 114" />
          <path className="cross" d="M409 92 L423 106 M423 92 L409 106" />
          <text className="edge-lab mid" x="416" y="132">
            refused
          </text>
        </svg>
      </div>

      <figcaption>
        Above, the agent holds the money and both destinations look the same to it. Below, the money
        is in a contract and one of those arrows never happens.
      </figcaption>
    </figure>
  );
}
