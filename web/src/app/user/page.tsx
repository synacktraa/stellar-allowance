'use client';

import { useCallback, useEffect, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { useWallet } from '@/lib/useWallet';
import {
  createAgentAccount,
  deposit,
  proveAddress,
  revoke,
  sendAgentXlm,
  setRules,
  withdraw,
} from '@/lib/freighter';
import { DEFAULT_WINDOW_LEDGERS, LEDGERS_PER_MINUTE, NO_RATE_LIMIT, isUnlimited } from '@/lib/rules';
import { SiteHeader } from '@/components/SiteHeader';
import { Overlay, Field } from '@/components/Overlay';
import { AllowanceTable, type AllowanceRow } from '@/components/AllowanceTable';
import { AllowlistInput, type Allowed } from '@/components/AllowlistInput';
import { AgentSnippet } from '@/components/AgentSnippet';
import { Copyable } from '@/components/Copyable';

/**
 * The allowances you have given out.
 *
 * This was six numbered steps, which is the right shape for the first ten minutes and the wrong
 * one forever after. Somebody coming back wants to top one up or change what it may buy, and had
 * to walk past the whole tutorial to reach either.
 *
 * What a row shows is chosen against what an owner needs to know: what it is called, whether it
 * can still pay its own fees, how much it can spend, what it may spend it on, and whether
 * anything is limiting the rate. No contract ids and no public keys — they identify nothing to a
 * person, and everything that needs one is inside the row.
 */

const stroops = (amount: string) => BigInt(Math.round(Number(amount) * 1e7));

type NewAllowance = { name: string; secret: string; contractId: string };

export default function UserPage() {
  const { wallet, funds, connecting, restoring, error: walletError, connect, refresh } = useWallet();

  const [allowances, setAllowances] = useState<AllowanceRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<NewAllowance | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const address = wallet?.address ?? null;

  const load = useCallback(async (owner: string) => {
    const body = await fetch(`/api/allowances?owner=${owner}`).then((r) => r.json());
    setAllowances(body.allowances ?? []);
    setLoaded(true);
  }, []);

  // Settled inside the promise rather than in the effect body, and dropped if the wallet changes
  // while it is in flight — a slow answer for one address must not overwrite a newer one.
  useEffect(() => {
    if (!address) return;
    let current = true;
    fetch(`/api/allowances?owner=${address}`)
      .then((r) => r.json())
      .then((body) => {
        if (!current) return;
        setAllowances(body.allowances ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (current) setLoaded(true);
      });
    return () => {
      current = false;
    };
  }, [address]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      if (address) await load(address);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  // Derived, not copied. A dialog holding its own snapshot of a row goes stale the moment an
  // action changes the balance behind it, and syncing that back needed an effect.
  const open = allowances.find((a) => a.contract_id === openId) ?? null;

  const ready = Boolean(address && loaded);

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-[1180px] px-4 sm:px-6 py-10">
        <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
          <p className="label">[ USER ]</p>

          {ready && (
            <button
              onClick={() => setCreating(true)}
              className="chip chip-accent px-4 py-2.5 cursor-pointer whitespace-nowrap"
            >
              + new allowance
            </button>
          )}
        </div>

        {ready ? (
          <>
            <h1 className="text-2xl font-medium mb-1">Your allowances</h1>
            <p className="label mb-6">
              {allowances.length === 0
                ? 'none yet'
                : `${allowances.length} allowance${allowances.length === 1 ? '' : 's'}${
                    funds
                      ? ` · your wallet holds ${funds.usdc.toFixed(2)} USDC and ${funds.xlm.toFixed(2)} XLM`
                      : ''
                  }`}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-medium mb-3">Give an agent a budget, not your wallet.</h1>
            <p className="text-sm text-[color:var(--muted)] max-w-[52ch] leading-relaxed mb-2">
              Your agent gets a key that holds no money. It can ask a contract to pay, and the
              contract decides — so a stolen key, or a prompt telling it to pay somebody else,
              reaches nothing.
            </p>
            <p className="text-sm text-[color:var(--muted)] max-w-[52ch] leading-relaxed">
              You choose which APIs it may pay. Anything else is refused by the network, not by
              your agent&rsquo;s own code.
            </p>
          </>
        )}

        {error && (
          <p className="text-sm mb-5 max-w-[70ch]" style={{ color: 'var(--drained)' }}>
            {error}
          </p>
        )}

        {!address ? (
          <div className="panel p-6 pt-8 max-w-[440px] mt-4">
            <span className="panel-tag">[ WALLET ]</span>
            <p className="text-sm text-[color:var(--muted)] mb-5 leading-relaxed">
              Your wallet owns the contracts and funds them. Only you can add money or take it
              back. Freighter, on Testnet.
            </p>
            <button
              onClick={connect}
              disabled={connecting || restoring}
              className="chip chip-accent px-4 py-2.5 cursor-pointer disabled:opacity-40"
            >
              {restoring ? 'checking…' : connecting ? 'waiting for Freighter…' : 'connect wallet'}
            </button>
            {walletError && (
              <p className="text-sm mt-4" style={{ color: 'var(--drained)' }}>
                {walletError}
              </p>
            )}
          </div>
        ) : !loaded ? (
          <p className="label mt-4">loading…</p>
        ) : allowances.length === 0 ? (
          <div className="panel p-6 pt-8 max-w-[560px]">
            <span className="panel-tag">[ NO ALLOWANCES YET ]</span>
            <p className="text-sm text-[color:var(--muted)] max-w-[48ch] leading-relaxed">
              Making one takes a minute. It needs a name, a little XLM for its own transaction
              fees, and at least one API it is allowed to pay.
            </p>
          </div>
        ) : (
          <AllowanceTable
            allowances={allowances}
            onOpen={(allowance) => setOpenId(allowance.contract_id)}
          />
        )}
      </main>

      {creating && address && (
        <CreateAllowance
          xlmAvailable={funds?.xlm ?? 0}
          busy={busy === 'create'}
          onClose={() => setCreating(false)}
          onCreate={({ name, agentXlm, allowed, windowCap, windowMinutes }) =>
            run('create', async () => {
              const agent = Keypair.random();

              // The agent's account must exist before a contract can name it, and only the
              // owner's wallet can create one.
              await createAgentAccount(address, agent.publicKey(), agentXlm);

              const response = await fetch('/api/allowances', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  owner: address,
                  agent: agent.publicKey(),
                  name,
                  allowlist: allowed.map((a) => a.splitter_contract_id),
                  ...(windowCap
                    ? { window_cap: stroops(windowCap).toString(), window_minutes: windowMinutes }
                    : {}),
                }),
              });
              const created = await response.json();
              if (!response.ok) throw new Error(created.error ?? 'Could not create it.');

              setCreating(false);
              // Shown once. This is the only copy — we never had it and cannot produce it again.
              setJustCreated({ name, secret: agent.secret(), contractId: created.contract_id });
            })
          }
        />
      )}

      {justCreated && <AllowanceCreated details={justCreated} onClose={() => setJustCreated(null)} />}

      {open && address && (
        <AllowanceDetail
          // Keyed, so switching rows remounts with that allowance's rules rather than carrying the
          // previous one's across — the bug the developer tab had before it was a table.
          key={open.contract_id}
          allowance={open}
          owner={address}
          busy={busy}
          onClose={() => setOpenId(null)}
          run={run}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- create

function CreateAllowance({
  xlmAvailable,
  busy,
  onClose,
  onCreate,
}: {
  xlmAvailable: number;
  busy: boolean;
  onClose: () => void;
  onCreate: (fields: {
    name: string;
    agentXlm: string;
    allowed: Allowed[];
    windowCap: string;
    windowMinutes: number;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [agentXlm, setAgentXlm] = useState('5');
  const [allowed, setAllowed] = useState<Allowed[]>([]);
  const [limited, setLimited] = useState(false);
  const [windowCap, setWindowCap] = useState('0.50');
  const [windowMinutes, setWindowMinutes] = useState('15');

  // Your own account has to keep its reserve behind, so the spendable figure is not the balance
  // on screen. Saying so beats a reverted transaction that mentions neither.
  const enough = Number(agentXlm) >= 1 && Number(agentXlm) <= xlmAvailable - 1.5;

  return (
    <Overlay
      title="New allowance"
      note="A key that holds no money, and a contract that does. You own the contract; the agent can only ask it."
      onClose={onClose}
    >
      <Field
        label="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="research"
        hint="what you will call it here · unique among your allowances"
      />

      <Field
        label="XLM for its transaction fees"
        value={agentXlm}
        onChange={(e) => setAgentXlm(e.target.value)}
        inputMode="decimal"
        hint={`its own, not money it can spend · you hold ${xlmAvailable.toFixed(2)} and must keep about 1.5 back`}
      />

      <div className="mb-5">
        <AllowlistInput value={allowed} onChange={setAllowed} example={null} />
      </div>

      {/* Optional, and last, because it is the last of the four things protecting you. The agent
          holding no money at all is the first. */}
      <div className="border-t border-[color:var(--line)] pt-4 mb-5">
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} />
          <span className="label">also cap how fast it can spend</span>
        </label>

        {limited ? (
          <div className="flex gap-3">
            <Field
              label="at most (USDC)"
              value={windowCap}
              onChange={(e) => setWindowCap(e.target.value)}
              inputMode="decimal"
            />
            <Field
              label="per (minutes)"
              value={windowMinutes}
              onChange={(e) => setWindowMinutes(e.target.value)}
              inputMode="numeric"
            />
          </div>
        ) : (
          <p className="label leading-relaxed">
            no rate limit · what you put in the contract is the most it can ever spend
          </p>
        )}
      </div>

      <button
        onClick={() =>
          onCreate({
            name,
            agentXlm,
            allowed,
            windowCap: limited ? windowCap : '',
            windowMinutes: Number(windowMinutes),
          })
        }
        disabled={busy || !name.trim() || allowed.length === 0 || !enough}
        className="chip chip-accent px-4 py-2.5 cursor-pointer disabled:opacity-40"
      >
        {busy ? 'creating…' : 'create it'}
      </button>

      {!enough && (
        <p className="label mt-3" style={{ color: 'var(--drained)' }}>
          give it at least 1 XLM, and no more than you can spare
        </p>
      )}
    </Overlay>
  );
}

function AllowanceCreated({ details, onClose }: { details: NewAllowance; onClose: () => void }) {
  return (
    <Overlay
      title={`${details.name} is ready`}
      note="This key is shown once. It is the only copy — we never had it and cannot produce it again."
      onClose={onClose}
    >
      <p className="label mb-2">the agent&rsquo;s secret key</p>
      <div className="mb-5">
        <Copyable value={details.secret} label="agent secret" />
      </div>

      <p className="text-sm text-[color:var(--muted)] leading-relaxed mb-5 max-w-[46ch]">
        Give it to your agent as <span className="num text-[color:var(--text)]">AGENT_SECRET</span>.
        It holds no money and cannot move any, so losing it costs you nothing beyond having to
        make another allowance.
      </p>

      <button onClick={onClose} className="chip chip-accent px-4 py-2.5 cursor-pointer">
        saved it
      </button>
    </Overlay>
  );
}

// --------------------------------------------------------------------------- one allowance

function AllowanceDetail({
  allowance,
  owner,
  busy,
  onClose,
  run,
}: {
  allowance: AllowanceRow;
  owner: string;
  busy: string | null;
  onClose: () => void;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(allowance.name ?? '');
  const [amount, setAmount] = useState('2.00');
  const [topUp, setTopUp] = useState('2');
  // The chain stores addresses; the list endpoint has already resolved their names. Computed at
  // mount rather than in an effect: the component is keyed on the allowance, so switching one
  // remounts this and the initialiser runs again with the right rules.
  const [allowed, setAllowed] = useState<Allowed[]>(() =>
    (allowance.rules?.allowlist ?? []).map((address, index) => ({
      splitter_contract_id: address,
      name: allowance.can_pay[index] ?? `${address.slice(0, 6)}…${address.slice(-4)}`,
    })),
  );
  const [limited, setLimited] = useState(!isUnlimited(allowance.rules?.window_cap));
  const [windowCap, setWindowCap] = useState(
    allowance.rules && !isUnlimited(allowance.rules.window_cap)
      ? (Number(allowance.rules.window_cap) / 1e7).toFixed(2)
      : '0.50',
  );
  const [windowMinutes, setWindowMinutes] = useState(
    allowance.rules ? String(Math.round(allowance.rules.window_ledgers / LEDGERS_PER_MINUTE)) : '15',
  );
  const [confirmStop, setConfirmStop] = useState(false);

  // Nothing to synchronise: the component is keyed on the allowance, so switching one remounts this
  // with the right rules and the initialiser runs again.
  

  const balance = allowance.balance === null ? 0 : Number(allowance.balance) / 1e7;
  const stopped = allowance.revoked === true;
  const lowOnFees = allowance.xlm !== null && allowance.xlm < 1;

  return (
    <Overlay title={allowance.name ?? 'agent'} onClose={onClose}>
      {/* ------------------------------------------------------------ money */}
      <p className="label mb-1">credits in the contract</p>
      <p className="num text-3xl mb-1" style={{ color: 'var(--accent)' }}>
        {balance.toFixed(2)} <span className="text-sm text-[color:var(--faint)]">USDC</span>
      </p>
      <p className="label mb-4">what the agent may ask this contract to spend</p>

      <div className="flex gap-3 items-end mb-2">
        <Field
          label="amount (USDC)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />
        <button
          onClick={() => run('deposit', () => deposit(owner, allowance.contract_id, stroops(amount)))}
          disabled={busy !== null}
          className="chip chip-accent px-3 py-2.5 mb-4 cursor-pointer disabled:opacity-40 whitespace-nowrap"
        >
          {busy === 'deposit' ? 'signing…' : 'deposit'}
        </button>
        <button
          onClick={() => run('withdraw', () => withdraw(owner, allowance.contract_id, stroops(amount)))}
          disabled={busy !== null || balance === 0}
          className="chip px-3 py-2.5 mb-4 cursor-pointer disabled:opacity-40 whitespace-nowrap"
        >
          {busy === 'withdraw' ? 'signing…' : 'withdraw'}
        </button>
      </div>
      <p className="label mb-6">both are signed by you — we can do neither</p>

      {/* ------------------------------------------------------------- fees */}
      <div className="border-t border-[color:var(--line)] pt-4 mb-6">
        <p className="label mb-1">the agent&rsquo;s own XLM, for transaction fees</p>
        <p className="num text-lg mb-3" style={{ color: lowOnFees ? 'var(--drained)' : undefined }}>
          {allowance.xlm === null ? '—' : allowance.xlm.toFixed(2)}{' '}
          <span className="text-sm text-[color:var(--faint)]">XLM</span>
          {lowOnFees && (
            <span className="label ml-2" style={{ color: 'var(--drained)' }}>
              too low to keep paying fees
            </span>
          )}
        </p>

        <div className="flex gap-3 items-end">
          <Field
            label="amount (XLM)"
            value={topUp}
            onChange={(e) => setTopUp(e.target.value)}
            inputMode="decimal"
          />
          <button
            onClick={() => run('xlm', () => sendAgentXlm(owner, allowance.agent_address, topUp))}
            disabled={busy !== null || !(Number(topUp) > 0)}
            className="chip px-3 py-2.5 mb-4 cursor-pointer disabled:opacity-40 whitespace-nowrap"
          >
            {busy === 'xlm' ? 'signing…' : 'send XLM'}
          </button>
        </div>

        {/* Asked for, and not possible — worth saying rather than leaving a missing button. */}
        <p className="label leading-relaxed">
          this cannot be taken back: it is the agent&rsquo;s own account, and only the agent&rsquo;s
          key can move it — the same thing that makes handing over that key safe
        </p>
      </div>

      {/* ------------------------------------------------------------- name */}
      <div className="border-t border-[color:var(--line)] pt-4">
        <div className="flex gap-3 items-end">
          <Field label="name" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            onClick={() =>
              run('rename', async () => {
                const proof = await proveAddress(owner);
                const response = await fetch(`/api/allowances/${allowance.contract_id}`, {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ ...proof, name }),
                });
                if (!response.ok) throw new Error((await response.json()).error);
              })
            }
            disabled={busy !== null || name.trim() === (allowance.name ?? '')}
            className="chip px-3 py-2.5 mb-4 cursor-pointer disabled:opacity-40"
          >
            {busy === 'rename' ? 'signing…' : 'rename'}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------- what it buys */}
      <div className="border-t border-[color:var(--line)] pt-4 mb-4">
        <AllowlistInput value={allowed} onChange={setAllowed} example={null} />
      </div>

      {/* --------------------------------------------------------- rate limit */}
      <div className="border-t border-[color:var(--line)] pt-4 mb-4">
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} />
          <span className="label">cap how fast it can spend</span>
        </label>

        {limited ? (
          <div className="flex gap-3">
            <Field
              label="at most (USDC)"
              value={windowCap}
              onChange={(e) => setWindowCap(e.target.value)}
              inputMode="decimal"
            />
            <Field
              label="per (minutes)"
              value={windowMinutes}
              onChange={(e) => setWindowMinutes(e.target.value)}
              inputMode="numeric"
            />
          </div>
        ) : (
          <p className="label mb-4 leading-relaxed">
            no rate limit · the {balance.toFixed(2)} USDC in the contract is the most it can spend
          </p>
        )}

        {/* One signature covers both, because the contract takes its rules as a single struct —
            sending them separately would mean two prompts to change one thing. */}
        <button
          onClick={() =>
            run('rules', () =>
              setRules(owner, allowance.contract_id, {
                // One cap, not two: a single call may spend whatever the window allows, no more.
                maxPerCall: limited ? stroops(windowCap) : NO_RATE_LIMIT,
                windowCap: limited ? stroops(windowCap) : NO_RATE_LIMIT,
                windowLedgers: limited
                  ? Math.max(1, Math.round(Number(windowMinutes) * LEDGERS_PER_MINUTE))
                  : DEFAULT_WINDOW_LEDGERS,
                allowlist: allowed.map((a) => a.splitter_contract_id),
              }),
            )
          }
          disabled={busy !== null || allowed.length === 0}
          className="chip chip-accent px-4 py-2.5 cursor-pointer disabled:opacity-40"
        >
          {busy === 'rules' ? 'signing…' : 'save APIs and limit'}
        </button>
        {allowed.length === 0 && (
          <p className="label mt-2" style={{ color: 'var(--drained)' }}>
            with nothing allowlisted the contract refuses every payment
          </p>
        )}
      </div>

      {/* ---------------------------------------------------------- the code */}
      <details className="border-t border-[color:var(--line)] pt-4 mb-4">
        <summary className="label cursor-pointer">the code your agent runs</summary>
        <div className="mt-3">
          <AgentSnippet allowanceId={allowance.contract_id} />
        </div>
      </details>

      {/* -------------------------------------------------------------- stop */}
      <div className="border-t border-[color:var(--line)] pt-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={() =>
            confirmStop ? run('revoke', () => revoke(owner, allowance.contract_id)) : setConfirmStop(true)
          }
          disabled={busy !== null || stopped}
          className="chip px-4 py-2.5 cursor-pointer disabled:opacity-40"
          style={{ borderColor: 'var(--drained)', color: 'var(--drained)' }}
        >
          {stopped ? 'stopped' : confirmStop ? 'yes, stop it' : 'stop the agent'}
        </button>
        <span className="label" style={{ color: 'var(--drained)' }}>
          {stopped
            ? 'it can no longer spend · your money is still yours to take back'
            : confirmStop
              ? 'it stops spending immediately · your money stays where it is'
              : ''}
        </span>
      </div>
    </Overlay>
  );
}
