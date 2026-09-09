'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LEDGERS_PER_HOUR, toBase, usdc } from '@/lib/demo/params';
import { labelsFor } from '@/lib/dashboard/labels';
import { remaining } from '@/lib/dashboard/summary';
import type { Row } from '@/lib/dashboard/read';
import { createAllowance, saveAllowance, setEnabled, withdrawFrom, type Rules } from '@/lib/dashboard/write';
import { freighterSigner, type Wallet } from '@/lib/dashboard/wallet';
import { AgentLines, Block } from '../code';
import { Allowlist, type Labels } from './allowlist';

const WINDOWS = [
  { hours: 1, label: '1 hour' },
  { hours: 6, label: '6 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 168, label: '7 days' },
];

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const signingWith = (wallet: Wallet) => ({ owner: wallet.address, signTransaction: freighterSigner });
const say = (error: unknown) => (error instanceof Error ? error.message : String(error));

function Panel({
  title,
  badge,
  onClose,
  children,
  footer,
}: {
  title: string;
  badge?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const frame = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  // A panel that covers the list has to take the keyboard with it and give it back. Escape is
  // how a reader leaves a dialog, and a panel that closes without returning focus leaves it on
  // an element that no longer exists.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    frame.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  return (
    <>
      <div className="scrim" onClick={onClose} role="presentation" />
      <aside
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={frame}
      >
        <div className="ph">
          <div>
            <h2>{title}</h2>
            {badge}
          </div>
          <button className="x" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="pb">{children}</div>
        {footer && <div className="pf">{footer}</div>}
      </aside>
    </>
  );
}

/** What the agent needs, and the reason it is only two values. */
function AgentSetup({ id, secret }: { id: string; secret?: string }) {
  const env = `STELLAR_ALLOWANCE_ID=${id}\nSTELLAR_ALLOWANCE_SECRET=${secret ?? ''}`;

  return (
    <>
      <div className="sec">
        <div className="sh">
          <span>Give this to the agent</span>
        </div>
        <Block copy={secret ? env : undefined} what="the .env">
          <pre className="code env">
            <span className="c1">STELLAR_ALLOWANCE_ID</span>={id}
            {'\n'}
            <span className="c1">STELLAR_ALLOWANCE_SECRET</span>=
            {secret ?? <span className="dim">shown once, when this was created</span>}
          </pre>
        </Block>
        {secret ? (
          <p className="warn">
            This secret is shown now and never again. Nothing stores it, here or anywhere else. An
            agent that loses it cannot be given a new one, because the key is fixed at creation, so
            the allowance would have to be replaced.
          </p>
        ) : (
          <p className="help">
            The secret was shown when this allowance was created. It cannot be shown again, and it
            cannot be rotated: the agent&rsquo;s key is set at creation and no function changes it.
          </p>
        )}
      </div>

      <div className="sec">
        <div className="sh">
          <span>Then the agent pays with it</span>
        </div>
        <AgentLines />
        <p className="help">
          The same four lines for every allowance. Only the two values above change.
        </p>
      </div>
    </>
  );
}

export function CreatePanel({
  wallet,
  index,
  onClose,
  onDone,
}: {
  wallet: Wallet;
  index: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('My agent');
  const [deposit, setDeposit] = useState('1');
  const [cap, setCap] = useState('0.25');
  const [hours, setHours] = useState(24);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [labels, setLabels] = useState<Labels>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [made, setMade] = useState<{ id: string; secret: string } | null>(null);

  async function deploy() {
    setBusy(true);
    setProblem('');
    try {
      const rules: Rules = {
        allowlist: addresses,
        cap: toBase(cap),
        windowLedgers: hours * LEDGERS_PER_HOUR,
      };
      const amount = toBase(deposit);
      if (wallet.usdc === undefined) throw new Error('this wallet holds no USDC trustline');
      if (amount > toBase(wallet.usdc)) throw new Error('the deposit is more USDC than you hold');
      const result = await createAllowance(signingWith(wallet), index, name.trim() || 'Agent', amount, rules);
      setMade({ id: result.id, secret: result.secret });
    } catch (error) {
      setProblem(say(error));
    } finally {
      setBusy(false);
    }
  }

  if (made) {
    return (
      <Panel
        title="Created"
        badge={<span className="pill on">Active</span>}
        onClose={() => {
          onDone();
          onClose();
        }}
        footer={
          <button
            className="cta"
            type="button"
            onClick={() => {
              onDone();
              onClose();
            }}
          >
            Done
          </button>
        }
      >
        <AgentSetup id={made.id} secret={made.secret} />
      </Panel>
    );
  }

  return (
    <Panel
      title="New allowance"
      onClose={onClose}
      footer={
        <>
          <span className="note-inline">Freighter asks once. The deposit moves, nothing else.</span>
          <button className="cta" type="button" disabled={busy} onClick={() => void deploy()}>
            {busy ? 'Waiting for Freighter' : 'Deploy'}
          </button>
        </>
      }
    >
      <label>
        Name
        <input value={name} maxLength={32} onChange={(event) => setName(event.target.value)} />
      </label>

      <div className="two">
        <label>
          Deposit, USDC
          <input value={deposit} inputMode="decimal" onChange={(event) => setDeposit(event.target.value)} />
        </label>
        <label>
          Cap per window, USDC
          <input value={cap} inputMode="decimal" onChange={(event) => setCap(event.target.value)} />
        </label>
      </div>

      <label>
        Window
        <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
          {WINDOWS.map((option) => (
            <option key={option.hours} value={option.hours}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <Allowlist addresses={addresses} labels={labels} onChange={(next, nextLabels) => {
        setAddresses(next);
        setLabels(nextLabels);
      }} busy={busy} />

      {problem && <p className="bad">{problem}</p>}
    </Panel>
  );
}

export function DetailPanel({
  row,
  wallet,
  readOnly,
  onClose,
  onDone,
}: {
  row: Row;
  wallet: Wallet;
  readOnly?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [cap, setCap] = useState(usdc(row.cap));
  const [hours, setHours] = useState(row.windowHours);
  const [addresses, setAddresses] = useState<string[]>(row.allowlist);
  const [labels, setLabels] = useState<Labels>(() => labelsFor(row.allowlist));
  const [topUp, setTopUp] = useState('');
  const [takeOut, setTakeOut] = useState('');
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [confirmPause, setConfirmPause] = useState(false);
  const locked = Boolean(readOnly) || Boolean(busy);

  const rulesChanged =
    usdc(row.cap) !== cap ||
    row.windowHours !== hours ||
    addresses.length !== row.allowlist.length ||
    addresses.some((address, at) => address !== row.allowlist[at]);
  const changes = useMemo(() => {
    const list: string[] = [];
    if (name.trim() && name.trim() !== row.name) list.push('name');
    if (rulesChanged) list.push('rules');
    if (topUp.trim()) list.push('credits');
    return list;
  }, [name, rulesChanged, topUp, row.name]);

  const run = async (what: string, work: () => Promise<unknown>) => {
    setBusy(what);
    setProblem('');
    try {
      await work();
      onDone();
    } catch (error) {
      setProblem(say(error));
    } finally {
      setBusy('');
    }
  };

  const save = () =>
    run('save', () =>
      saveAllowance(row.id, signingWith(wallet), {
        name: name.trim() !== row.name ? name.trim() : undefined,
        rules: rulesChanged
          ? { allowlist: addresses, cap: toBase(cap), windowLedgers: hours * LEDGERS_PER_HOUR }
          : undefined,
        deposit: topUp.trim() ? toBase(topUp) : 0n,
      }).then(() => setTopUp('')),
    );

  return (
    <Panel
      title={row.name || short(row.id)}
      badge={<span className={`pill ${row.enabled ? 'on' : 'off'}`}>{row.enabled ? 'Active' : 'Paused'}</span>}
      onClose={onClose}
      footer={
        <>
          <span className="note-inline">
            {readOnly
              ? 'Connect this wallet to change anything.'
              : changes.length
                ? `Will change: ${changes.join(', ')}. One signature.`
                : 'Nothing changed yet.'}
          </span>
          <button className="cta" type="button" disabled={locked || !changes.length} onClick={save}>
            {busy === 'save' ? 'Waiting for Freighter' : 'Save'}
          </button>
        </>
      }
    >
      <div className="stat3">
        <div>
          <span className="k">Credits</span>
          <span className="v num">{usdc(row.credits)}</span>
          <span className="u">USDC</span>
        </div>
        <div>
          <span className="k">Cap per window</span>
          <span className="v num">{usdc(row.cap)}</span>
          <span className="u">per {row.windowHours}h</span>
        </div>
        <div>
          <span className="k">Spent in window</span>
          <span className="v num">{usdc(row.spent)}</span>
          <span className="u">{usdc(remaining(row.cap, row.spent))} left</span>
        </div>
      </div>

      <label>
        Name
        <input value={name} maxLength={32} onChange={(event) => setName(event.target.value)} />
      </label>

      <div className="two">
        <label>
          Cap per window, USDC
          <input value={cap} inputMode="decimal" onChange={(event) => setCap(event.target.value)} />
        </label>
        <label>
          Window
          <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
            {WINDOWS.map((option) => (
              <option key={option.hours} value={option.hours}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Allowlist
        addresses={addresses}
        labels={labels}
        busy={locked}
        onChange={(next, nextLabels) => {
          setAddresses(next);
          setLabels(nextLabels);
        }}
      />

      <label>
        Add credits, USDC
        <input
          value={topUp}
          inputMode="decimal"
          placeholder="0"
          onChange={(event) => setTopUp(event.target.value)}
        />
      </label>

      {problem && <p className="bad">{problem}</p>}

      <AgentSetup id={row.id} />

      <div className="sec">
        <div className="sh">
          <span>Take money out, or stop the agent</span>
        </div>
        <div className="addrow">
          <input
            value={takeOut}
            inputMode="decimal"
            placeholder={`up to ${usdc(row.credits)}`}
            onChange={(event) => setTakeOut(event.target.value)}
          />
          <button
            className="cta quiet"
            type="button"
            disabled={locked || !takeOut.trim()}
            onClick={() =>
              run('withdraw', () =>
                withdrawFrom(row.id, signingWith(wallet), toBase(takeOut)).then(() => setTakeOut('')),
              )
            }
          >
            {busy === 'withdraw' ? 'Waiting' : 'Withdraw'}
          </button>
        </div>
        <p className="help">
          Withdrawals go back to your own wallet, and nowhere else. No rule applies to them: the
          cap and the allowlist constrain the agent, not you.
        </p>

        {row.enabled && confirmPause ? (
          <div className="addrow">
            <button
              className="cta danger"
              type="button"
              disabled={locked}
              onClick={() => run('pause', () => setEnabled(row.id, signingWith(wallet), false))}
            >
              {busy === 'pause' ? 'Waiting' : 'Yes, pause it'}
            </button>
            <button className="cta quiet" type="button" onClick={() => setConfirmPause(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="addrow">
            <button
              className="cta quiet"
              type="button"
              disabled={locked}
              onClick={() =>
                row.enabled
                  ? setConfirmPause(true)
                  : void run('resume', () => setEnabled(row.id, signingWith(wallet), true))
              }
            >
              {row.enabled ? 'Pause the agent' : busy === 'resume' ? 'Waiting' : 'Resume the agent'}
            </button>
          </div>
        )}
        {row.enabled && confirmPause && (
          <p className="help">
            Pausing refuses every payment until you resume. It moves no money and the spend window
            keeps running, so a pause and a restart is not a way to buy a fresh budget.
          </p>
        )}
      </div>
    </Panel>
  );
}
