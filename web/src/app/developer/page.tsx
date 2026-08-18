'use client';

import { useCallback, useEffect, useState } from 'react';
import { connect, type Wallet } from '@/lib/freighter';
import { SiteHeader } from '@/components/SiteHeader';
import { Step } from '@/components/Step';

/**
 * The developer tab.
 *
 * Put a price on an API you already run. Nothing about the API changes — no SDK, no code, no
 * redeploy. It keeps answering the same way; a gateway in front of it collects the money and
 * forwards the request with a shared secret so the origin can tell the call came through us.
 */

type Api = {
  id: string;
  name: string;
  upstream_url: string;
  price_stroops: string;
  splitter_contract_id: string | null;
  status: string;
  paid_url: string;
  pending_stroops: string;
};

const usdc = (stroops?: string) => (Number(stroops ?? 0) / 1e7).toFixed(2);

export default function DeveloperPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [apis, setApis] = useState<Api[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [name, setName] = useState('My API');
  const [url, setUrl] = useState('https://api.github.com/zen');
  const [price, setPrice] = useState('0.10');

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const load = useCallback(async (address: string) => {
    const response = await fetch(`/api/apis?developer=${address}`);
    if (response.ok) setApis((await response.json()).apis ?? []);
  }, []);

  useEffect(() => {
    if (!wallet) return;
    load(wallet.address);
    const timer = setInterval(() => load(wallet.address), 8000);
    return () => clearInterval(timer);
  }, [wallet, load]);

  async function register() {
    if (!wallet) return;
    const response = await fetch('/api/apis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        developer_address: wallet.address,
        payout_address: wallet.address,
        name,
        upstream_url: url,
        price_stroops: String(Math.round(Number(price) * 1e7)),
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Could not register.');
    await load(wallet.address);
    setNote(`Live at ${body.paid_url}`);
  }

  async function collect(api: Api) {
    const response = await fetch(`/api/apis/${api.id}/collect`, { method: 'POST' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Could not collect.');
    setNote(
      `Paid out ${usdc(body.developer_stroops)} USDC to you, ${usdc(body.platform_stroops)} fee.`,
    );
    if (wallet) await load(wallet.address);
  }

  const totalPending = apis.reduce((sum, api) => sum + Number(api.pending_stroops ?? 0), 0);

  return (
    <main className="relative z-10">
      <SiteHeader
        right={<span className="chip">{wallet ? `${wallet.address.slice(0, 6)}…` : 'not connected'}</span>}
      />

      <div className="mx-auto max-w-[900px] px-6 py-12 space-y-4">
        <div className="mb-8">
          <p className="label mb-4">[ FOR API OWNERS ]</p>
          <h1 className="display max-w-[15ch]">Charge per call.</h1>
          <p className="mt-6 max-w-[54ch] text-[color:var(--muted)] leading-relaxed">
            Point us at an API you already run and set a price. You get a new URL to share.
            Nothing about your API changes — no SDK, no code, no redeploy. Every paid call sends
            you 90%, and the split is fixed in a contract you can read.
          </p>
        </div>

        {error && (
          <div className="panel p-4" style={{ borderColor: 'var(--drained)' }}>
            <p className="text-sm" style={{ color: 'var(--drained)' }}>{error}</p>
          </div>
        )}
        {note && (
          <div className="panel p-4" style={{ borderColor: 'var(--held)' }}>
            <p className="text-sm num break-all" style={{ color: 'var(--held)' }}>{note}</p>
          </div>
        )}

        {/* connect */}
        <Step
          n={1}
          state={wallet ? 'done' : 'todo'}
          title="Connect your wallet"
          summary="The address your 90% is paid to."
        >
          <p className="text-sm text-[color:var(--muted)] mb-4 max-w-[52ch]">
            This is the address your 90% is paid to. Freighter, on Testnet.
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

        {/* register */}
        <Step
          n={2}
          state={!wallet ? 'locked' : 'todo'}
          title="Add an API"
          summary="Point us at an API you already run and set a price. You get back a new URL that collects the money before forwarding the request."
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] items-end">
            <label className="block">
              <span className="label block mb-1.5">name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="label block mb-1.5">your API url</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full num bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="label block mb-1.5">price / call</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                className="w-24 num bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2 text-sm"
              />
            </label>
          </div>
          <button
            className="chip chip-accent px-4 py-2.5 mt-5 cursor-pointer"
            disabled={busy !== null}
            onClick={() => run('register', register)}
          >
            {busy === 'register' ? 'deploying your contract…' : 'add API'}
          </button>
          <p className="label mt-3">
            deploys a payment contract for this API alone · we pay the fee
          </p>
        </Step>

        {/* list */}
        <Step
          n={3}
          state={wallet && apis.length > 0 ? 'todo' : 'locked'}
          title="Collect what you have earned"
          summary="Every paid call accumulates in your API's own contract. Collect sends 90% to you and 10% to us, in a ratio fixed when the contract was made."
        >
          <div className="flex items-baseline justify-between mb-6">
            <p className="text-sm text-[color:var(--muted)]">Your APIs</p>
            <div className="text-right">
              <p className="label">uncollected</p>
              <p className="num text-2xl text-[color:var(--accent)]">
                {usdc(String(totalPending))} USDC
              </p>
            </div>
          </div>

          <div className="space-y-px bg-[color:var(--line)]">
              {apis.map((api) => (
                <div key={api.id} className="bg-[color:var(--ground)] py-4 px-1">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {api.name}{' '}
                        <span className="label">· {usdc(api.price_stroops)} per call</span>
                      </p>
                      <p className="num text-xs text-[color:var(--muted)] break-all mt-1">
                        {api.paid_url}
                      </p>
                      <p className="label mt-1">
                        contract {api.splitter_contract_id?.slice(0, 10)}… · {api.status}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="label">pending</p>
                        <p className="num text-sm">{usdc(api.pending_stroops)}</p>
                      </div>
                      <button
                        className="chip px-3 py-2 cursor-pointer hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors disabled:opacity-40"
                        disabled={busy !== null || Number(api.pending_stroops) === 0}
                        onClick={() => run(`collect-${api.id}`, () => collect(api))}
                      >
                        {busy === `collect-${api.id}` ? 'collecting…' : 'collect'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

          <p className="label mt-5 leading-relaxed">
            collecting is permissionless — anyone can trigger a payout, and it can only ever go to
            your address and ours, in the ratio fixed when the contract was made
          </p>
        </Step>
      </div>
    </main>
  );
}
