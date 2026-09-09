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
            A wallet holds the money and can spend all of it, and the key that spends it sits in
            the agent&rsquo;s environment, where anything the agent reads can reach it. So the money
            sits in a Soroban contract instead, and the agent holds a key that can only{' '}
            <b>ask</b>.
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
              <div className="k">My servers in the payment path</div>
              <div className="v">0</div>
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

      <section className="standing">
        <p className="kicker">
          <span>What this is</span>
          <span className="num">an address, a contract, three rules</span>
        </p>

        <blockquote>
          <p>
            I want to give my machine an agent account, an allowance, and permission to just take
            care of stuff.
          </p>
          <cite>
            <a
              href="https://x.com/dhh/status/2097317603186229297"
              target="_blank"
              rel="noreferrer"
            >
              DHH
            </a>
          </cite>
        </blockquote>

        <p className="lede">
          This is a concrete version of it. Three rules, enforced by the chain rather than by the
          agent&rsquo;s own good behavior, so nothing routes around them: not the agent, not its
          dependencies, not me.
        </p>

        <p className="lede">
          None of it is a new payment protocol. x402 defines the handshake and a public facilitator
          settles it, which is what makes a one-cent API call payable at all: card fees cost more
          than the call. The only change is which address pays.
        </p>
        <p className="lede">
          The figures below are testnet-small on purpose. A cap is a number, and the same contract
          holds 500 USDC a day as readily as it holds 0.025.
        </p>
      </section>

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
