import Link from 'next/link';
import { DemoRunner } from '@/components/DemoRunner';
import { FlowDiagram } from '@/components/FlowDiagram';
import { SiteHeader } from '@/components/SiteHeader';

/**
 * The landing page.
 *
 * Written for someone deciding in about fifteen seconds whether this is real, rather than for
 * someone who already knows what an agent wallet is. The previous version led with the fear —
 * "Agents can spend. Nothing stops them." — which names a problem but leaves a reader who does
 * not already have that problem with nothing to act on.
 *
 * Two rules govern every claim below, and they are the reason this file is mostly data.
 *
 * Numbers are exact and checkable. A rounded number reads as a claim; an exact one reads as a
 * measurement, and every figure here comes from a recorded run or from the code.
 *
 * The limits are volunteered rather than buried. For a product whose whole premise is that a
 * refusal is real, an overstatement anywhere costs more than a named gap ever could — so the
 * things it does not do yet get a numbered section, not a footnote.
 */

const DEMO_API_ID = process.env.DEMO_API_ID ?? '';
const DEMO_ALLOWANCE = process.env.ALLOWANCE_CONTRACT_ID ?? '';
const AGENT = process.env.DEMO_AGENT_ADDRESS ?? '';

/** The numbers a sceptic can check in about a minute. */
const STATS = [
  { value: '3', unit: 'rules', caption: 'enforced by the network, not by your agent’s code' },
  { value: '0', unit: 'USDC', caption: 'the agent can hold — its account has no USDC trustline' },
  { value: '5 / 6', unit: '', caption: 'purchases paid in the recorded run; the sixth was refused' },
  { value: '18', unit: 'tests', caption: 'across both contracts, none of which need a network' },
];

/**
 * The two audiences, and the bind each one is in. Keeping them side by side is what explains
 * why a single product has two doors — the site splits into /user and /developer, and a reader
 * arriving cold cannot otherwise tell which one is theirs.
 */
const PROBLEMS = [
  {
    tag: 'IF YOU RUN AGENTS',
    title: 'A key that can pay once can pay forever',
    lines: [
      'A retry loop is a spending loop. The same call, made forty times, is paid for forty times — and every HTTP library retries by default.',
      'An agent has no concept of expensive. A page it reads can point it at a costlier endpoint, and it will pay.',
      'A monthly budget does not stop a runaway loop. It funds one.',
      'You find out afterwards. There is no record of what got spent where, only a balance that went down.',
    ],
  },
  {
    tag: 'IF YOU RUN AN API',
    title: 'Charging per call means becoming a bank',
    lines: [
      'Subscriptions are simple but blunt. Heavy users are subsidised by light ones, and you leave money on the table.',
      'Per-call billing needs a settlement system — splitting fees, chasing payouts, handling disputes.',
      'And your developers still have to trust you. Will the platform pay out? Can it change the terms later?',
      'Building that trust is infrastructure you did not set out to write.',
    ],
  },
];

/** The three rules, with the defaults the demo ships with. */
const RULES = [
  {
    tag: 'PER_CALL',
    value: '0.10',
    title: 'Most per purchase',
    body: 'One purchase can never exceed this. The worst that a single bad instruction can cost is one cap.',
  },
  {
    tag: 'WINDOW',
    value: '0.50',
    title: 'Most per rolling window',
    body: 'A hard ceiling on the rate, not the total. The window rolls continuously, so spend cannot be parked at 23:59 and repeated at 00:01.',
  },
  {
    tag: 'ALLOWLIST',
    value: '1',
    title: 'Who may be paid',
    body: 'Only the addresses you tick. Anything not on the list is refused, however small the amount.',
  },
];

/**
 * Why it holds. Each of these is a property of the system rather than a promise about it, which
 * is the distinction the whole page is trying to earn.
 */
