'use client';

import { useCallback, useEffect, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { useWallet } from '@/lib/useWallet';
import {
  deployAllowance,
  proveAddress,
  resume,
  revoke,
  withdraw,
  write,
  type RuleSet,
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
 * One confirmation per intention, which is the whole shape of this page. Creating an allowance
 * is a single signature that deploys the contract, names the agent, sets the rules, moves the
 * USDC in and funds the agent's account — because a deploy runs its constructor in the same
 * invocation, and a transaction carrying a Soroban call may carry nothing else. Editing is a
 * single signature too, however many fields were touched.
 *
 * What a row shows is chosen against what an owner needs to know: what it is called, whether it
 * can still pay its own fees, how much it can spend, what it may spend it on, and whether
 * anything is limiting the rate. No contract ids and no public keys — they identify nothing to a
 * person, and everything that needs one is inside the row.
 */

const stroops = (amount: string) => BigInt(Math.round(Number(amount) * 1e7));

/** The form, before any of it has been signed for. */
type Draft = {
  agentXlm: string;
  usdcIn: string;
  allowed: Allowed[];
  windowCap: string;
  windowMinutes: number;
};

type DeployParams = { wasm_hash: string; token: string; native: string };

export default function UserPage() {
  const { wallet, funds, connecting, restoring, error: walletError, connect, refresh } = useWallet();

  const [allowances, setAllowances] = useState<AllowanceRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The keypair exists before the contract does, so the key can be shown and acknowledged before
  // anything is signed for. Held here between those two steps.
  const [pending, setPending] = useState<{ draft: Draft; agent: Keypair } | null>(null);
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

  /** The one signed transaction. Everything before it is a form; nothing exists until it lands. */
  const createIt = ({ draft, agent }: { draft: Draft; agent: Keypair }) =>
    run('create', async () => {
      if (!address) return;

      const params: DeployParams = await fetch('/api/allowances/params').then((r) => r.json());
      const limited = draft.windowCap !== '';

      const contractId = await deployAllowance(address, params, {
        agent: agent.publicKey(),
        rules: {
          // One cap, not two: a single call may spend whatever the window allows, no more.
          maxPerCall: limited ? stroops(draft.windowCap) : NO_RATE_LIMIT,
          windowCap: limited ? stroops(draft.windowCap) : NO_RATE_LIMIT,
          windowLedgers: limited
            ? Math.max(1, Math.round(draft.windowMinutes * LEDGERS_PER_MINUTE))
            : DEFAULT_WINDOW_LEDGERS,
          allowlist: draft.allowed.map((a) => a.splitter_contract_id),
        },
        usdcIn: draft.usdcIn ? stroops(draft.usdcIn) : 0n,
        xlmToAgent: stroops(draft.agentXlm),
      });

      // The contract is real and owned by now. This only records the index that makes it
      // findable, and every field is checked against the chain — which is why it needs no
      // signature, and why it does not accept a name. The server picks a placeholder; naming it
      // properly is a separate, signed request.
      await fetch('/api/allowances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          owner: address,
          agent: agent.publicKey(),
          contract_id: contractId,
        }),
      });

      setPending(null);
    });

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
              Making one takes a minute and a single signature. It needs a name, a little XLM for
              the agent&rsquo;s own transaction fees, and at least one API it is allowed to pay.
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
          usdcAvailable={funds?.usdc ?? 0}
          onClose={() => setCreating(false)}
          onReady={(draft) => {
            setCreating(false);
            // Generated here, revealed next, signed for after that. A key shown only on success
            // is a key you cannot save before you need it.
            setPending({ draft, agent: Keypair.random() });
          }}
        />
      )}

      {pending && (
        <RevealSecret
          secret={pending.agent.secret()}
          busy={busy === 'create'}
          error={error}
          onCancel={() => setPending(null)}
          onContinue={() => createIt(pending)}
        />
      )}

      {open && address && (
        <AllowanceDetail
          // Keyed, so switching rows remounts with that allowance's rules rather than carrying the
          // previous one's across — the bug the developer tab had before it was a table.
          key={open.contract_id}
          allowance={open}
          owner={address}
          busy={busy}
          error={error}
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
  usdcAvailable,
  onClose,
  onReady,
}: {
  xlmAvailable: number;
  usdcAvailable: number;
  onClose: () => void;
  onReady: (draft: Draft) => void;
}) {
  const [agentXlm, setAgentXlm] = useState('5');
  // Prefilled, because an allowance with no credits fails at its first purchase with an error
  // nobody connects back to a deposit they meant to make later. Clearable, because setting one
  // up now and funding it on Monday is a real thing to want.
  const [usdcIn, setUsdcIn] = useState('2.00');
  const [allowed, setAllowed] = useState<Allowed[]>([]);
  const [limited, setLimited] = useState(false);
  const [windowCap, setWindowCap] = useState('0.50');
  const [windowMinutes, setWindowMinutes] = useState('15');

  // Your own account has to keep its reserve behind, so the spendable figure is not the balance
  // on screen. Saying so beats a reverted transaction that mentions neither.
  const enoughXlm = Number(agentXlm) >= 1 && Number(agentXlm) <= xlmAvailable - 1.5;
  const enoughUsdc = usdcIn === '' || Number(usdcIn) <= usdcAvailable;

  return (
    <Overlay
      title="New allowance"
      note="One signature creates the contract, funds it, and gives the agent a key that holds no money. You can name it once it exists."
      onClose={onClose}
    >
      <Field
        label="credits to start with (USDC)"
        value={usdcIn}
        onChange={(e) => setUsdcIn(e.target.value)}
        inputMode="decimal"
        hint={`what it may spend · you hold ${usdcAvailable.toFixed(2)} · leave empty to fund it later`}
      />

      <Field
        label="XLM for the agent's transaction fees"
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
          onReady({
            agentXlm,
            usdcIn,
            allowed,
            windowCap: limited ? windowCap : '',
            windowMinutes: Number(windowMinutes),
          })
        }
        disabled={allowed.length === 0 || !enoughXlm || !enoughUsdc}
        className="chip chip-accent px-4 py-2.5 cursor-pointer disabled:opacity-40"
      >
        continue
      </button>

      {!enoughXlm && (
        <p className="label mt-3" style={{ color: 'var(--drained)' }}>
          give the agent at least 1 XLM, and no more than you can spare
        </p>
      )}
      {!enoughUsdc && (
        <p className="label mt-3" style={{ color: 'var(--drained)' }}>
          you only hold {usdcAvailable.toFixed(2)} USDC
        </p>
      )}
    </Overlay>
  );
}

