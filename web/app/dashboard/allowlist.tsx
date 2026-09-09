'use client';

import { useState } from 'react';
import { remember, type Label } from '@/lib/dashboard/labels';
import type { Offer } from '@/lib/x402/offer';
import { usdc } from '@/lib/demo/params';

export type Labels = Record<string, Label | undefined>;

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export function Allowlist({
  addresses,
  labels,
  onChange,
  busy,
}: {
  addresses: string[];
  labels: Labels;
  onChange: (addresses: string[], labels: Labels) => void;
  busy?: boolean;
}) {
  const [url, setUrl] = useState('');
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState('');
  const [shared, setShared] = useState<{ host: string; other: string } | null>(null);

  async function add() {
    const wanted = url.trim();
    if (!wanted) return;
    setAsking(true);
    setProblem('');
    setShared(null);
    try {
      const response = await fetch('/api/offer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: wanted }),
      });
      const result = (await response.json()) as
        | { ok: true; offer: Omit<Offer, 'amount'> & { amount: string } }
        | { ok: false; reason: string };

      if (!result.ok) {
        setProblem(result.reason);
        return;
      }

      const offer = { ...result.offer, amount: BigInt(result.offer.amount) };
      remember(offer);
      const label: Label = {
        url: offer.url,
        host: offer.host,
        path: offer.path,
        amount: String(offer.amount),
      };

      if (addresses.includes(offer.payTo)) {
        // The moment worth being loud about: the owner thinks they are adding one API and the
        // chain sees an address that is already allowed.
        setShared({ host: offer.host, other: labels[offer.payTo]?.host ?? short(offer.payTo) });
        onChange(addresses, { ...labels, [offer.payTo]: labels[offer.payTo] ?? label });
        setUrl('');
        return;
      }

      onChange([...addresses, offer.payTo], { ...labels, [offer.payTo]: label });
      setUrl('');
    } catch {
      setProblem('could not reach that URL');
    } finally {
      setAsking(false);
    }
  }

  const drop = (address: string) => onChange(addresses.filter((a) => a !== address), labels);

  return (
    <div className="sec">
      <div className="sh">
        <span>APIs the agent may pay</span>
      </div>

      <div className="addrow">
        <input
          value={url}
          disabled={busy || asking}
          placeholder="https://api.example.com/v1/quote"
          spellCheck={false}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void add();
            }
          }}
        />
        <button className="cta quiet" type="button" disabled={busy || asking} onClick={() => void add()}>
          {asking ? 'Asking' : 'Add'}
        </button>
      </div>

      {problem && <p className="bad">{problem}</p>}

      {shared && (
        <p className="warn">
          <b>{shared.host}</b> is paid at an address already on this list, the one used by{' '}
          <b>{shared.other}</b>. The contract allows addresses, not URLs, so this API was already
          payable and anything else sold at that address is too. Split them across two allowances
          if they should have separate budgets.
        </p>
      )}

      {addresses.length === 0 ? (
        <p className="help">
          Nothing yet. An agent with an empty list cannot pay anyone, which is a safe place to
          start and a useless one to stay in.
        </p>
      ) : (
        <div className="res">
          {addresses.map((address) => {
            const label = labels[address];
            return (
              <div key={address}>
                <div>
                  <span className="host">{label?.host ?? short(address)}</span>
                  <small>
                    {label
                      ? `${label.path} · ${usdc(label.amount)} USDC per call · pays ${short(address)}`
                      : 'allowed, but this browser has no note of which API it is'}
                  </small>
                </div>
                <button className="drop" type="button" disabled={busy} onClick={() => drop(address)}>
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="help">
        Each URL is asked what it charges, and the address it wants paying is what goes on chain.
        If that seller later moves to a different address, payments stop instead of following, so
        a compromised or swapped payout address cannot quietly inherit this agent&rsquo;s budget.
        Add the URL again to approve the new one.
      </p>
    </div>
  );
}
