import type { DemoEvent } from '@/lib/demo/events';
import baked from '@/lib/demo/baked.json';
import { Footer, Header } from './chrome';
import { AgentLines, Install } from './code';
import { DEPOSIT } from '@/lib/demo/params';
import { Run } from './run';

const run = baked as { at: string; events: DemoEvent[] };

export default function Page() {
  const allowance = run.events.find((e) => e.id === 'deploy')?.hash ?? '';
  const paid = run.events.filter((e) => e.state === 'done' && e.id.startsWith('pay'));
  const refusedBy = (rule: string) =>
    run.events.filter((e) => e.state === 'refused' && e.rule === rule).length;

  // Named rather than totalled: which rule stopped a payment is the part worth reading, and two
  // refusals are not one fact. A clause with nothing in it is left out rather than shown as zero.
  const outcome = [
    `${paid.length} paid`,
    refusedBy('allowlist') && `${refusedBy('allowlist')} off the list`,
    refusedBy('window') && `${refusedBy('window')} over the cap`,
  ]
    .filter(Boolean)
    .join(' · ');

  // Trailing zeros carry no information at this size. Two decimals is the floor, so a round
  // figure still reads as money.
  const money = (amount: number): string => {
    const trimmed = amount.toFixed(3).replace(/0+$/, '');
    const decimals = trimmed.split('.')[1] ?? '';
    return decimals.length < 2 ? amount.toFixed(2) : trimmed;
  };

  const received = money(paid.reduce((total, e) => total + parseFloat(e.amount ?? '0'), 0));
  const deposited = money(Number(DEPOSIT) / 10 ** 7);

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
                0.00<small>USDC</small>
              </div>
              <div className="c">asked {paid.length + refusedBy('allowlist') + refusedBy('window')} times, holds nothing</div>
            </div>
            <div className="cell allowance">
              <div className="k">The allowance</div>
              <div className="v">
                {deposited}
                <small>USDC</small>
              </div>
              <div className="c">{outcome}</div>
            </div>
            <div className="cell">
              <div className="k">The seller</div>
              <div className="v">
                {received}
                <small>USDC</small>
              </div>
              <div className="c">what actually moved</div>
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
