import type { DemoEvent } from '@/lib/demo/events';
import baked from '@/lib/demo/baked.json';
import { Footer, Header } from './chrome';
import { AgentLines, Install } from './code';
import { Run } from './run';

const run = baked as { at: string; events: DemoEvent[] };

export default function Page() {
  const settled = run.events.filter((e) => e.state === 'done' && e.id.startsWith('pay')).length;
  const refused = run.events.filter((e) => e.state === 'refused').length;
  const allowance = run.events.find((e) => e.id === 'deploy')?.hash ?? '';

  return (
    <main className="wrap">
      <Header />

      <div className="hero">
        <div>
          <h1>Give the agent an allowance. Keep the wallet.</h1>
          <p className="lede">
            You are building an agent that calls paid APIs, and you want it paying without holding
            your wallet. So the money sits in a contract on Stellar, and the agent holds a key that
            can <b>ask</b> to pay. The contract decides: only addresses you allowed, only up to a cap
            per rolling window. Anything else is refused on chain, before it moves.
          </p>
        </div>

        <div className="side">
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
      </div>

      <Run baked={run.events} at={run.at} />

      <section className="ship">
        <p className="kicker">
          <span>Then, in the agent</span>
          <span className="num">two values, four lines</span>
        </p>
        <Install />
        <AgentLines />
        <p className="help">
          The two values are the allowance&rsquo;s address and the agent&rsquo;s key, and creating one
          hands you both. There is no account to open and no service to point at: the library reads
          the pair out of the environment and pays through the contract.
        </p>
      </section>

      <div className="act">
        <a className="cta quiet" href="/dashboard">
          Open the dashboard
        </a>
        <span className="note-inline">Freighter on testnet · you set the rules</span>
      </div>

      <Footer />
    </main>
  );
}
