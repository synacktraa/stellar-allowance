'use client';

import type { Balances, Wallet } from '@/lib/freighter';
import { Copyable } from '@/components/Copyable';
import { Step } from '@/components/Step';

/**
 * Step one, on both tabs.
 *
 * Shows what the wallet holds as soon as it connects. Every later step spends one of these two
 * balances, and a number already on screen is what makes "not enough" a fact the user can see
 * coming rather than a transaction that reverts.
 */
export function ConnectStep({
  wallet,
  funds,
  connecting,
  restoring,
  purpose,
  onConnect,
}: {
  wallet: Wallet | null;
  funds: Balances | null;
  connecting: boolean;
  restoring: boolean;
  /** One line on what this address is for — it differs between the two tabs. */
  purpose: string;
  onConnect: () => void;
}) {
  return (
    <Step
      n={1}
      state={wallet ? 'done' : 'todo'}
      title="Connect your wallet"
      summary={purpose}
    >
      <p className="text-sm text-[color:var(--muted)] mb-4 max-w-[52ch]">{purpose}</p>

      {wallet ? (
        <>
          <Copyable value={wallet.address} label="your address" />

          <div className="flex flex-wrap gap-8 mt-5">
            <div>
              <p className="label mb-1">XLM</p>
              <p className="num text-lg">{funds ? funds.xlm.toFixed(2) : '—'}</p>
            </div>
            <div>
              <p className="label mb-1">USDC</p>
              <p
                className="num text-lg"
                style={funds && !funds.hasUsdcTrustline ? { color: 'var(--drained)' } : undefined}
              >
                {funds ? (funds.hasUsdcTrustline ? funds.usdc.toFixed(2) : 'no trustline') : '—'}
              </p>
            </div>
          </div>

          {funds && !funds.hasUsdcTrustline && (
            <p className="text-sm mt-4 max-w-[52ch]" style={{ color: 'var(--drained)' }}>
              This wallet cannot hold USDC yet. Add a USDC trustline in Freighter — issuer{' '}
              <span className="num">GBBD47IF…FLA5</span> — then reconnect.
            </p>
          )}
        </>
      ) : (
        <button
          className="chip chip-accent px-4 py-2.5 cursor-pointer disabled:opacity-40"
          disabled={connecting || restoring}
          onClick={onConnect}
        >
          {restoring ? 'checking…' : connecting ? 'connecting…' : 'connect freighter'}
        </button>
      )}
    </Step>
  );
}
