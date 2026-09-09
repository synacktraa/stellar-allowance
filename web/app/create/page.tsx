'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { Horizon, rpc } from '@stellar/stellar-sdk';
import { firstFreeIndex } from '@/lib/allowance/index';
import { connect } from '@/lib/create/wallet';
import { HORIZON_URL, RPC_URL, USDC_ISSUER, deployAllowance, wasmInstalled } from '@/lib/create/deploy';
import { DECIMALS, usdc } from '@/lib/demo/params';
import { Footer, Header } from '../chrome';

type State = 'idle' | 'started' | 'done' | 'failed';

interface Row {
  state: State;
  sub?: string;
  amount?: string;
}

const STEPS = [
  { id: 'connect', title: 'Connect Freighter', sub: 'your wallet, on testnet' },
  { id: 'balances', title: 'Read the wallet', sub: undefined },
  { id: 'index', title: 'Find the next free index', sub: 'the address is derived from the owner and a counter' },
  { id: 'deploy', title: 'Deploy the allowance', sub: 'one transaction, signed in Freighter' },
] as const;

type Id = (typeof STEPS)[number]['id'];

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
const LEDGERS_PER_HOUR = 720;

// "0.25" -> 2_500_000n. Text in, base units out, no floating point on the way.
function toBase(amount: string): bigint {
  const [whole, fraction = ''] = amount.trim().split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > DECIMALS) {
    throw new Error(`"${amount}" is not an amount with at most ${DECIMALS} decimals`);
  }
  return BigInt(whole) * 10n ** BigInt(DECIMALS) + BigInt((fraction + '0'.repeat(DECIMALS)).slice(0, DECIMALS));
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function Create() {
  const [rows, setRows] = useState<Partial<Record<Id, Row>>>({});
  const [owner, setOwner] = useState('');
  const [pair, setPair] = useState<{ id: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const set = (id: Id, row: Row) => setRows((current) => ({ ...current, [id]: row }));

  async function step<T>(id: Id, work: () => Promise<T>, after: (result: T) => Row): Promise<T> {
    set(id, { state: 'started' });
    try {
      const result = await work();
      set(id, after(result));
      return result;
    } catch (error) {
      set(id, { state: 'failed', sub: message(error) });
      throw error;
    }
  }

  async function onConnect() {
    setBusy(true);
    try {
      const { address } = await step('connect', connect, ({ address }) => ({ state: 'done', sub: short(address) }));
      setOwner(address);
      await step(
        'balances',
        async () => {
          const account = await new Horizon.Server(HORIZON_URL).loadAccount(address);
          const xlm = account.balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
          const line = account.balances.find(
            (b) => 'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
          );
          return { xlm, held: line?.balance };
        },
        ({ xlm, held }) => ({
          state: held === undefined ? 'failed' : 'done',
          amount: `${Number(xlm).toFixed(2)} XLM${held ? ` · ${Number(held).toFixed(3)} USDC` : ''}`,
          sub:
            held === undefined
              ? 'no USDC trustline. Add one and swap some XLM for USDC, then reload.'
              : 'the deposit comes out of this',
        }),
      );
    } catch {
      // The row already says what went wrong.
    } finally {
      setBusy(false);
    }
  }

  async function onDeploy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const hours = Number(form.get('hours'));
    setBusy(true);
    try {
      const rules = {
        name: String(form.get('name') ?? '').trim() || 'Agent',
        deposit: toBase(String(form.get('deposit'))),
        cap: toBase(String(form.get('cap'))),
        windowLedgers: Math.max(1, Math.round(hours * LEDGERS_PER_HOUR)),
        allowlist: String(form.get('allowlist') ?? '')
          .split(/\s+/)
          .filter(Boolean),
      };
      if (rules.allowlist.length === 0) throw new Error('the allowlist needs at least one address');
      const server = new rpc.Server(RPC_URL);

      const { index, address } = await step(
        'index',
        async () => {
          if (!(await wasmInstalled(server))) throw new Error('the contract code is not on testnet');
          return firstFreeIndex(server, owner);
        },
        ({ index, address }) => ({ state: 'done', sub: `index ${index} · ${short(address)}` }),
      );
      const deployed = await step(
        'deploy',
        () => deployAllowance(owner, index, rules),
        ({ id }) => ({
          state: 'done',
          sub: `${id === address ? 'at the derived address' : id} · allowlist of ${rules.allowlist.length} · cap ${usdc(rules.cap)} USDC per ${hours}h`,
          amount: `${usdc(rules.deposit)} USDC in`,
        }),
      );
      setPair(deployed);
    } catch (error) {
      // A rule that does not parse never reaches a step, so it is said on the index row.
      setRows((current) =>
        current.index?.state === 'failed' || current.deploy?.state === 'failed'
          ? current
          : { ...current, index: { state: 'failed', sub: message(error) } },
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  }

  const connected = rows.connect?.state === 'done';
  const funded = rows.balances?.state === 'done';

  return (
    <main className="wrap">
      <Header create={false} />

      <div className="hero">
        <div>
          <h1>Create an allowance.</h1>
          <p className="lede">
            Your wallet funds it and sets the rules. The agent gets a key that can <b>ask</b> to pay, and
            the contract answers. That key is made here, in your browser, and shown once.
          </p>
        </div>
      </div>

      <section>
        <p className="kicker">
          <span>{pair ? 'Created' : busy ? 'Working' : 'Four steps'}</span>
          <span className="num">testnet</span>
        </p>

        <div className="run">
          {STEPS.map((s, i) => {
            const row = rows[s.id];
            const state = row?.state ?? 'idle';
            const sub = row?.sub ?? s.sub;
            return (
              <div key={s.id} className={`row ${state}`} style={{ '--i': i } as CSSProperties}>
                <span className="who">{s.id === 'deploy' ? 'chain' : 'owner'}</span>
                <div className="what">
                  <span>{s.title}</span>
                  {sub && <span className="sub">{sub}</span>}
                </div>
                <span className="amt num">{row?.amount ?? ''}</span>
                <span className="state">
                  {state === 'done' && <span className="ok">done</span>}
                  {state === 'failed' && <span className="chip failed">failed</span>}
                  {state === 'started' && 'working'}
                </span>
              </div>
            );
          })}

          {connected && funded && !pair && (
            <form className="form" onSubmit={onDeploy}>
              <label>
                Name
                <input name="name" defaultValue="My agent" maxLength={32} />
              </label>
              <label>
                Deposit, USDC
                <input name="deposit" defaultValue="1" inputMode="decimal" required />
              </label>
              <label>
                Cap per window, USDC
                <input name="cap" defaultValue="0.25" inputMode="decimal" required />
              </label>
              <label>
                Window, hours
                <input name="hours" type="number" defaultValue={24} min={1} max={720} required />
              </label>
              <label className="wide">
                Allowlist, one address per line
                <textarea name="allowlist" placeholder="G… or C…" spellCheck={false} required />
              </label>
              <p className="hint">
                Only these addresses can be paid. Anything else is refused before it leaves the contract.
              </p>
              <div className="act hint">
                <button className="cta" type="submit" disabled={busy}>
                  {busy ? 'Waiting for Freighter' : 'Deploy'}
                </button>
                <span className="note-inline">Freighter asks once · the deposit moves, nothing else</span>
              </div>
            </form>
          )}
        </div>

        {!connected && (
          <div className="act">
            <button className="cta" onClick={onConnect} disabled={busy}>
              {busy ? 'Asking Freighter' : 'Connect Freighter'}
            </button>
            <span className="note-inline">testnet · nothing is signed yet</span>
          </div>
        )}

        {pair && (
          <div className="side reveal">
            <div className="stats">
              <div className="cell addr">
                <div className="k">The allowance</div>
                <div className="v">{pair.id}</div>
                <button className="copy" onClick={() => copy('id', pair.id)}>
                  {copied === 'id' ? 'copied' : 'copy'}
                </button>
              </div>
              <div className="cell addr">
                <div className="k">The agent&rsquo;s secret</div>
                <div className="v">{pair.secret}</div>
                <button className="copy" onClick={() => copy('secret', pair.secret)}>
                  {copied === 'secret' ? 'copied' : 'copy'}
                </button>
              </div>
            </div>
            <p className="note">
              The secret is shown once. Put both in the agent&rsquo;s environment now. The key it unlocks
              can ask the allowance to pay; it cannot move anything on its own.
            </p>
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
