import Link from 'next/link';
import { DemoRunner } from '@/components/DemoRunner';
import { FlowDiagram } from '@/components/FlowDiagram';
import { SiteHeader } from '@/components/SiteHeader';

/**
 * The landing page, built to the content spec.
 *
 * Section order follows the spec exactly. The hero is verbatim and must not be reworded.
 *
 * Three claims in the spec did not survive checking against the contracts, and are written here
 * in the nearest form that is true. Each is noted at the point it appears, so a future editor
 * can see why the wording differs from the brief rather than assuming it drifted:
 *
 *   §4 / §11  the three rules ARE changeable, by the owner alone (`set_rules`, owner-gated).
 *             What cannot be changed is a splitter's fee split. The reassurance the spec wants
 *             is still true and still load-bearing — it just belongs to the agent, not to time.
 *   §11       an agent does need code: 402 → ask the contract → repeat with the payment.
 *             The API is what needs none.
 *   §10       `install:web`, `setup` and `seed-demo` are not scripts in this repo.
 *
 * "Reverts", "the money does not move" and "cannot be changed" are kept literal everywhere they
 * are actually true, per the spec's copy rules.
 */

const DEMO_API_ID = process.env.DEMO_API_ID ?? '';
const DEMO_ALLOWANCE = process.env.ALLOWANCE_CONTRACT_ID ?? '';
const AGENT = process.env.DEMO_AGENT_ADDRESS ?? '';

const REPO = 'https://github.com/synacktraa/stellar-allowance';

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

/** §8 — every figure from a recorded run. If one changes, change it here, do not round it. */
const STATS = [
  {
    stat: '5 paid, 6th refused',
    detail:
      'Six calls of 0.1 USDC against a 0.5 USDC window cap. The recipient received exactly 0.5 USDC.',
  },
  {
    stat: '0.18 / 0.02 split, exact',
    detail:
      'Two calls of 0.1 USDC paid into a splitter, then flushed. Developer got 0.18, platform 0.02, splitter left holding nothing. The flush was triggered by the agent, not the platform.',
  },
  {
    stat: '6.9s mean per purchase',
    detail:
      'Range 4.6–9.0s. Quote 0.4–1.2s, pay 2.8–6.8s waiting for a ledger to close, deliver 1.4–2.0s.',
  },
];

/** §9 */
const GLOSSARY = [
  ['The errand runner', 'an AI agent', 'a program that acts on its own'],
  ['The shop or service', 'an API', 'one program buying something from another'],
  ['Your cash machine', 'a smart contract', 'a small program that holds money and follows fixed rules'],
  ['The rules it enforces', 'on-chain limits', 'enforced by the network, not by the agent'],
  ['The till that splits payments', 'a splitter contract', 'fixed share when it is created'],
  ['The money itself', 'USDC', 'a digital currency worth one dollar'],
  ['The whole network', 'Stellar', 'where the money and the contracts live'],
  ['Test money, not real', 'testnet', 'everything we show costs nothing real'],
];

/** §11 */
const FAQ = [
  {
    q: 'Can the limits be changed after the contract is created?',
    // The spec said "No. They're set at creation." `set_rules` is owner-gated, not absent —
    // so the promise is kept where it is real: the agent cannot move them.
    a: 'Only by you, with your own signature. The agent cannot change them, cannot be tricked into overriding them, and cannot be reprogrammed to ignore them, because the rules are not in its code. Spending already counted stays counted, so an edit cannot hand an agent a fresh window.',
  },
  {
    q: 'Can the platform change the fee split, or hold my money?',
    a: 'No. The developer’s share and the platform fee are fixed when the splitter is created and cannot be changed by either side. Payment lands in the contract, not in a platform account, and flush() can only ever reach the two addresses set at creation.',
  },
  {
    q: 'Do I have to change my agent’s code?',
    // The spec said "No... it points at the paid URL instead." A paid URL answers 402; without
    // the spend call the agent gets a price and no purchase.
    a: 'A little. Your agent requests the paid URL, is quoted a price in a 402, asks the contract to pay it, then repeats the request with the payment attached. That is three calls, and the whole file is on the setup page ready to copy.',
  },
  {
    q: 'Do I have to change my API?',
    a: 'No. The gateway sits in front of it, handles the 402, and forwards the request through.',
  },
  {
    q: 'What happens when a purchase breaks a rule?',
    a: 'The transaction reverts. No money moves and your agent gets an error back. Nothing partial, nothing to reconcile — and it costs nothing, because the rules run during simulation before anything is submitted.',
  },
  {
    q: 'Do I need to understand Stellar or smart contracts?',
    a: 'No. You set three numbers and fund an account. The chain is doing the enforcing, but you interact with a form.',
  },
  {
    q: 'How much does running it cost?',
    a: 'Stellar fees are a rounding error, and Supabase’s free tier covers a small deployment. The expensive part is the API calls your agent makes.',
  },
  {
    q: 'Can I use this with real money?',
    a: 'Not yet. It is unaudited and built for testnet. Do not put mainnet funds behind it.',
  },
];

