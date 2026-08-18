'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import {
  connect,
  createAgentAccount,
  deposit,
  revoke,
  setRules,
  withdraw,
  type Wallet,
} from '@/lib/freighter';
import { SiteHeader } from '@/components/SiteHeader';
import { Step } from '@/components/Step';
import { Copyable } from '@/components/Copyable';
import { AgentSnippet } from '@/components/AgentSnippet';

/**
 * The user tab.
 *
 * Four steps from never having touched a blockchain to an agent that cannot overspend: connect,
 * create an agent, set the rules, add money.
 *
 * All five steps render from the first paint, locked ones dimmed. Revealing them one at a time
 * meant the page arrived as a single card in an empty viewport, which reads as unfinished rather
 * than as focused — a visitor could not see what they were being asked to commit to.
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

type Existing = { contract_id: string; agent_address: string; created_at: string };

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
  // XLM, for the agent's own transaction fees. One is the account reserve; the rest is roughly
  // a thousand spend calls at testnet resource prices.
  const [agentXlm, setAgentXlm] = useState('5');

  // Allowances this wallet already owns. Without this the page could only ever create another
  // one: a refresh dropped the contract id and there was no way back to it.
  const [existing, setExisting] = useState<Existing[]>([]);
  const [reopened, setReopened] = useState<Existing | null>(null);

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

  useEffect(() => {
    if (!wallet) return;
    fetch(`/api/allowances?owner=${wallet.address}`)
      .then((r) => r.json())
      .then((body) => setExisting(body.allowances ?? []))
      .catch(() => setExisting([]));
  }, [wallet]);

  // A reopened allowance already has rules on chain. Show those in the editor rather than the
  // creation defaults, or the first edit silently reverts limits the owner never touched.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!state || !reopened || hydrated.current) return;
    hydrated.current = true;
    setMaxPerCall(usdc(state.rules.max_per_call));
    setWindowCap(usdc(state.rules.window_cap));
    setWindowMinutes(String(Math.round(state.rules.window_ledgers / LEDGERS_PER_MINUTE)));
    setAllowed(state.rules.allowlist);
  }, [state, reopened]);

  async function createAgent() {
    if (!wallet) return;
    if (!(Number(agentXlm) > 0)) {
      throw new Error('Give the agent a starting balance in XLM.');
    }

    // The key is generated here and the account is brought into existence by the owner's own
    // transaction. Only set it in state once that succeeds — a keypair with no account behind
    // it looks identical on screen and fails at the first spend.
    const kp = Keypair.random();
    await createAgentAccount(wallet.address, kp.publicKey(), Number(agentXlm).toFixed(7));

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
  const agentAddress = agent?.publicKey ?? reopened?.agent_address ?? null;

  const rulesFields = (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="block">
        <span className="label block mb-1.5">most per call</span>
        <input
          value={maxPerCall}
          onChange={(e) => setMaxPerCall(e.target.value)}
          inputMode="decimal"
          className="w-full num bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="label block mb-1.5">most per window</span>
        <input
          value={windowCap}
          onChange={(e) => setWindowCap(e.target.value)}
          inputMode="decimal"
          className="w-full num bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="label block mb-1.5">window (minutes)</span>
        <input
          value={windowMinutes}
          onChange={(e) => setWindowMinutes(e.target.value)}
          inputMode="numeric"
          className="w-full num bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 text-sm"
        />
      </label>
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
        <Step
          n={1}
          state={wallet ? 'done' : 'todo'}
          title="Connect your wallet"
          summary="Proves the allowance is yours."
        >
          <p className="text-sm text-[color:var(--muted)] mb-4 max-w-[52ch]">
            This is how you prove the allowance is yours. Freighter, on Testnet.
          </p>
          {wallet ? (
            <p className="num text-sm break-all">{wallet.address}</p>
          ) : (
            <button
              className="chip chip-accent px-4 py-2.5 cursor-pointer"
              disabled={busy !== null}
              onClick={() => run('connect', async () => setWallet(await connect()))}
            >
              {busy === 'connect' ? 'connecting…' : 'connect freighter'}
            </button>
          )}
        </Step>

        {/* Allowances this wallet already owns. */}
        {wallet && existing.length > 0 && !contractId && (
          <div className="panel p-6 pt-9">
            <span className="panel-tag">[ ALREADY YOURS ]</span>
            <p className="text-sm text-[color:var(--muted)] mb-4 max-w-[52ch]">
              Open one of these instead of making another. Its balance and rules are read live
              from the chain.
            </p>
            <div className="space-y-px bg-[color:var(--line)]">
              {existing.map((row) => (
                <button
                  key={row.contract_id}
                  onClick={() => {
                    setReopened(row);
                    setContractId(row.contract_id);
                  }}
                  className="w-full text-left bg-[color:var(--ground)] px-3 py-3 flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-[color:var(--panel-2)] transition-colors"
                >
                  <span className="num text-xs break-all">{row.contract_id}</span>
                  <span className="label whitespace-nowrap">
                    agent {short(row.agent_address)} · open →
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 2 — agent */}
        <Step
          n={2}
          state={!wallet ? 'locked' : agentAddress ? 'done' : 'todo'}
          title="Create an agent account"
          summary="A key for your agent, generated in this tab and funded from your wallet. It gets no USDC trustline, so it cannot hold money at all — only ask."
        >
          <p className="text-sm text-[color:var(--muted)] mb-4 max-w-[52ch]">
            Generated in this tab and never sent to us. You create its account from your own
            wallet — the same way you would on mainnet, where nobody hands out funded accounts.
            The XLM below covers the agent&rsquo;s transaction fees and is the only asset it ever
            holds: it gets{' '}
            <strong className="text-[color:var(--text)]">no USDC trustline</strong>, so it cannot
            hold the money it spends, only ask for it.
          </p>
          {agentAddress ? (
            <div className="space-y-3">
              <div>
                <p className="label mb-1">public key</p>
                <Copyable value={agentAddress} label="agent public key" />
              </div>
              {agent && secretShown ? (
                <div className="panel p-4 border-[color:var(--accent-dim)]">
                  <p className="label mb-1" style={{ color: 'var(--accent)' }}>
                    secret — shown once
                  </p>
                  <p className="num text-sm break-all mb-3">{agent.secret}</p>
                  <button className="chip cursor-pointer" onClick={() => setSecretShown(false)}>
                    I have saved it
                  </button>
                </div>
              ) : (
                <p className="label">
                  {agent ? 'secret hidden · lost on refresh' : 'created earlier · secret not stored'}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3 mb-3">
                <label className="block">
                  <span className="label block mb-1.5">starting XLM</span>
                  <input
                    value={agentXlm}
                    onChange={(e) => setAgentXlm(e.target.value)}
                    inputMode="decimal"
                    className="num bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 w-28 text-sm"
                  />
                </label>
                <button
                  className="chip chip-accent px-4 py-2.5 cursor-pointer"
                  disabled={busy !== null}
                  onClick={() => run('agent', createAgent)}
                >
                  {busy === 'agent' ? 'signing…' : 'create and fund agent'}
                </button>
              </div>
              <p className="label">
                1 XLM is the account reserve · the rest pays the agent&rsquo;s own fees, roughly
                a thousand purchases
              </p>
            </>
          )}
        </Step>

        {/* 3 — allowance */}
        <Step
          n={3}
          state={!agentAddress ? 'locked' : contractId ? 'done' : 'todo'}
          title="Set the rules"
          summary="A cap per purchase, a cap per rolling window, and the list of APIs that may be paid. Enforced by the network, not by your agent's code."
        >
          {contractId ? (
            <Copyable value={contractId} label="allowance contract id" />
          ) : (
            <>
              <p className="text-sm text-[color:var(--muted)] mb-5 max-w-[52ch]">
                These are enforced by the network, not by your agent&rsquo;s code. Break one and
                the money does not move. All three can be changed later without redeploying.
              </p>

              <div className="mb-5">{rulesFields}</div>

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
        </Step>

        {/* 4 — fund + dashboard */}
        <Step
          n={4}
          state={contractId ? 'todo' : 'locked'}
          title="Add money and watch it"
          summary="Balance, spend against the window cap, and a switch that stops the agent. Read live from the chain."
        >
          <div className="flex flex-wrap gap-8 mb-7">
            <div>
              <p className="label mb-1">available</p>
              <p className="num text-3xl text-[color:var(--accent)]">
                {usdc(state?.balance)}{' '}
                <span className="text-sm text-[color:var(--faint)]">USDC</span>
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
              <p
                className="num text-3xl"
                style={{ color: state?.revoked ? 'var(--drained)' : 'var(--held)' }}
              >
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
              inputMode="decimal"
              className="num bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 w-28 text-sm"
              aria-label="amount in USDC"
            />
            <button
              className="chip chip-accent px-4 py-2.5 cursor-pointer"
              disabled={busy !== null}
              onClick={() =>
                run('deposit', async () => {
                  await deposit(
                    wallet!.address,
                    contractId,
                    BigInt(Math.round(Number(amount) * 1e7)),
                  );
                  await refresh(contractId);
                })
              }
            >
              {busy === 'deposit' ? 'signing…' : 'add money'}
            </button>
            <button
              className="chip px-4 py-2.5 cursor-pointer disabled:opacity-40"
              disabled={busy !== null || Number(state?.balance ?? '0') === 0}
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
              className="chip px-4 py-2.5 cursor-pointer disabled:opacity-40"
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
        </Step>

        {/* 5 — change the rules on a live allowance */}
        <Step
          n={5}
          state={contractId && state ? 'todo' : 'locked'}
          title="Change the rules later"
          summary="Tighten or loosen the limits on a running allowance, without redeploying or moving your money."
        >
          <p className="text-sm text-[color:var(--muted)] mb-5 max-w-[54ch]">
            These take effect on the next purchase, without redeploying or moving your money. What
            has already been spent stays counted — otherwise an agent at its cap could be handed a
            fresh window by any edit.
          </p>

          <div className="mb-4">{rulesFields}</div>

          <p className="label mb-5">
            currently {usdc(state?.rules.max_per_call)} per call ·{' '}
            {usdc(state?.rules.window_cap)} per{' '}
            {((state?.rules.window_ledgers ?? 0) / LEDGERS_PER_MINUTE).toFixed(0)} min
            {Number(windowMinutes) < 10 && (
              <span style={{ color: 'var(--accent)' }}>
                {' '}· under 10 minutes and spends expire faster than an agent can make them
              </span>
            )}
          </p>

          <button
            className="chip chip-accent px-4 py-2.5 cursor-pointer"
            disabled={busy !== null}
            onClick={() =>
              run('rules', async () => {
                await setRules(wallet!.address, contractId, {
                  maxPerCall: BigInt(Math.round(Number(maxPerCall) * 1e7)),
                  windowCap: BigInt(Math.round(Number(windowCap) * 1e7)),
                  windowLedgers: Math.max(
                    1,
                    Math.round(Number(windowMinutes) * LEDGERS_PER_MINUTE),
                  ),
                  allowlist: allowed.length > 0 ? allowed : (state?.rules.allowlist ?? []),
                });
                await refresh(contractId);
              })
            }
          >
            {busy === 'rules' ? 'signing…' : 'update rules'}
          </button>
        </Step>

        {/* 6 — what the agent actually does with any of this */}
        <Step
          n={6}
          state={contractId ? 'todo' : 'locked'}
          title="Point your agent at it"
          summary="Three calls: get quoted a price, ask the contract to pay it, come back with the payment."
        >
          <p className="text-sm text-[color:var(--muted)] mb-5 max-w-[54ch]">
            Your agent holds only its own key. It never sees a balance and cannot move money —
            it asks, and the contract answers. The allowance is found from the agent&rsquo;s key,
            so there is no contract id to hard-code.
          </p>

          <div className="mb-4">
            <AgentSnippet allowanceId={contractId} />
          </div>

          <p className="text-sm text-[color:var(--muted)] max-w-[54ch]">
            Complete as it stands — your contract id is already in it. Set{' '}
            <span className="num text-[color:var(--text)]">AGENT_SECRET</span> to the key from
            step 02, then call <span className="num text-[color:var(--text)]">buy(url)</span> with
            any API on your allowlist. A refused purchase throws with the rule that stopped it,
            and costs nothing: the rules run during simulation, before anything is submitted.
          </p>
        </Step>
      </div>
    </main>
  );
}
