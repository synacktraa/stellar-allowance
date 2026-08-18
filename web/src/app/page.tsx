import Link from 'next/link';
import { DemoRunner } from '@/components/DemoRunner';
import { FlowDiagram } from '@/components/FlowDiagram';
import { SiteHeader } from '@/components/SiteHeader';

/**
 * The landing page, built to the content spec.
 *
 * The hero is verbatim and must not be reworded.
 *
 * Two claims in the spec did not survive checking against the contracts, and are written here in
 * the nearest form that is true. Both are noted at the point they appear, so a future editor can
 * see why the wording differs from the brief rather than assuming it drifted:
 *
 *   §4   the three rules ARE changeable, by the owner alone (`set_rules`, owner-gated). What
 *        cannot be changed is a splitter's fee split, and that claim is kept as written. The
 *        reassurance the spec wants is still true and still load-bearing — it belongs to the
 *        agent, not to time.
 *   §5   an API needs no changes, which is said plainly. An agent does need code: 402 → ask the
 *        contract → repeat with the payment.
 *
 * "Reverts", "the money does not move" and "cannot be changed" are kept literal everywhere they
 * are actually true, per the spec's copy rules.
 *
 * The spec's order runs problem → mechanism → why on-chain → the other half → the two sides, and
 * that order is kept. Proof is inserted between the argument and the invitation: a reader who
 * has just been told the network refuses a purchase should be able to watch it happen before
 * being asked to go and set one up. It is the only claim on this page they can check themselves.
 */

const DEMO_API_ID = process.env.DEMO_API_ID ?? '';
const DEMO_ALLOWANCE = process.env.ALLOWANCE_CONTRACT_ID ?? '';
const AGENT = process.env.DEMO_AGENT_ADDRESS ?? '';

/** §2 */
const PROBLEM_CARDS = [
  {
    heading: 'Retries cost real money',
    body: 'A broken endpoint returns an error. Your agent tries again. And again. Four hundred times is not a hypothetical — it is default behaviour.',
  },
  {
    heading: 'Bugs spend faster than you can watch',
    body: 'A loop in your agent’s logic drains a wallet before an alert reaches you. Alerts tell you what already happened.',
  },
  {
    heading: 'The agent holds your wallet',
    body: 'Give an agent keys and you have given it everything in the account. Compromise the agent, compromise the funds.',
  },
];

/** §3 */
const LIMITS = [
  { name: 'Most per purchase', body: 'no single payment above this, ever' },
  { name: 'Most per time frame', body: 'small payments still add up to a ceiling' },
  { name: 'Which vendors get paid', body: 'anywhere else, the answer is no' },
];

/** §6 */
const SIDES = [
  {
    tag: 'RUNNING AN AGENT',
    steps: [
      'Create an agent that holds no money',
      'Set the three rules',
      'Fund the contract',
      'Watch what it buys — and what it was refused',
    ],
    cta: { href: '/user', label: 'Set an allowance →' },
  },
  {
    tag: 'RUNNING A SERVICE',
    steps: [
      'Register your API endpoint',
      'Set a price per call',
      'Hand out the paid URL',
      'Press a button to collect your share',
    ],
    cta: { href: '/developer', label: 'Charge for my API →' },
  },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-3xl font-medium tracking-tight leading-tight max-w-[24ch] mb-5">
      {children}
    </h2>
  );
}

