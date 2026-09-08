import type { DemoEvent } from '@/lib/demo/events';
import baked from '@/lib/demo/baked.json';
import { Run } from './run';

const run = baked as { at: string; events: DemoEvent[] };

export default function Page() {
  const settled = run.events.filter((e) => e.state === 'done' && e.id.startsWith('pay')).length;
  const refused = run.events.filter((e) => e.state === 'refused').length;
  const allowance = run.events.find((e) => e.id === 'deploy')?.hash ?? '';

  return (
    <main className="wrap">
      <header>
        <a className="brand" href="/">
          STELLAR<span>//</span>ALLOWANCE
        </a>
        <div className="tag">testnet · unaudited</div>
      </header>

      <div className="hero">
        <div>
          <h1>Give the agent an allowance. Keep the wallet.</h1>
          <p className="lede">
            The money sits in a contract on Stellar. The agent holds a key that can <b>ask</b> to pay, and the
            contract decides: only addresses the owner allowed, only up to a cap per rolling window. A request
            that breaks a rule is refused on chain, before anything moves.
          </p>
        </div>

        <div className="stats">
          <div className="cell dark">
            <div className="k">The agent&rsquo;s key holds</div>
            <div className="v">
              0.00<small>USDC</small>
            </div>
            <div className="c">it can ask; it cannot take</div>
          </div>
          <div className="cell">
            <div className="k">In the payment path</div>
            <div className="v">
              0<small>of ours</small>
            </div>
            <div className="c">a public facilitator submits, the contract decides</div>
          </div>
          <div className="cell addr">
            <div className="k">The allowance</div>
            <div className="v">
              <a
                className="hash"
                href={`https://stellar.expert/explorer/testnet/contract/${allowance}`}
                target="_blank"
                rel="noreferrer"
              >
                {allowance.slice(0, 6)}…{allowance.slice(-4)}
              </a>
            </div>
            <div className="c">
              {settled} payments settled, {refused} refused
            </div>
          </div>
        </div>
      </div>

      <Run baked={run.events} at={run.at} />

      <p className="note">
        x402 ships spend controls of its own. They run inside the agent&rsquo;s process, so the agent can
        ignore them. This limit runs on the chain, and the agent cannot.
      </p>

      <footer>
        <span>Not (yet) affiliated with the Stellar Development Foundation.</span>
        <a href="https://github.com/synacktraa/stellar-allowance">github →</a>
      </footer>
    </main>
  );
}