/** §13 */
const FOOTER_LINKS = [
  { label: 'GitHub', href: REPO },
  { label: 'Contract design notes', href: `${REPO}/blob/main/docs/CONTRACT.md` },
  { label: 'Stellar docs', href: 'https://developers.stellar.org' },
  { label: 'Testnet USDC', href: 'https://faucet.circle.com' },
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

      {/* ====================================================== 5 other half */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 04 · THE OTHER HALF ]</p>
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

      {/* ======================================================= 6 two sides */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 05 · THE TWO SIDES ]</p>
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

      {/* ============================================================ 7 demo */}
      <section id="demo" className="border-b border-[color:var(--line)] scroll-mt-16">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 06 · THE DEMO ]</p>
          <SectionHeading>The same agent, the same errand, twice.</SectionHeading>

          <p className="text-[color:var(--muted)] max-w-[64ch] leading-relaxed">
            First run, the agent holds the wallet. The shop&rsquo;s payment fails, the agent
            retries, and it keeps paying until the money is gone. Second run, the agent holds
            nothing and has to ask. It buys five things, then the sixth request breaks a rule and
            gets nothing.
          </p>

          <p className="mt-5 text-[color:var(--muted)] max-w-[64ch] leading-relaxed">
            Same errand, same broken shop, same first five purchases. Then one wallet is empty and
            the other still has money in it. That contrast is the whole product.
          </p>

          <div className="panel p-5 pt-8 mt-8 mb-8 max-w-[64ch]">
            <span className="panel-tag">[ NOT SIMULATED ]</span>
            <p className="text-sm text-[color:var(--muted)] leading-relaxed">
              Every purchase in the demo is a real payment on a real network. It&rsquo;s testnet
              money, but nothing is faked or simulated — which is why each purchase takes a few
              seconds. We&rsquo;re genuinely waiting for the ledger to close.
            </p>
          </div>

          {DEMO_API_ID && DEMO_ALLOWANCE ? (
            <DemoRunner apiId={DEMO_API_ID} allowanceId={DEMO_ALLOWANCE} />
          ) : (
            <div className="panel p-6 pt-8">
              <span className="panel-tag">[ NOT_CONFIGURED ]</span>
              <p className="text-sm text-[color:var(--muted)]">
                Set <code className="font-mono text-[color:var(--accent)]">DEMO_API_ID</code> and{' '}
                <code className="font-mono text-[color:var(--accent)]">ALLOWANCE_CONTRACT_ID</code>{' '}
                in <code className="font-mono text-[color:var(--accent)]">web/.env.local</code> to
                run the demo from this page.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ======================================================== 8 verified */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 07 · VERIFIED ON CHAIN ]</p>
          <SectionHeading>Numbers from actual runs, not estimates.</SectionHeading>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-3 mt-8">
            {STATS.map((item) => (
              <div key={item.stat} className="bg-[color:var(--ground)] p-7">
                <p className="num text-lg text-[color:var(--held)] mb-3">{item.stat}</p>
                <p className="text-sm text-[color:var(--muted)] leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======================================================== 9 glossary */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 08 · PLAIN-LANGUAGE GLOSSARY ]</p>
          <SectionHeading>The real words, in case you hear them.</SectionHeading>
          <p className="text-[color:var(--muted)] max-w-[62ch] mb-9 leading-relaxed">
            The story above is accurate. These are just what each piece is actually called.
          </p>

          <div className="panel">
            <div className="hidden sm:grid grid-cols-[1fr_1fr_1.4fr] border-b border-[color:var(--line)]">
              <span className="label px-5 py-3 whitespace-nowrap">[ IN PLAIN TERMS ]</span>
              <span className="label px-5 py-3 whitespace-nowrap">[ REALLY CALLED ]</span>
              <span className="label px-5 py-3 whitespace-nowrap">[ WHAT IT MEANS ]</span>
            </div>
            {GLOSSARY.map(([plain, real, means]) => (
              <div
                key={real}
                className="grid sm:grid-cols-[1fr_1fr_1.4fr] border-b border-[color:var(--line)] last:border-b-0 py-3 sm:py-0"
              >
                <span className="px-5 sm:py-4 text-sm text-[color:var(--muted)]">{plain}</span>
                <span className="px-5 sm:py-4 text-sm font-medium">{real}</span>
                <span className="px-5 sm:py-4 text-sm text-[color:var(--muted)]">{means}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================================================== 10 get started */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 09 · GET STARTED ]</p>
          <SectionHeading>Fifteen minutes, no credit card.</SectionHeading>

          <p className="text-[color:var(--muted)] max-w-[64ch] mb-9 leading-relaxed">
            Everything runs on Stellar testnet. You need Node 22+ and a free Supabase account.{' '}
            <strong className="text-[color:var(--text)] font-medium">
              You do not need Rust
            </strong>{' '}
            — the contracts are already compiled and uploaded, and every allowance and splitter is
            a cheap instance created from the published hashes.
          </p>

          <ol className="space-y-px bg-[color:var(--line)] max-w-[76ch]">
            {[
              {
                title: 'Clone and install',
                code: `git clone ${REPO}\ncd stellar-allowance\nnpm install --prefix web`,
              },
              {
                title:
                  'Create a free Supabase project and copy its URL, service key and database URL into web/.env.local',
              },
              { title: 'Create the tables', code: 'npm run migrate' },
              {
                title:
                  'Get testnet USDC — friendbot issues XLM but not USDC, so send 5 USDC to your wallet and your agent from faucet.circle.com → Stellar Testnet',
              },
              { title: 'Start it', code: 'npm run dev' },
            ].map((step, index) => (
              <li key={step.title} className="bg-[color:var(--ground)] px-5 py-5">
                <div className="flex gap-4 items-baseline">
                  <span className="label shrink-0">{String(index + 1).padStart(2, '0')}</span>
                  <span className="text-sm leading-relaxed">{step.title}</span>
                </div>
                {step.code && (
                  <pre className="num text-xs leading-relaxed mt-3 ml-10 overflow-x-auto bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] p-3">
                    <code>{step.code}</code>
                  </pre>
                )}
              </li>
            ))}
          </ol>

          <div className="mt-9 flex flex-wrap gap-3">
            <a
              href={`${REPO}#readme`}
              className="chip chip-accent px-5 py-3"
              target="_blank"
              rel="noreferrer"
            >
              Read the full setup →
            </a>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="chip px-5 py-3 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
            >
              View on GitHub →
            </a>
          </div>
        </div>
      </section>

      {/* ============================================================= 11 faq */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 10 · FAQ ]</p>
          <SectionHeading>The questions that decide it.</SectionHeading>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-2 mt-8">
            {FAQ.map((item) => (
              <div key={item.q} className="bg-[color:var(--ground)] p-7">
                <h3 className="text-sm font-medium mb-2">{item.q}</h3>
                <p className="text-sm text-[color:var(--muted)] leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================================================== 12 closing CTA */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-20">
          <h2 className="display max-w-[16ch]">Set the limits once. Stop watching the wallet.</h2>
          <p className="mt-7 max-w-[52ch] text-[color:var(--muted)] leading-relaxed">
            Testnet, no credit card, about fifteen minutes to a working demo.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/user" className="chip chip-accent px-5 py-3">
              Set an allowance →
            </Link>
            <a
              href={`${REPO}/blob/main/docs/CONTRACT.md`}
              target="_blank"
              rel="noreferrer"
              className="chip px-5 py-3 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
            >
              Read the docs →
            </a>
          </div>
        </div>
      </section>

      {/* ========================================================== 13 footer */}
      <footer>
        <div className="mx-auto max-w-[1180px] px-6 py-10">
          <div className="flex flex-wrap gap-x-8 gap-y-3 mb-8">
            {FOOTER_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="label hover:text-[color:var(--accent)] transition-colors"
              >
                {link.label} →
              </a>
            ))}
          </div>
          <p className="label max-w-[70ch] leading-relaxed">
            Apache 2.0. Unaudited, and built for testnet. Do not put mainnet funds behind it. Not
            affiliated with the Stellar Development Foundation.
          </p>
        </div>
      </footer>
    </main>
  );
}
