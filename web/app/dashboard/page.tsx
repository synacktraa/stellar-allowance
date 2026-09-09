'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { rpc } from '@stellar/stellar-sdk';
import { MAX_ALLOWANCES, usdc } from '@/lib/demo/params';
import { labelsFor } from '@/lib/dashboard/labels';
import { readAllowances, RPC_URL, type Listing, type Row } from '@/lib/dashboard/read';
import { connect, readWallet, resume, type Wallet } from '@/lib/dashboard/wallet';
import { PAGE_SIZE, page, pageCount } from '@/lib/dashboard/summary';
import { Footer, Header } from '../chrome';
import { CreatePanel, DetailPanel } from './panels';

/** Placeholder lines held while the two reads are in flight. */
const WAITING = 5;

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
const say = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Open = { kind: 'create' } | { kind: 'row'; id: string } | null;

export default function Dashboard() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [open, setOpen] = useState<Open>(null);
  const [at, setAt] = useState(1);
  const [signedIn, setSignedIn] = useState(false);
  const [checking, setChecking] = useState(true);

  // Occupancy is the one thing a stale answer gets wrong in a way the owner pays for, so every
  // load asks the chain rather than trusting anything this browser remembers.
  //
  // The wallet is one Horizon call and the listing is sixty ledger entries, so each is shown as
  // it lands: the board arrives with the wallet and placeholder lines, and the lines fill in.
  const refresh = useCallback(async (address: string) => {
    const server = new rpc.Server(RPC_URL);
    setListing(null);
    await Promise.all([
      readWallet(address).then(setWallet),
      readAllowances(server, address).then(setListing),
    ]);
  }, []);

  async function onConnect() {
    setBusy(true);
    setProblem('');
    try {
      const address = await connect();
      await refresh(address);
      setSignedIn(true);
    } catch (error) {
      setProblem(say(error));
    } finally {
      setBusy(false);
    }
  }

  // An allowance is public: its rules and its spending are readable by anyone, which is what
  // makes the claim that one named wallet controls this money checkable rather than asserted.
  // So an owner address in the URL opens the same board without a wallet, and without the
  // buttons that would need one. Otherwise the approval this browser already holds is what
  // decides, because Freighter will not prompt twice for it.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('owner');
    if (asked && /^G[A-Z2-7]{55}$/.test(asked)) {
      setChecking(false);
      void refresh(asked).catch((error) => setProblem(say(error)));
      return;
    }
    void resume()
      .then(async (address) => {
        if (!address) return;
        setSignedIn(true);
        await refresh(address);
      })
      .catch((error) => setProblem(say(error)))
      .finally(() => setChecking(false));
  }, [refresh]);

  useEffect(() => {
    if (!wallet || !listing) return;
    setAt((current) => Math.min(current, pageCount(listing.rows.length)));
  }, [wallet, listing]);

  const reload = () => {
    if (wallet) void refresh(wallet.address).catch((error) => setProblem(say(error)));
  };

  if (!wallet) {
    return (
      <main className="wrap">
        <Header create={false} />
        <div className="connect">
          <h1>Your allowances</h1>
          <p className="lede">
            Connect the wallet that owns them. It signs, and it is the only thing that can change
            a rule or take money back out.
          </p>
          <div className="act">
            <button
              className="cta"
              type="button"
              disabled={busy || checking}
              onClick={() => void onConnect()}
            >
              {checking ? 'Checking Freighter' : busy ? 'Asking Freighter' : 'Connect Freighter'}
            </button>
            <span className="note-inline">testnet · nothing is signed by connecting</span>
          </div>
          {problem && <p className="bad">{problem}</p>}
        </div>
        <Footer />
      </main>
    );
  }

  const rows = listing?.rows ?? [];
  const pages = pageCount(rows.length);
  const showing = page(rows, at);
  const selected = open?.kind === 'row' ? rows.find((row) => row.id === open.id) : undefined;
  const noTrustline = wallet.usdc === undefined;
  const full = listing?.nextIndex === undefined;
  const readOnly = !signedIn;

  return (
    <>
      <div className="top">
        <div className="left">
          <a className="brand" href="/">
            STELLAR<span>//</span>ALLOWANCE
          </a>
          <div className="chip-wallet">
            <span className="dot" />
            <b className="num">{short(wallet.address)}</b>
            <span className="sep">|</span>
            <span className="num">{Number(wallet.xlm).toFixed(2)} XLM</span>
            <span className="num">{noTrustline ? 'no USDC' : `${Number(wallet.usdc).toFixed(3)} USDC`}</span>
            <span className="sep">|</span>
            <span>testnet</span>
          </div>
        </div>
        <div className="right">
          <button
            className="cta"
            type="button"
            disabled={readOnly || noTrustline || full}
            title={full ? `This wallet already holds all ${MAX_ALLOWANCES} it can` : undefined}
            onClick={() => setOpen({ kind: 'create' })}
          >
            New allowance
          </button>
        </div>
      </div>

      <main className="board">
        {readOnly && (
          <p className="warn banner">
            Reading someone else&rsquo;s allowances. Everything here is public on chain. Connect
            that wallet to change anything.
          </p>
        )}
        {!readOnly && noTrustline && (
          <p className="warn banner">
            This wallet has no USDC trustline, so it cannot hold the asset an allowance spends. Add
            one for USDC issued by <code>{short('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')}</code>{' '}
            in Freighter, then reload. Until then there is nothing to fund an allowance with.
          </p>
        )}
        {problem && <p className="bad banner">{problem}</p>}

        <div className="head">
          <h1>Allowances</h1>
        </div>

        {listing && rows.length === 0 ? (
          <div className="card empty">
            <p>
              Nothing here yet. An allowance is a contract that holds your USDC and pays only the
              APIs you allow, only up to a cap you set.
            </p>
            <button
              className="cta quiet"
              type="button"
              disabled={readOnly || noTrustline}
              onClick={() => setOpen({ kind: 'create' })}
            >
              Create the first one
            </button>
          </div>
        ) : (
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Credits</th>
                  <th>APIs</th>
                  <th>Cap per window</th>
                  <th>Spent in window</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {listing
                  ? showing.map((row, nth) => (
                      <Line
                        key={row.id}
                        row={row}
                        nth={nth}
                        onOpen={() => setOpen({ kind: 'row', id: row.id })}
                      />
                    ))
                  : Array.from({ length: WAITING }, (_, nth) => <Waiting key={nth} />)}
              </tbody>
            </table>
            {listing && pages > 1 && (
              <div className="foot">
                <span>
                  Showing {(at - 1) * PAGE_SIZE + 1} to {(at - 1) * PAGE_SIZE + showing.length} of {rows.length}
                </span>
                <div className="pages">
                  <button type="button" disabled={at === 1} onClick={() => setAt(at - 1)}>
                    ‹
                  </button>
                  {Array.from({ length: pages }, (_, n) => (
                    <button
                      key={n}
                      type="button"
                      className={at === n + 1 ? 'cur' : undefined}
                      onClick={() => setAt(n + 1)}
                    >
                      {n + 1}
                    </button>
                  ))}
                  <button type="button" disabled={at === pages} onClick={() => setAt(at + 1)}>
                    ›
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {open?.kind === 'create' && listing?.nextIndex !== undefined && (
        <CreatePanel
          wallet={wallet}
          index={listing.nextIndex}
          onClose={() => setOpen(null)}
          onDone={reload}
        />
      )}
      {selected && (
        <DetailPanel
          wallet={wallet}
          row={selected}
          readOnly={readOnly}
          onClose={() => setOpen(null)}
          onDone={reload}
        />
      )}
    </>
  );
}

/**
 * A line the table holds while the chain is read.
 *
 * The header and the row height are already right, so nothing under the table moves when the
 * real lines replace these. It carries no text, so a screen reader is told nothing yet.
 */
function Waiting() {
  return (
    <tr className="skeleton" aria-hidden="true">
      {Array.from({ length: 6 }, (_, cell) => (
        <td key={cell}>
          <span />
        </td>
      ))}
    </tr>
  );
}

function Line({ row, nth, onOpen }: { row: Row; nth: number; onOpen: () => void }) {
  const labels = labelsFor(row.allowlist);
  const named = row.allowlist.map((address) => labels[address]?.host ?? short(address));
  return (
    <tr
      className="line"
      style={{ '--i': nth } as CSSProperties}
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && onOpen()}
    >
      <td>
        <span className="name">{row.name || short(row.id)}</span>
        <span className="sub num">{short(row.id)}</span>
      </td>
      <td className="num">{usdc(row.credits)} USDC</td>
      <td>
        {named.length === 0 ? (
          <span className="api none">none</span>
        ) : (
          <div className="apis">
            {named.slice(0, 2).map((host) => (
              <span className="api" key={host}>
                {host}
              </span>
            ))}
            {named.length > 2 && <span className="api more">+{named.length - 2}</span>}
          </div>
        )}
      </td>
      <td className="num">
        {usdc(row.cap)} / {row.windowHours}h
      </td>
      <td className="num">{usdc(row.spent)}</td>
      <td>
        <span className={`pill ${row.enabled ? 'on' : 'off'}`}>{row.enabled ? 'Active' : 'Paused'}</span>
      </td>
    </tr>
  );
}