/**
 * The key, before the signature rather than after.
 *
 * It is generated in this browser and never sent anywhere, so this is the only moment it exists
 * anywhere a person can copy it. Showing it only once the contract is live would mean a signature
 * refused at the wrong second loses a key that was already generated.
 */
function RevealSecret({
  secret,
  busy,
  error,
  onCancel,
  onContinue,
}: {
  secret: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const [saved, setSaved] = useState(false);

  return (
    <Overlay
      title="the agent's key"
      note="Shown once. It is the only copy — we never had it and cannot produce it again."
      error={error}
      onClose={busy ? () => {} : onCancel}
    >
      <p className="label mb-2">the agent&rsquo;s secret key</p>
      <div className="mb-5">
        <Copyable value={secret} label="agent secret" />
      </div>

      <p className="text-sm text-[color:var(--muted)] leading-relaxed mb-5 max-w-[46ch]">
        Give it to your agent as <span className="num text-[color:var(--text)]">STELLAR_ALLOWANCE_SECRET</span>.
        It holds no money and cannot move any, so losing it costs you nothing beyond having to
        make another allowance.
      </p>

      <label className="flex items-center gap-2 cursor-pointer mb-5">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span className="label">I have saved it somewhere</span>
      </label>

      <button
        onClick={onContinue}
        disabled={!saved || busy}
        className="chip chip-accent px-4 py-2.5 cursor-pointer disabled:opacity-40"
      >
        {busy ? 'waiting for your signature…' : 'create the allowance'}
      </button>

      <p className="label mt-3 leading-relaxed">
        {error
          ? 'nothing was created · this is still the key, so try again or close and start over'
          : 'one signature · creates the contract, puts the credits in, and funds the agent’s account'}
      </p>
    </Overlay>
  );
}

// --------------------------------------------------------------------------- one allowance

/** The editable state of a row, before anything has been signed for. */
type Form = {
  name: string;
  addUsdc: string;
  topUpXlm: string;
  allowed: Allowed[];
  limited: boolean;
  windowCap: string;
  windowMinutes: string;
};

function currentRules(allowance: AllowanceRow) {
  const limited = !isUnlimited(allowance.rules?.window_cap);
  return {
    limited,
    windowCap:
      allowance.rules && limited ? (Number(allowance.rules.window_cap) / 1e7).toFixed(2) : '0.50',
    windowMinutes: allowance.rules
      ? String(Math.round(allowance.rules.window_ledgers / LEDGERS_PER_MINUTE))
      : '15',
  };
}

function toRules(form: Form): RuleSet {
  return {
    // One cap, not two: a single call may spend whatever the window allows, no more.
    maxPerCall: form.limited ? stroops(form.windowCap) : NO_RATE_LIMIT,
    windowCap: form.limited ? stroops(form.windowCap) : NO_RATE_LIMIT,
    windowLedgers: form.limited
      ? Math.max(1, Math.round(Number(form.windowMinutes) * LEDGERS_PER_MINUTE))
      : DEFAULT_WINDOW_LEDGERS,
    allowlist: form.allowed.map((a) => a.splitter_contract_id),
  };
}

/**
 * What actually changed, as `write` arguments.
 *
 * `undefined` means leave it alone, and reaches the contract as Soroban's `None`. A save that
 * only added credits must not carry a rules object, or it would replace the allowlist with
 * whatever this form happened to be holding.
 */
function diff(allowance: AllowanceRow, form: Form) {
  const was = currentRules(allowance);
  const rulesChanged =
    form.allowed.map((a) => a.splitter_contract_id).join() !==
      (allowance.rules?.allowlist ?? []).join() ||
    form.limited !== was.limited ||
    (form.limited &&
      (form.windowCap !== was.windowCap || form.windowMinutes !== was.windowMinutes));

  return {
    rules: rulesChanged ? toRules(form) : undefined,
    usdcIn: form.addUsdc ? stroops(form.addUsdc) : 0n,
    xlmToAgent: form.topUpXlm ? stroops(form.topUpXlm) : 0n,
  };
}

/** True when there is nothing on chain to send. Save may still have a name to change. */
function nothingOnChain(changes: ReturnType<typeof diff>) {
  return changes.rules === undefined && changes.usdcIn === 0n && changes.xlmToAgent === 0n;
}

function AllowanceDetail({
  allowance,
  owner,
  busy,
  error,
  onClose,
  run,
}: {
  allowance: AllowanceRow;
  owner: string;
  busy: string | null;
  error: string | null;
  onClose: () => void;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const was = currentRules(allowance);

  // Computed at mount rather than in an effect: the component is keyed on the allowance, so
  // switching one remounts this and the initialiser runs again with the right rules.
  const [form, setForm] = useState<Form>(() => ({
    name: allowance.name ?? '',
    addUsdc: '',
    topUpXlm: '',
    allowed: (allowance.rules?.allowlist ?? []).map((address, index) => ({
      splitter_contract_id: address,
      name: allowance.can_pay[index] ?? `${address.slice(0, 6)}…${address.slice(-4)}`,
    })),
    ...was,
  }));
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const [takeOut, setTakeOut] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);

  const balance = allowance.balance === null ? 0 : Number(allowance.balance) / 1e7;
  const stopped = allowance.revoked === true;
  const lowOnFees = allowance.xlm !== null && allowance.xlm < 1;
  // A contract keeps the code it was deployed with, so one made before `resume` existed does not
  // have it. Offering the button anyway fails at the wallet with "trying to invoke non-existent
  // contract function" — which reads as a broken app rather than an old contract.
  const canResume = allowance.current !== false;

  const changes = diff(allowance, form);
  const renamed = form.name.trim() !== (allowance.name ?? '');

  /** Everything that lives on the chain, in one transaction. */
  const save = () =>
    run('save', async () => {
      await write(owner, allowance.contract_id, changes);
      setForm((current) => ({ ...current, addUsdc: '', topUpXlm: '' }));
    });

  /** The name lives here, not on the chain. Signed, but free and instant. */
  const rename = () =>
    run('rename', async () => {
      const proof = await proveAddress(owner);
      const response = await fetch(`/api/allowances/${allowance.contract_id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...proof, name: form.name.trim() }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
    });

  return (
    <Overlay title={allowance.name ?? 'allowance'} error={error} onClose={onClose}>
      {/* ------------------------------------------------------------ money */}
      <p className="label mb-1">credits in the contract</p>
      <p className="num text-3xl mb-1" style={{ color: 'var(--accent)' }}>
        {balance.toFixed(2)} <span className="text-sm text-[color:var(--faint)]">USDC</span>
      </p>
      <p className="label mb-4">what the agent may ask this contract to spend</p>

      <Field
        label="add (USDC)"
        value={form.addUsdc}
        onChange={(e) => set('addUsdc', e.target.value)}
        inputMode="decimal"
        placeholder="0.00"
        hint="added to what is already there · not a new total"
      />

      {/* ------------------------------------------------------------- fees */}
      <div className="border-t border-[color:var(--line)] pt-4 mb-2">
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

        <Field
          label="top up (XLM)"
          value={form.topUpXlm}
          onChange={(e) => set('topUpXlm', e.target.value)}
          inputMode="decimal"
          placeholder="0"
          hint="cannot be taken back · only the agent's own key can move its account"
        />
      </div>

      {/* ------------------------------------------------------- what it buys */}
      <div className="border-t border-[color:var(--line)] pt-4 mb-4">
        <AllowlistInput
          value={form.allowed}
          onChange={(allowed) => set('allowed', allowed)}
          example={null}
        />
      </div>

      {/* --------------------------------------------------------- rate limit */}
      <div className="border-t border-[color:var(--line)] pt-4 mb-4">
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={form.limited}
            onChange={(e) => set('limited', e.target.checked)}
          />
          <span className="label">cap how fast it can spend</span>
        </label>

        {form.limited ? (
          <div className="flex gap-3">
            <Field
              label="at most (USDC)"
              value={form.windowCap}
              onChange={(e) => set('windowCap', e.target.value)}
              inputMode="decimal"
            />
            <Field
              label="per (minutes)"
              value={form.windowMinutes}
              onChange={(e) => set('windowMinutes', e.target.value)}
              inputMode="numeric"
            />
          </div>
        ) : (
          <p className="label mb-4 leading-relaxed">
            no rate limit · the {balance.toFixed(2)} USDC in the contract is the most it can spend
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------- name */}
      {/* Its own button, deliberately outside Save. The name lives in the database and the rules
          live on the chain, so one button covering both would sometimes cost two prompts and
          sometimes one — and nothing on screen would explain which. Two buttons, one prompt
          each, is the honest shape. */}
      <div className="border-t border-[color:var(--line)] pt-4">
        <div className="flex gap-3 items-end">
          <Field
            label="name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            hint="stored here, not on the chain · costs no fee"
          />
          <button
            onClick={rename}
            disabled={busy !== null || !renamed || form.name.trim() === ''}
            className="chip px-3 py-2.5 mb-4 cursor-pointer disabled:opacity-40"
          >
            {busy === 'rename' ? 'signing…' : 'rename'}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------- save */}
      <div className="border-t border-[color:var(--line)] pt-4 mb-4">
        <button
          onClick={save}
          disabled={busy !== null || nothingOnChain(changes) || form.allowed.length === 0}
          className="chip chip-accent px-4 py-2.5 cursor-pointer disabled:opacity-40"
        >
          {busy === 'save' ? 'signing…' : 'save changes'}
        </button>
        <p className="label mt-2 leading-relaxed">
          {nothingOnChain(changes)
            ? 'nothing changed yet'
            : 'one signature · credits, fees and rules all go together'}
        </p>
        {form.allowed.length === 0 && (
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

      {/* --------------------------------------------------------- withdraw */}
      {/* Its own action, not part of Save. A different contract function, and the only way money
          comes back out — it should not hide inside a general-purpose button. */}
      <div className="border-t border-[color:var(--line)] pt-4 mb-4">
        <div className="flex gap-3 items-end">
          <Field
            label="take back (USDC)"
            value={takeOut}
            onChange={(e) => setTakeOut(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
          <button
            onClick={() =>
              run('withdraw', async () => {
                await withdraw(owner, allowance.contract_id, stroops(takeOut));
                setTakeOut('');
              })
            }
            disabled={busy !== null || !(Number(takeOut) > 0) || balance === 0}
            className="chip px-3 py-2.5 mb-4 cursor-pointer disabled:opacity-40 whitespace-nowrap"
          >
            {busy === 'withdraw' ? 'signing…' : 'withdraw'}
          </button>
        </div>
        <p className="label">it comes back to your wallet · there is nowhere else it can go</p>
      </div>

      {/* ------------------------------------------------------- stop / start */}
      {/* A brake you cannot release is not a brake. Stopping is one click plus a confirm;
          starting again is one click, because the dangerous direction is the one worth slowing
          down and this one only restores what the rules already allowed. */}
      <div className="border-t border-[color:var(--line)] pt-4 flex items-center gap-3 flex-wrap">
        {stopped && canResume ? (
          <>
            <button
              onClick={() => run('resume', () => resume(owner, allowance.contract_id))}
              disabled={busy !== null}
              className="chip px-4 py-2.5 cursor-pointer disabled:opacity-40"
            >
              {busy === 'resume' ? 'signing…' : 'start it again'}
            </button>
            <span className="label" style={{ color: 'var(--drained)' }}>
              stopped · it can spend nothing until you start it, and the rules still apply
              afterwards
            </span>
          </>
        ) : stopped ? (
          <span className="label leading-relaxed" style={{ color: 'var(--drained)' }}>
            stopped, and this one cannot be started again — it was created before the contract
            could be restarted, and a deployed contract keeps the code it was made with. Take the
            credits back with the button above and make a new allowance; the agent will need the
            new key.
          </span>
        ) : (
          <>
            <button
              onClick={() =>
                confirmStop
                  ? run('revoke', () => revoke(owner, allowance.contract_id))
                  : setConfirmStop(true)
              }
              disabled={busy !== null}
              className="chip px-4 py-2.5 cursor-pointer disabled:opacity-40"
              style={{ borderColor: 'var(--drained)', color: 'var(--drained)' }}
            >
              {busy === 'revoke' ? 'signing…' : confirmStop ? 'yes, stop it' : 'stop this allowance'}
            </button>
            <span className="label" style={{ color: 'var(--drained)' }}>
              {confirmStop
                ? 'it stops spending immediately · your money stays where it is, and you can start it again'
                : 'the emergency brake · moves no money, so it cannot fail'}
            </span>
          </>
        )}
      </div>
    </Overlay>
  );
}