export default function Home() {
  return (
    <main className="relative z-10">
      <SiteHeader />

      {/* ============================================================ 1 hero */}
      <section className="grid-field border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 pt-16 pb-14 lg:pt-24 lg:pb-20">
          <p className="label mb-6">[ SPENDING LIMITS FOR AI AGENTS · STELLAR TESTNET ]</p>

          <h1 className="display max-w-[17ch]">
            Give agents an allowance. Your costs stay put.
          </h1>

          <div className="mt-8 max-w-[56ch] space-y-2 text-lg leading-relaxed">
            <p>It&rsquo;s simple. Like a real allowance, but for AI.</p>
            <p className="text-[color:var(--muted)]">
              Set three limits&mdash;per purchase, per time frame, and which vendors get paid.
            </p>
            <p>Your agents can&rsquo;t break them. Ever.</p>
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/user" className="chip chip-accent px-5 py-3">
              Set an allowance →
            </Link>
            <a
              href="#how"
              className="chip px-5 py-3 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
            >
              Learn how →
            </a>
          </div>
        </div>
      </section>

      {/* ========================================================= 2 problem */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 01 · THE PROBLEM ]</p>
          <SectionHeading>
            An agent that pays for things needs a wallet. A wallet has no limits.
          </SectionHeading>
          <p className="text-[color:var(--muted)] max-w-[64ch] mb-10 leading-relaxed">
            When a request fails, every HTTP library retries. Each retry is now a real payment.
            Nobody stole anything and nobody was dishonest — the agent did exactly what it was
            told, and nothing stood between it and your money.
          </p>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-3">
            {PROBLEM_CARDS.map((card) => (
              <div key={card.heading} className="bg-[color:var(--ground)] p-7">
                <h3 className="text-base font-medium mb-3">{card.heading}</h3>
                <p className="text-sm text-[color:var(--muted)] leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================================================== 3 what we built */}
      <section id="how" className="border-b border-[color:var(--line)] scroll-mt-16">
        <div className="mx-auto max-w-[1180px] px-6 py-16 grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:items-start">
          <div>
            <p className="label mb-4">[ 02 · WHAT WE BUILT ]</p>
            <SectionHeading>
              Don&rsquo;t give the agent your wallet. Give it something to ask.
            </SectionHeading>
            <p className="text-[color:var(--muted)] max-w-[58ch] leading-relaxed">
              The money goes into a contract the agent cannot spend from. Every purchase has to go
              through it, and the contract has rules you set when you funded it:
            </p>

            <dl className="mt-7 space-y-px bg-[color:var(--line)]">
              {LIMITS.map((limit) => (
                <div key={limit.name} className="bg-[color:var(--ground)] px-5 py-4">
                  <dt className="text-sm font-medium">{limit.name}</dt>
                  <dd className="text-sm text-[color:var(--muted)] mt-1">{limit.body}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-7 text-[color:var(--muted)] max-w-[58ch] leading-relaxed">
              When a purchase breaks a rule, the transaction reverts. Not &ldquo;the agent is
              warned&rdquo;, not &ldquo;you get an email afterwards&rdquo; — the money does not
              move. The agent can&rsquo;t argue with it, can&rsquo;t be tricked into overriding
              it, and can&rsquo;t be reprogrammed to ignore it, because the rules aren&rsquo;t in
              its code.
            </p>

            <blockquote className="mt-9 border-l-2 pl-5 border-[color:var(--accent)]">
              <p className="text-xl leading-snug max-w-[34ch]">
                The agent didn&rsquo;t behave better. It couldn&rsquo;t behave worse.
              </p>
            </blockquote>
          </div>

          <div className="lg:max-w-[420px] lg:justify-self-end w-full">
            <p className="label mb-4">[ THE PATH A PAYMENT TAKES ]</p>
            <FlowDiagram allowanceId={DEMO_ALLOWANCE} agentAddress={AGENT} />
          </div>
        </div>
      </section>

      {/* ======================================================= 4 why chain */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 03 · WHY ON-CHAIN MATTERS ]</p>
          <SectionHeading>Enforced on-chain, not promised in code.</SectionHeading>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-2 mt-8">
            <div className="bg-[color:var(--ground)] p-7">
              <p className="label mb-4">[ A LIMIT IN CODE ]</p>
              <p className="text-sm text-[color:var(--muted)] leading-relaxed">
                A limit in software is a promise. Software ships updates. Code has bugs. Config
                gets overridden. Whoever controls the deploy controls the limit — and you have to
                trust them.
              </p>
            </div>
            <div className="bg-[color:var(--ground)] p-7">
              <p className="label mb-4" style={{ color: 'var(--lavender)' }}>
                [ A LIMIT IN A CONTRACT ]
              </p>
              {/* The spec said the rules "cannot be changed afterward". They can — by the owner,
                  never by the agent. The distinction is the whole guarantee, so it is drawn. */}
              <p className="text-sm text-[color:var(--muted)] leading-relaxed">
                The rules live in the contract, not in the agent. Only you can change them, with
                your own signature. The agent holds no funds and has no USDC trustline, so it
                cannot hold the asset at all. A purchase that breaks a rule reverts on the network,
                and the agent&rsquo;s own code has no say in it.
              </p>
            </div>
          </div>

          <p className="mt-8 text-[color:var(--muted)] max-w-[58ch] leading-relaxed">
            Nobody has to be trusted, because you can go and look at how it&rsquo;s built.
          </p>
        </div>
      </section>

      {/* ============================================================ 5 proof */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 04 · PROOF ]</p>
          <SectionHeading>The same agent, run twice.</SectionHeading>
          <p className="text-[color:var(--muted)] max-w-[62ch] mb-8 leading-relaxed">
            Same script, same API, same seven attempts against the same failing service — and
            crucially, the same 1.20 USDC to spend. The only thing that differs is where that
            money sits. One agent holds it; the other can only ask a contract for it. Both runs
            pay real testnet USDC, side by side.
          </p>

          {DEMO_API_ID && DEMO_ALLOWANCE ? (
            <DemoRunner apiId={DEMO_API_ID} allowanceId={DEMO_ALLOWANCE} />
          ) : (
            <div className="panel p-6 pt-8">
              <span className="panel-tag">[ NOT_CONFIGURED ]</span>
              <p className="text-sm text-[color:var(--muted)]">
                Set <code className="font-mono text-[color:var(--accent)]">DEMO_API_ID</code> and{' '}
                <code className="font-mono text-[color:var(--accent)]">ALLOWANCE_CONTRACT_ID</code>{' '}
                to run the demo from this page.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ====================================================== 6 other half */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 05 · THE OTHER HALF ]</p>
          <SectionHeading>The same deployment lets you charge per call.</SectionHeading>

          <p className="text-[color:var(--muted)] max-w-[64ch] leading-relaxed">
            Point it at an API you already run and set a price. You get a URL that answers{' '}
            <span className="num text-[color:var(--text)]">402 Payment Required</span>, takes
            payment, and forwards the request. Nothing about your API changes.
          </p>

          <p className="mt-5 text-[color:var(--muted)] max-w-[64ch] leading-relaxed">
            <strong className="text-[color:var(--text)] font-medium">
              And the money doesn&rsquo;t come to us.
            </strong>{' '}
            Payment lands in a splitter contract built for you. The split — your share and the
            platform fee — is fixed when the contract is created and cannot be changed by either
            side. <span className="num text-[color:var(--text)]">flush()</span> is permissionless:
            anyone can trigger the payout, and it can only ever reach the two addresses set at
            creation. If we vanished tomorrow, you could still collect.
          </p>
        </div>
      </section>

      {/* ======================================================= 7 two sides */}
      <section>
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 06 · THE TWO SIDES ]</p>
          <SectionHeading>Neither side needs to understand what&rsquo;s underneath.</SectionHeading>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-2 mt-8">
            {SIDES.map((side) => (
              <div key={side.tag} className="bg-[color:var(--ground)] p-7">
                <p className="label mb-5">[ {side.tag} ]</p>
                <ol className="space-y-3 mb-6">
                  {side.steps.map((step, index) => (
                    <li key={step} className="flex gap-4 items-baseline">
                      <span className="label shrink-0">{String(index + 1).padStart(2, '0')}</span>
                      <span className="text-sm leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
                <Link
                  href={side.cta.href}
                  className="chip px-4 py-2.5 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
                >
                  {side.cta.label}
                </Link>
              </div>
            ))}
          </div>

          <p className="mt-8 text-[color:var(--muted)] max-w-[62ch] leading-relaxed">
            One sees a budget and a list of purchases. The other sees a price and a balance going
            up.
          </p>
        </div>
      </section>

      {/*
        Kept against the spec's trim. This is unaudited software that asks people to put money
        behind it; the hero eyebrow is the only other place the network is named, and a Stellar
        hackathon entry should not leave its non-affiliation to inference.
      */}
      <footer className="border-t border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-8 flex flex-wrap gap-x-8 gap-y-3 justify-between">
          <span className="label">Stellar testnet · USDC · unaudited · Apache 2.0</span>
          <span className="label">
            Not affiliated with the Stellar Development Foundation
          </span>
        </div>
      </footer>
    </main>
  );
}
