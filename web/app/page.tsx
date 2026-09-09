import type { DemoEvent } from '@/lib/demo/events';
import baked from '@/lib/demo/baked.json';
import { Footer, Header } from './chrome';
import { AgentLines, Install } from './code';
import { Run } from './run';

const run = baked as { at: string; events: DemoEvent[] };

/**
 * The hero's figures, which are an illustration rather than a reading.
 *
 * The run further down is deliberately small: it happens in a stranger's browser while they
 * wait, so it finishes in a minute, and a minute's worth of payments is too few to show what a
 * cap is for. These are the same shape at a size worth caring about — the agent holds nothing
 * however often it asks, the allowance holds both the money and the rules, and only what the
 * rules allow reaches a seller. They are not the run's numbers and nothing here says they are;
 * the run states its own, with a hash on every row.
 */
const HERO = {
  asked: 10,
  paid: 8,
  outcome: '8 paid · 1 off the list · 1 over the cap',
  agent: '0.00',
  allowance: '5.00',
  seller: '0.08',
};

export default function Page() {
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
              <div className="k">The agent</div>
              <div className="v">
                {HERO.agent}
                <small>USDC</small>
              </div>
              <div className="c">asked {HERO.asked} times, holds nothing</div>
            </div>
            <div className="cell allowance">
              <div className="k">The allowance</div>
              <div className="v">
                {HERO.allowance}
                <small>USDC</small>
              </div>
              <div className="c">{HERO.outcome}</div>
            </div>
            <div className="cell">
              <div className="k">The seller</div>
              <div className="v">
                {HERO.seller}
                <small>USDC</small>
              </div>
              <div className="c">was paid {HERO.paid} times</div>
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
          The cap below is testnet-small on purpose. A cap is a number, and the same contract
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
