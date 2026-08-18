'use client';

import { useCallback, useEffect, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { connect, deposit, revoke, withdraw, type Wallet } from '@/lib/freighter';
import { SiteHeader } from '@/components/SiteHeader';

/**
 * The user tab.
 *
 * Four clicks from never having touched a blockchain to an agent that cannot overspend:
 * connect, create an agent, create the allowance, add money.
 *
 * The agent's secret is generated in this tab and never leaves it. It is shown once, kept in a
 * plain variable for the session, and lost on refresh. That is only defensible because the key
 * is nearly powerless — it can ask the contract and nothing else — and that is worth saying on
 * screen rather than hiding.
 */

type State = {
  balance: string;
  remaining: string;
  spent_in_window: string;
  revoked: boolean;
  rules: {
    max_per_call: string;
    window_ledgers: number;
    window_cap: string;
    allowlist: string[];
  };
};

const usdc = (stroops?: string) => (stroops ? (Number(stroops) / 1e7).toFixed(2) : '0.00');
const short = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`;

type DirectoryApi = {
  id: string;
  name: string;
  upstream_url: string;
  price_stroops: string;
  splitter_contract_id: string;
};

/** Testnet closes a ledger roughly every five seconds. */
const LEDGERS_PER_MINUTE = 12;

export default function UserPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [agent, setAgent] = useState<{ publicKey: string; secret: string } | null>(null);
  const [secretShown, setSecretShown] = useState(false);
  const [contractId, setContractId] = useState('');
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('2.00');

  // The rules, before they are carved into a contract.
  const [maxPerCall, setMaxPerCall] = useState('0.10');
  const [windowCap, setWindowCap] = useState('0.50');
  const [windowMinutes, setWindowMinutes] = useState('15');
  const [directory, setDirectory] = useState<DirectoryApi[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const refresh = useCallback(async (id: string) => {
    const response = await fetch(`/api/allowances/${id}`);
    if (response.ok) setState(await response.json());
  }, []);

  useEffect(() => {
    if (!contractId) return;
    refresh(contractId);
    const timer = setInterval(() => refresh(contractId), 6000);
    return () => clearInterval(timer);
  }, [contractId, refresh]);

  useEffect(() => {
    fetch('/api/directory')
      .then((r) => r.json())
      .then((body) => {
        const apis: DirectoryApi[] = body.apis ?? [];
        setDirectory(apis);
        // Nothing is allowed by default. An empty allowlist refuses everything, which is the
        // right starting point for a spending limit.
        setAllowed([]);
      })
      .catch(() => setDirectory([]));
  }, []);

  async function createAgent() {
    const kp = Keypair.random();
    await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
    setAgent({ publicKey: kp.publicKey(), secret: kp.secret() });
    setSecretShown(true);
  }

  async function createAllowance() {
    if (!wallet || !agent) return;
    if (allowed.length === 0) {
      throw new Error('Choose at least one API the agent is allowed to pay.');
    }
    const response = await fetch('/api/allowances', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner: wallet.address,
        agent: agent.publicKey,
        max_per_call: String(Math.round(Number(maxPerCall) * 1e7)),
        window_cap: String(Math.round(Number(windowCap) * 1e7)),
        window_ledgers: Math.max(1, Math.round(Number(windowMinutes) * LEDGERS_PER_MINUTE)),
        allowlist: allowed,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Could not create the allowance.');
    setContractId(body.contract_id);
  }

  const callsPerWindow = Math.floor(Number(windowCap) / Math.max(Number(maxPerCall), 1e-7));

  const step = (n: number, done: boolean, title: string, children: React.ReactNode) => (
    <div className="panel p-6 pt-9">
      <span className="panel-tag">
        [ {String(n).padStart(2, '0')} · {done ? 'DONE' : 'TODO'} ]
      </span>
      <h2 className="text-base font-medium mb-4" style={{ color: done ? 'var(--held)' : undefined }}>
        {title}
      </h2>
      {children}
    </div>
  );

  return (
    <main className="relative z-10">
      <SiteHeader
        right={<span className="chip">{wallet ? short(wallet.address) : 'not connected'}</span>}
      />

      <div className="mx-auto max-w-[900px] px-6 py-12 space-y-4">
        <div className="mb-8">
          <p className="label mb-4">[ FOR AGENT OWNERS ]</p>
          <h1 className="display max-w-[14ch]">Give your agent a budget.</h1>
          <p className="mt-6 max-w-[54ch] text-[color:var(--muted)] leading-relaxed">
            The money stays in a contract you own. Your agent can ask it to pay, and it will
            refuse anything outside the rules you set. We deploy it and pay the fee; we cannot
            spend from it or change it.
          </p>
        </div>

        {error && (
          <div className="panel p-4 border-[color:var(--drained)]">
            <p className="text-sm" style={{ color: 'var(--drained)' }}>{error}</p>
          </div>
        )}

        {/* 1 — connect */}
        {step(1, Boolean(wallet), 'Connect your wallet', (
          <>
            <p className="text-sm text-[color:var(--muted)] mb-4 max-w-[52ch]">
              This is how you prove the allowance is yours. Freighter, on Testnet.
            </p>
            {wallet ? (
              <p className="num text-sm">{wallet.address}</p>
            ) : (
              <button
                className="chip chip-accent px-4 py-2.5 cursor-pointer"
                disabled={busy !== null}
                onClick={() => run('connect', async () => setWallet(await connect()))}
              >
                {busy === 'connect' ? 'connecting…' : 'connect freighter'}
              </button>
            )}
          </>
        ))}

        {/* 2 — agent */}
        {wallet && step(2, Boolean(agent), 'Create an agent account', (
          <>
            <p className="text-sm text-[color:var(--muted)] mb-4 max-w-[52ch]">
              Generated in this tab and never sent to us. It gets a little XLM for fees and{' '}
              <strong className="text-[color:var(--text)]">no USDC trustline</strong>, so it
              cannot hold money at all — only ask.
            </p>
            {agent ? (
              <div className="space-y-3">
                <div>
                  <p className="label mb-1">public key</p>
                  <p className="num text-sm break-all">{agent.publicKey}</p>
                </div>
                {secretShown ? (
                  <div className="panel p-4 border-[color:var(--accent-dim)]">
                    <p className="label mb-1" style={{ color: 'var(--accent)' }}>
                      secret — shown once
                    </p>
                    <p className="num text-sm break-all mb-3">{agent.secret}</p>
                    <button
                      className="chip cursor-pointer"
                      onClick={() => setSecretShown(false)}
                    >
                      I have saved it
                    </button>
                  </div>
                ) : (
                  <p className="label">secret hidden · lost on refresh</p>
                )}
              </div>
            ) : (
              <button
                className="chip chip-accent px-4 py-2.5 cursor-pointer"
                disabled={busy !== null}
                onClick={() => run('agent', createAgent)}
              >
                {busy === 'agent' ? 'creating…' : 'create agent'}
              </button>
            )}
          </>
        ))}

        {/* 3 — allowance */}
        {agent && step(3, Boolean(contractId), 'Set the rules', (
          <>
            {contractId ? (
              <p className="num text-sm break-all">{contractId}</p>
            ) : (
              <>
                <p className="text-sm text-[color:var(--muted)] mb-5 max-w-[52ch]">
                  These are enforced by the network, not by your agent&rsquo;s code. Break one and
                  the money does not move. All three can be changed later without redeploying.
                </p>

                <div className="grid gap-4 sm:grid-cols-3 mb-5">
                  <label className="block">
                    <span className="label block mb-1.5">most per call</span>
                    <input
                      value={maxPerCall}
                      onChange={(e) => setMaxPerCall(e.target.value)}
                      className="w-full num bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="label block mb-1.5">most per window</span>
                    <input
                      value={windowCap}
                      onChange={(e) => setWindowCap(e.target.value)}
                      className="w-full num bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="label block mb-1.5">window (minutes)</span>
                    <input
                      value={windowMinutes}
                      onChange={(e) => setWindowMinutes(e.target.value)}
                      className="w-full num bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <p className="label mb-6">
                  = at most {callsPerWindow} calls in any {windowMinutes} minutes, rolling
                </p>

                <p className="label block mb-2">which APIs may be paid</p>
                {directory.length === 0 ? (
                  <p className="text-sm text-[color:var(--muted)] mb-5">
                    No APIs registered yet.{' '}
                    <a href="/developer" className="text-[color:var(--accent)] underline">
                      Add one first
                    </a>
                    .
                  </p>
                ) : (
                  <div className="space-y-px bg-[color:var(--line)] mb-3">
                    {directory.map((api) => {
                      const on = allowed.includes(api.splitter_contract_id);
                      return (
                        <button
                          key={api.id}
                          onClick={() =>
                            setAllowed((list) =>
                              on
                                ? list.filter((a) => a !== api.splitter_contract_id)
                                : [...list, api.splitter_contract_id],
                            )
                          }
                          className="w-full text-left bg-[color:var(--ground)] px-3 py-3 flex items-center justify-between gap-4 cursor-pointer"
                        >
                          <span className="min-w-0">
                            <span
                              className="text-sm block"
                              style={{ color: on ? 'var(--accent)' : undefined }}
                            >
                              {on ? '✓ ' : '  '}
                              {api.name}
                            </span>
                            <span className="num text-xs text-[color:var(--faint)] break-all">
                              {api.upstream_url}
                            </span>
                          </span>
                          <span className="num text-xs whitespace-nowrap">
                            {usdc(api.price_stroops)} / call
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="label mb-5">
                  anything not on this list is refused, however small the amount
                </p>

                <button
                  className="chip chip-accent px-4 py-2.5 cursor-pointer disabled:opacity-40"
                  disabled={busy !== null || allowed.length === 0}
                  onClick={() => run('allowance', createAllowance)}
                >
                  {busy === 'allowance' ? 'deploying…' : 'create allowance'}
                </button>
              </>
            )}
          </>
        ))}

        {/* 4 — fund + dashboard */}
        {contractId && (
          <div className="panel p-6 pt-9">
            <span className="panel-tag">[ 04 · LIVE ]</span>

            <div className="flex flex-wrap gap-8 mb-7">
              <div>
                <p className="label mb-1">available</p>
                <p className="num text-3xl text-[color:var(--accent)]">
                  {usdc(state?.balance)} <span className="text-sm text-[color:var(--faint)]">USDC</span>
                </p>
              </div>
              <div>
                <p className="label mb-1">spent this window</p>
                <p className="num text-3xl">
                  {usdc(state?.spent_in_window)}
                  <span className="text-sm text-[color:var(--faint)]">
                    {' '}/ {usdc(state?.rules.window_cap)}
                  </span>
                </p>
              </div>
              <div>
                <p className="label mb-1">agent</p>
                <p className="num text-3xl" style={{ color: state?.revoked ? 'var(--drained)' : 'var(--held)' }}>
                  {state?.revoked ? 'revoked' : 'active'}
                </p>
              </div>
            </div>

            {state && (
              <div className="h-1 bg-[color:var(--line)] mb-7">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${Math.min(100, (Number(state.spent_in_window) / Number(state.rules.window_cap)) * 100)}%`,
                    background: Number(state.remaining) === 0 ? 'var(--held)' : 'var(--accent)',
                  }}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="num bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 w-28 text-sm"
                aria-label="amount in USDC"
              />
              <button
                className="chip chip-accent px-4 py-2.5 cursor-pointer"
                disabled={busy !== null}
                onClick={() =>
                  run('deposit', async () => {
                    await deposit(wallet!.address, contractId, BigInt(Math.round(Number(amount) * 1e7)));
                    await refresh(contractId);
                  })
                }
              >
                {busy === 'deposit' ? 'signing…' : 'add money'}
              </button>
              <button
                className="chip px-4 py-2.5 cursor-pointer"
                disabled={busy !== null}
                onClick={() =>
                  run('withdraw', async () => {
                    await withdraw(wallet!.address, contractId, BigInt(state?.balance ?? '0'));
                    await refresh(contractId);
                  })
                }
              >
                {busy === 'withdraw' ? 'signing…' : 'take it all back'}
              </button>
              <button
                className="chip px-4 py-2.5 cursor-pointer"
                style={{ borderColor: 'var(--drained)', color: 'var(--drained)' }}
                disabled={busy !== null || state?.revoked}
                onClick={() =>
                  run('revoke', async () => {
                    await revoke(wallet!.address, contractId);
                    await refresh(contractId);
                  })
                }
              >
                {busy === 'revoke' ? 'signing…' : 'stop the agent'}
              </button>
            </div>

            <p className="label mt-5">
              adding money and taking it back are signed by you — we cannot do either
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