const MECHANISMS = [
  {
    tag: 'THE AGENT HOLDS NO USDC',
    body: 'It has a key and a little XLM for its own transaction fees, and that is all. Its account has no USDC trustline, so it cannot hold the asset it spends — not a policy, a property of the account. There is no balance to drain.',
  },
  {
    tag: 'THE REFUSAL IS THE NETWORK’S',
    body: 'A blocked purchase is not a warning or a logged event. The money does not move, because the network will not move it, and the agent’s own code has no say in it. It costs nothing either: the rules run during simulation, before anything is submitted.',
  },
  {
    tag: 'THE SPLIT CANNOT BE EDITED',
    body: 'Each API gets its own payment contract, with the developer’s share and the platform fee fixed when it is created. Setup cannot be run twice. This is arithmetic nobody can change, not a promise anyone makes.',
  },
  {
    tag: 'PAYOUTS DO NOT WAIT ON US',
    body: 'Collecting is permissionless — any address can trigger a payout, and it can only ever reach the two addresses fixed at creation. In the recorded run the payout was triggered by the agent, not by the platform.',
  },
];

/** Recorded results, not intentions. Readable on testnet by anyone who cares to look. */
const PROOF = [
  {
    figure: '0.5000000',
    unit: 'USDC',
    body: 'Six purchases of 0.1 USDC against a 0.5 window cap. Five paid, the sixth refused, and the seller ended holding exactly this. Not 0.6.',
  },
  {
    figure: '0.18 / 0.02',
    unit: 'USDC',
    body: 'Two payments of 0.1 into a seller’s contract, then paid out: 0.18 to the developer, 0.02 to the platform, and the contract left holding nothing.',
  },
  {
    figure: 'agent',
    unit: 'triggered it',
    body: 'That payout was started by the agent, not by the platform. Anyone can start one, and it can only ever reach the two addresses fixed at creation.',
  },
];

/**
 * A worked example beats a feature list for this product, because the whole value only shows up
 * over a sequence of calls. One is enough; two would be padding.
 */
const WALKTHROUGH = [
  'You set the rules: 0.50 USDC per rolling window, 0.10 at most per call, and one approved API.',
  'You deposit 2 USDC. It sits in a contract in your name, and you can take all of it back whenever you like.',
  'Your agent runs overnight and starts buying. Calls one to five go through at 0.10 each.',
  'The service starts failing and the agent’s HTTP library retries. Call six asks for another 0.10.',
  'The window is at 0.50. The contract refuses. No money moves, and the agent gets an error naming the rule that stopped it.',
  'You wake up to 1.50 USDC still in the contract, and a seller who received exactly 0.50.',
];

const FAQ = [
  {
    q: 'Can the agent just ignore the limit?',
    a: 'It never holds the money. The refusal is the payment network declining to move funds, so the agent’s own code has no say in it.',
  },
  {
    q: 'Who can take the money out?',
    a: 'Only the wallet that put it in. We deploy the contract and pay the fee, and we cannot spend from it, change its rules, or stop you emptying it.',
  },
  {
    q: 'Can I change the limits after setting them?',
    a: 'Yes — the owner can retighten or loosen all three on a running allowance, without redeploying or moving money. What has already been spent stays counted, so an edit cannot hand an agent a fresh window. The one thing nobody can change is an API’s fee split, which is fixed when its contract is created.',
  },
  {
    q: 'Does my API have to change?',
    a: 'No. Point us at the URL you already run and set a price, and you get a new URL back. No SDK, no code, no redeploy — a gateway in front collects the payment and forwards the request.',
  },
  {
    q: 'Does my agent have to change?',
    a: 'Yes, a little. It needs three calls: request the URL and get quoted a price, ask the contract to pay it, then come back with the payment. The whole integration is one file, and it is on the setup page ready to copy.',
  },
  {
    q: 'How do I know the 90/10 split is really 90/10?',
    a: 'The shares are written into the API’s own contract when it is created and setup cannot be run twice. A recorded run paid out 0.18 and 0.02 on 0.2, leaving nothing behind.',
  },
  {
    q: 'What if an API takes the payment and then fails?',
    a: 'The payment stands. There is no refund path yet — the reference and transaction are recorded, which is what a refund would need, but it is designed rather than built.',
  },
  {
    q: 'Do I need to understand blockchains?',
    a: 'You connect a wallet, type three numbers, tick which APIs may be paid, and add money. The four steps assume you have never touched one.',
  },
];

