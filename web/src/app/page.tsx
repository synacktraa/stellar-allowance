import { DemoRunner } from '@/components/DemoRunner';
import { FlowDiagram } from '@/components/FlowDiagram';

const DEMO_API_ID = process.env.DEMO_API_ID ?? '';
const DEMO_ALLOWANCE = process.env.ALLOWANCE_CONTRACT_ID ?? '';
const AGENT = process.env.DEMO_AGENT_ADDRESS ?? '';

export default function Home() {
  return (
    <main className="relative z-10">
      {/* ---------------------------------------------------------- top bar */}
      <header className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 h-14 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-sm tracking-tight">STELLAR//ALLOWANCE</span>
          </div>
          <nav className="hidden md:flex gap-8 label">
            <span>01. Problem</span>
            <span>02. Mechanism</span>
            <span>03. Proof</span>
          </nav>
          <span className="chip">stellar:testnet</span>
        </div>
      </header>

      {/* ------------------------------------------------------------- hero */}
      <section className="grid-field border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 pt-20 pb-10 relative">
          <p className="label mb-6">[ ON-CHAIN SPENDING LIMITS FOR AI AGENTS ]</p>

          <h1 className="display max-w-[16ch]">
            Agents can spend.
            <br />
            Nothing stops them.
          </h1>

          <p className="mt-7 max-w-[52ch] text-[color:var(--muted)] leading-relaxed">
            An agent that pays for API calls needs a wallet, and a wallet has no limits. When a
            request fails, every HTTP library retries — and each retry is now a real payment.
            Stellar Allowance holds the money in a contract instead, and makes the agent ask.
          </p>

          <div className="mt-10 -mx-2">
            <FlowDiagram allowanceId={DEMO_ALLOWANCE} agentAddress={AGENT} />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- the rules */}
      <section className="border-b border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-8">[ 02 · WHAT THE CONTRACT ENFORCES ]</p>

          <div className="grid gap-px bg-[color:var(--line)] md:grid-cols-3">
            {[
              {
                tag: 'PER_CALL',
                value: '0.10',
                title: 'Cap a single purchase',
                body: 'A page an agent reads can point it at an expensive endpoint, and the agent has no concept of expensive. The worst one bad instruction can cost is one cap.',
              },
              {
                tag: 'WINDOW',
                value: '0.50',
                title: 'Cap the rate, not the total',
                body: 'A monthly budget does not stop a retry loop, it funds one. The window rolls continuously, so a counter that resets cannot be spent twice across the boundary.',
              },
              {
                tag: 'ALLOWLIST',
                value: '1',
                title: 'Limit who can be paid',
                body: 'Recipients arrive from outside — off a web page, out of a model. Creating an account to receive money takes seconds and costs nothing.',
              },
            ].map((rule) => (
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

          <p className="mt-8 text-sm text-[color:var(--muted)] max-w-[62ch]">
            A refusal is not a warning or a logged event. If a purchase breaks a rule the money
            does not move, because the network will not let it — the agent&rsquo;s own code has no
            say in this.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------------- the proof */}
      <section>
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <p className="label mb-3">[ 03 · PROOF ]</p>
          <h2 className="text-2xl font-medium tracking-tight mb-2">
            The same agent, run twice
          </h2>
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

      <footer className="border-t border-[color:var(--line)]">
        <div className="mx-auto max-w-[1180px] px-6 py-8 flex flex-wrap gap-x-8 gap-y-2 justify-between label">
          <span>Stellar testnet · USDC · unaudited</span>
          <span>Not affiliated with the Stellar Development Foundation</span>
        </div>
      </footer>
    </main>
  );
}
