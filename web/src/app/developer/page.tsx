'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/lib/useWallet';
import { proveAddress } from '@/lib/freighter';
import { SiteHeader } from '@/components/SiteHeader';
import { Overlay, Field } from '@/components/Overlay';
import { ApiTable, type ApiRow } from '@/components/ApiTable';

/**
 * What you have listed, and what it has earned.
 *
 * This was a numbered walkthrough: register an API, then collect. That shape suits the first
 * five minutes and nothing after them — somebody coming back already knows what they want to
 * change, and had to walk past the tutorial to reach it. So it is a table, and a row opens.
 *
 * Two things are deliberately absent from the table. The upstream URL, because a developer knows
 * where their own server is and the URL they actually need is the one they hand to customers.
 * And the payout address, because it cannot be changed — it is fixed inside the splitter contract
 * at deployment, which is the reason a developer does not have to trust us with their money.
 * Both are in the row's dialog, where the second one can be explained rather than just displayed.
 */

type Api = ApiRow;

const usdc = (stroops?: string) => (Number(stroops ?? 0) / 1e7).toFixed(2);
const stroops = (amount: string) => BigInt(Math.round(Number(amount) * 1e7));

export default function DeveloperPage() {
  const { wallet, connecting, restoring, error: walletError, connect } = useWallet();

  const [handle, setHandle] = useState<string | null>(null);
  const [knownHandle, setKnownHandle] = useState(false);
  const [apis, setApis] = useState<Api[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Api | null>(null);
  const [adding, setAdding] = useState(false);

  const address = wallet?.address ?? null;

  const load = useCallback(async (owner: string) => {
    const [listed, developer] = await Promise.all([
      fetch(`/api/apis?developer=${owner}`).then((r) => r.json()),
      fetch(`/api/developers?address=${owner}`).then((r) => r.json()),
    ]);
    setApis(listed.apis ?? []);
    setHandle(developer.username ?? null);
    setKnownHandle(true);
  }, []);

  useEffect(() => {
    if (!address) return;
    load(address).catch(() => setKnownHandle(true));
  }, [address, load]);

  /** Every write is signed. There is no session, so proof travels with the action. */
  const signed = async (label: string, run: (proof: Awaited<ReturnType<typeof proveAddress>>) => Promise<void>) => {
    if (!address) return;
    setBusy(label);
    setError(null);
    try {
      await run(await proveAddress(address));
      await load(address);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const plain = async (label: string, run: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await run();
      if (address) await load(address);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const uncollected = apis.reduce((total, api) => total + Number(api.pending_stroops ?? 0), 0);

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-[1180px] px-4 sm:px-6 py-10">
        <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
          <div>
            <p className="label mb-1">[ DEVELOPER ]</p>
            <h1 className="text-2xl font-medium">Your APIs</h1>
          </div>

          {address && handle && (
            <button
              onClick={() => setAdding(true)}
              className="chip chip-accent px-4 py-2.5 cursor-pointer whitespace-nowrap"
            >
              + add an API
            </button>
          )}
        </div>

        {address && handle && (
          <p className="label mb-6">
            <span style={{ color: 'var(--lavender)' }}>@{handle}</span>
            {uncollected > 0 && ` · ${usdc(String(uncollected))} USDC waiting to be collected`}
          </p>
        )}

        {error && (
          <p className="text-sm mb-5 max-w-[70ch]" style={{ color: 'var(--drained)' }}>
            {error}
          </p>
        )}

        {/* --------------------------------------------------------- not here yet */}
        {!address ? (
          <div className="panel p-6 pt-8 max-w-[520px]">
            <span className="panel-tag">[ WALLET ]</span>
            <p className="text-sm text-[color:var(--muted)] mb-5 max-w-[46ch] leading-relaxed">
              Your wallet is how an API is proved to be yours, and where its earnings are paid.
              Freighter, on Testnet.
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
        ) : !knownHandle ? (
          <p className="label">loading…</p>
        ) : !handle ? (
          <ChooseHandle
            busy={busy === 'handle'}
            onChoose={(username) =>
              signed('handle', async (proof) => {
                const response = await fetch('/api/developers', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ ...proof, username }),
                });
                if (!response.ok) throw new Error((await response.json()).error);
              })
            }
          />
        ) : apis.length === 0 ? (
          <div className="panel p-6 pt-8 max-w-[560px]">
            <span className="panel-tag">[ NOTHING LISTED ]</span>
            <p className="text-sm text-[color:var(--muted)] max-w-[48ch] leading-relaxed">
              Point this at an API you already run and set a price. You get a URL that answers{' '}
              <span className="num text-[color:var(--text)]">402 Payment Required</span>, takes the
              payment, and forwards the request. Nothing about your API changes.
            </p>
          </div>
        ) : (
          <ApiTable
            apis={apis}
            busy={busy}
            onOpen={setEditing}
            onCollect={(api) =>
              plain(`collect-${api.id}`, async () => {
                const response = await fetch(`/api/apis/${api.id}/collect`, { method: 'POST' });
                if (!response.ok) throw new Error((await response.json()).error);
              })
            }
          />
        )}
      </main>

      {adding && handle && (
        <AddApi
          payout={address!}
          busy={busy === 'add'}
          onClose={() => setAdding(false)}
          onAdd={(fields) =>
            plain('add', async () => {
              const response = await fetch('/api/apis', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ...fields, developer_address: address, payout_address: address }),
              });
              if (!response.ok) throw new Error((await response.json()).error ?? 'Could not register it.');
              setAdding(false);
            })
          }
        />
      )}

      {editing && (
        <EditApi
          api={editing}
          busy={busy === 'edit'}
          onClose={() => setEditing(null)}
          onSave={(patch) =>
            signed('edit', async (proof) => {
              const response = await fetch(`/api/apis/${editing.id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ...proof, ...patch }),
              });
              if (!response.ok) throw new Error((await response.json()).error);
              setEditing(null);
            })
          }
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- dialogs

function ChooseHandle({ busy, onChoose }: { busy: boolean; onChoose: (name: string) => void }) {
  const [name, setName] = useState('');

  return (
    <div className="panel p-6 pt-8 max-w-[520px]">
      <span className="panel-tag">[ PICK A HANDLE ]</span>
      <p className="text-sm text-[color:var(--muted)] mb-5 max-w-[46ch] leading-relaxed">
        Anyone allowlisting your API sees this instead of an address. It is a name you pick, not
        one anybody checks, so it is shown as <span className="num">@handle</span> — never as
        proof of who you are.
      </p>

      <Field
        label="handle"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="alice"
        spellCheck={false}
        hint="3–20 characters · lowercase, digits, underscore or hyphen · cannot be changed later"
      />

      <button
        onClick={() => onChoose(name)}
        disabled={busy || name.trim().length < 3}
        className="chip chip-accent px-4 py-2.5 cursor-pointer disabled:opacity-40"
      >
        {busy ? 'signing…' : 'claim it'}
      </button>
      <p className="label mt-3">signing proves the wallet is yours · it moves no money</p>
    </div>
  );
}

function AddApi({
  payout,
  busy,
  onClose,
  onAdd,
}: {
  payout: string;
  busy: boolean;
  onClose: () => void;
  onAdd: (fields: { name: string; upstream_url: string; price_stroops: string }) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [price, setPrice] = useState('0.10');

  return (
    <Overlay
      title="Add an API"
      note="We deploy a payment contract for it and give you a URL to hand out. Nothing about your own API changes."
      onClose={onClose}
    >
      <Field label="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="weather" />
      <Field
        label="your API's URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://api.example.com/v1/forecast"
        spellCheck={false}
        hint="where we forward paid requests · https, and only you and we will call it"
      />
      <Field
        label="price per call (USDC)"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        inputMode="decimal"
      />

      <p className="label mb-5 leading-relaxed">
        earnings pay out to {payout.slice(0, 6)}…{payout.slice(-4)} — fixed in the contract when it
        is created, and not changeable afterwards by you or by us
      </p>

      <button
        onClick={() => onAdd({ name, upstream_url: url, price_stroops: stroops(price).toString() })}
        disabled={busy || !name.trim() || !url.trim() || !(Number(price) > 0)}
        className="chip chip-accent px-4 py-2.5 cursor-pointer disabled:opacity-40"
      >
        {busy ? 'deploying…' : 'add it'}
      </button>
    </Overlay>
  );
}

function EditApi({
  api,
  busy,
  onClose,
  onSave,
}: {
  api: Api;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: Record<string, string>) => void;
}) {
  const [name, setName] = useState(api.name);
  const [url, setUrl] = useState(api.upstream_url);
  const [price, setPrice] = useState(usdc(api.price_stroops));
  const [confirmRetire, setConfirmRetire] = useState(false);

  return (
    <Overlay title={api.name} onClose={onClose}>
      <Field label="name" value={name} onChange={(e) => setName(e.target.value)} />
      <Field label="your API's URL" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
      <Field
        label="price per call (USDC)"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        inputMode="decimal"
        hint="anyone already holding a quote pays the price they were quoted, until it expires"
      />

      <div className="border-t border-[color:var(--line)] pt-4 mb-5">
        <p className="label mb-1">pays out to</p>
        <p className="num text-xs text-[color:var(--faint)] break-all">{api.payout_address}</p>
        <p className="label mt-2 leading-relaxed">
          fixed in the payment contract when it was created · neither you nor we can change it,
          which is why you never have to trust us with the money
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() =>
            onSave({ name, upstream_url: url, price_stroops: stroops(price).toString() })
          }
          disabled={busy}
          className="chip chip-accent px-4 py-2.5 cursor-pointer disabled:opacity-40"
        >
          {busy ? 'signing…' : 'save'}
        </button>

        <button
          onClick={() => (confirmRetire ? onSave({ status: 'archived' }) : setConfirmRetire(true))}
          disabled={busy}
          className="chip px-4 py-2.5 cursor-pointer disabled:opacity-40"
          style={{ borderColor: 'var(--drained)', color: 'var(--drained)' }}
        >
          {confirmRetire ? 'yes, retire it' : 'retire'}
        </button>

        {confirmRetire && (
          <span className="label" style={{ color: 'var(--drained)' }}>
            the URL stops answering · anything uncollected stays collectable
          </span>
        )}
      </div>
    </Overlay>
  );
}