/** Said plainly and early, because the product is a promise that a refusal is real. */
const LIMITS = [
  'Not audited, not mainnet. A hackathon build on Stellar testnet using test USDC, which has no value. Do not point real money at it.',
  'Retries are not yet idempotent. A purchase that times out and is retried can pay twice — the window cap bounds what that costs, but it does not prevent it. Making payment itself idempotent is the next change.',
  'No refunds. If an API takes the payment and then fails, the payment stands.',
  'One agent per allowance. An agent that spawns sub-agents cannot yet give each one a slice of the same balance.',
  'The chain proves payment, not delivery. It can show that money moved. Whether the thing arrived is an HTTP response, and nothing on a network can attest to that.',
];

export default function Home() {
  return (
    <main className="relative z-10">
      <SiteHeader />

      {/* ------------------------------------------------------------- hero */}
      <section className="grid-field border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 pt-16 pb-14 lg:pt-20 grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div>
            <p className="label mb-6">[ SPENDING LIMITS FOR AI AGENTS · STELLAR TESTNET ]</p>

            <h1 className="display max-w-[15ch]">
              Your agent can spend. Your budget cannot.
            </h1>

            <p className="mt-7 max-w-[54ch] text-[color:var(--text)] leading-relaxed">
              Set three limits: most per purchase, most per rolling window, and which addresses may
              be paid. Your agent has to ask before every purchase, and the contract answers.
            </p>

            <p className="mt-5 max-w-[54ch] text-[color:var(--muted)] leading-relaxed">
              Handing an agent a wallet hands it everything in the wallet, to spend on anything,
              with you finding out afterwards. Stellar Allowance keeps the money where the agent
              cannot reach it. Break a rule and the money does not move — because the network will
              not move it, not because the agent decided to behave.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/user" className="chip chip-accent px-4 py-2.5">
                Give an agent a budget →
              </Link>
              <Link
                href="/developer"
                className="chip px-4 py-2.5 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
              >
                Charge for my API →
              </Link>
            </div>
          </div>

          <div className="lg:max-w-[420px] lg:justify-self-end w-full">
            <p className="label mb-4">[ THE PATH A PAYMENT TAKES ]</p>
            <FlowDiagram allowanceId={DEMO_ALLOWANCE} agentAddress={AGENT} />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- numbers, early */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="grid gap-px bg-[color:var(--line)] sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((stat) => (
              <div key={stat.caption} className="bg-[color:var(--ground)] px-6 py-7">
                <p className="num text-3xl text-[color:var(--accent)]">
                  {stat.value}
                  {stat.unit && (
                    <span className="text-sm text-[color:var(--faint)]"> {stat.unit}</span>
                  )}
                </p>
                <p className="mt-2 text-sm text-[color:var(--muted)] leading-relaxed">
                  {stat.caption}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- 01 problem */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 01 · THE PROBLEM, FROM BOTH ENDS ]</p>
          <h2 className="text-3xl font-medium tracking-tight mb-3">
            A wallet says yes to everything.
          </h2>
          <p className="text-[color:var(--muted)] max-w-[62ch] mb-9 leading-relaxed">
            A key that can sign a payment can sign every payment. It has no idea what a thing
            should cost, no idea who it is paying, and no way to say no twice in a row. On the
            other side of the same transaction, an API that wants to charge per call has to build
            a settlement system before it can take a cent.
          </p>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-2">
            {PROBLEMS.map((problem) => (
              <div key={problem.tag} className="bg-[color:var(--ground)] p-7">
                <p className="label mb-4">[ {problem.tag} ]</p>
                <h3 className="text-base font-medium mb-4">{problem.title}</h3>
                <ul className="space-y-3">
                  {problem.lines.map((line) => (
                    <li
                      key={line}
                      className="text-sm text-[color:var(--muted)] leading-relaxed pl-4 border-l border-[color:var(--line-bright)]"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- 02 rules */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 02 · THE THREE RULES YOU SET ]</p>
          <h2 className="text-3xl font-medium tracking-tight mb-3">
            How much, how often, and who.
          </h2>
          <p className="text-[color:var(--muted)] max-w-[62ch] mb-9 leading-relaxed">
            You type three numbers and tick which APIs may be paid. All three can be changed later
            on a running allowance, without redeploying or moving your money — and what has
            already been spent stays counted, so an edit cannot hand an agent a fresh window.
          </p>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-3">
            {RULES.map((rule) => (
              <div key={rule.tag} className="bg-[color:var(--ground)] p-7">
                <div className="flex items-baseline justify-between mb-5">
                  <span className="label">[ {rule.tag} ]</span>
                  <span className="num text-2xl text-[color:var(--accent)]">{rule.value}</span>
                </div>
                <h3 className="text-base font-medium mb-2">{rule.title}</h3>
                <p className="text-sm text-[color:var(--muted)] leading-relaxed">{rule.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- 03 mechanism */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 03 · WHY IT HOLDS ]</p>
          <h2 className="text-3xl font-medium tracking-tight mb-3">
            Four properties, not four promises.
          </h2>
          <p className="text-[color:var(--muted)] max-w-[62ch] mb-9 leading-relaxed">
            Nothing about the agent gets safer. It still has a key, still makes the same calls,
            still gets fed the same instructions. What changes is that the key no longer opens the
            money — it only opens a request.
          </p>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-2">
            {MECHANISMS.map((item) => (
              <div key={item.tag} className="bg-[color:var(--ground)] p-7">
                <p className="label mb-3" style={{ color: 'var(--lavender)' }}>
                  [ {item.tag} ]
                </p>
                <p className="text-sm text-[color:var(--muted)] leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- 04 walkthrough */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16 grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-start">
          <div>
            <p className="label mb-4">[ 04 · ONE NIGHT, STEP BY STEP ]</p>
            <h2 className="text-3xl font-medium tracking-tight mb-4 max-w-[14ch] leading-tight">
              What a capped run looks like.
            </h2>
            <p className="text-[color:var(--muted)] leading-relaxed max-w-[46ch]">
              An agent doing research overnight, against an API that starts failing halfway
              through. The interesting part is step five.
            </p>
          </div>

          <ol className="space-y-px bg-[color:var(--line)]">
            {WALKTHROUGH.map((step, index) => (
              <li
                key={step}
                className="bg-[color:var(--ground)] px-5 py-4 flex gap-4 items-baseline"
              >
                <span className="label shrink-0">{String(index + 1).padStart(2, '0')}</span>
                <span
                  className="text-sm leading-relaxed"
                  style={{ color: index === 4 ? 'var(--held)' : 'var(--muted)' }}
                >
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --------------------------------------------------------- 05 proof */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 05 · PROOF ]</p>
          <h2 className="text-3xl font-medium tracking-tight mb-3">
            We ran it. Here is what the chain says.
          </h2>
          <p className="text-[color:var(--muted)] max-w-[62ch] mb-9 leading-relaxed">
            Not descriptions of intent — the recorded results of two runs against deployed
            contracts, written to seven decimal places because the point is the seventh one.
          </p>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-3 mb-12">
            {PROOF.map((item) => (
              <div key={item.figure} className="bg-[color:var(--ground)] p-7">
                <p className="num text-xl text-[color:var(--held)]">
                  {item.figure}{' '}
                  <span className="text-xs text-[color:var(--faint)]">{item.unit}</span>
                </p>
                <p className="mt-3 text-sm text-[color:var(--muted)] leading-relaxed">
                  {item.body}
                </p>
              </div>
            ))}
          </div>

          <h3 className="text-xl font-medium tracking-tight mb-2">The same agent, run twice</h3>
          <p className="text-[color:var(--muted)] max-w-[58ch] mb-8 leading-relaxed">
            Same script, same API, same seven attempts against the same failing service. The only
            thing that changes is where the money sits. Both runs pay real testnet USDC.
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

      {/* ----------------------------------------------------- 06 two sides */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 06 · TWO SIDES OF THE SAME PAYMENT ]</p>
          <h2 className="text-3xl font-medium tracking-tight mb-3">Two sides. One payment.</h2>
          <p className="text-[color:var(--muted)] max-w-[62ch] mb-9 leading-relaxed">
            One of you is setting a limit; the other is getting paid. Neither has to trust the
            other, and neither has to trust us.
          </p>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-2">
            <div className="bg-[color:var(--ground)] p-7">
              <p className="label mb-4">[ IF YOU RUN AN AGENT ]</p>
              <h3 className="text-base font-medium mb-3">Four steps, then three calls</h3>
              <p className="text-sm text-[color:var(--muted)] leading-relaxed mb-5">
                Connect a wallet, create an agent account, set the rules, add money. Your
                agent&rsquo;s code needs three calls: request the URL and get quoted a price, ask
                the contract to pay it, then come back with the payment. The whole integration is
                one file, and it is on the setup page ready to copy. A refused purchase throws with
                the rule that stopped it, so your error handling can tell &ldquo;too
                expensive&rdquo; from &ldquo;not on the list&rdquo;.
              </p>
              <Link
                href="/user"
                className="chip px-4 py-2.5 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
              >
                Give an agent a budget →
              </Link>
            </div>

            <div className="bg-[color:var(--ground)] p-7">
              <p className="label mb-4">[ IF YOU RUN AN API ]</p>
              <h3 className="text-base font-medium mb-3">Point at a URL, set a price</h3>
              <p className="text-sm text-[color:var(--muted)] leading-relaxed mb-5">
                Nothing about your API changes: no SDK, no code, no redeploy. A gateway in front
                collects the payment and forwards the request, and you get a new URL to share.
                Every paid call sends you 90% into a contract deployed for your API alone. You do
                not have to trust us to forward it — collecting is permissionless, and the money
                can only ever reach your address and ours.
              </p>
              <Link
                href="/developer"
                className="chip px-4 py-2.5 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
              >
                Charge for my API →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- 07 faq */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 07 · QUESTIONS WORTH ASKING ]</p>
          <h2 className="text-3xl font-medium tracking-tight mb-9">
            The ones a sceptic asks first.
          </h2>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-2">
            {FAQ.map((item) => (
              <div key={item.q} className="bg-[color:var(--ground)] p-7">
                <h3 className="text-sm font-medium mb-2">{item.q}</h3>
                <p className="text-sm text-[color:var(--muted)] leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- 08 what it is not */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ 08 · WHAT THIS IS NOT DOING YET ]</p>
          <h2 className="text-3xl font-medium tracking-tight mb-3">The list, before you ask.</h2>
          <p className="text-[color:var(--muted)] max-w-[62ch] mb-9 leading-relaxed">
            A spending control that overstates itself is worse than none, because the whole
            product is the promise that a refusal is real.
          </p>

          <ul className="space-y-px bg-[color:var(--line)] max-w-[82ch]">
            {LIMITS.map((limit) => (
              <li
                key={limit}
                className="bg-[color:var(--ground)] px-5 py-4 text-sm text-[color:var(--muted)] leading-relaxed"
              >
                {limit}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ----------------------------------------------------- closing call */}
      <section>
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-4">[ START ]</p>
          <h2 className="display max-w-[13ch]">Set a limit in four steps.</h2>
          <p className="mt-6 max-w-[56ch] text-[color:var(--muted)] leading-relaxed">
            Connect a wallet. Create an agent. Set the rules. Add money. We deploy the contract and
            pay the fee — and we cannot spend from it, change its rules, or stop you emptying it.
            Adding money and taking it back are both signed by you.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/user" className="chip chip-accent px-4 py-2.5">
              Give an agent a budget →
            </Link>
            <Link
              href="/developer"
              className="chip px-4 py-2.5 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
            >
              Charge for my API →
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-8 flex flex-wrap gap-x-8 gap-y-2 justify-between label">
          <span>Stellar testnet · USDC · unaudited</span>
          <span>Not affiliated with the Stellar Development Foundation</span>
        </div>
      </footer>
    </main>
  );
}
