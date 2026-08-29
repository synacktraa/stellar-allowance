'use client';

import { Copyable } from '@/components/Copyable';

/**
 * What a developer has listed, one row each.
 *
 * The URL shown is the *paid* one — the link they hand to customers — not their own server's
 * address, which they already know and which nobody else should be calling directly. Everything
 * a row can change lives behind the row rather than in it, so the table stays readable at a
 * glance and the explanations happen where there is room for them.
 */

export type ApiRow = {
  id: string;
  name: string;
  upstream_url: string;
  price_stroops: string;
  payout_address: string;
  paid_url: string;
  pending_stroops: string;
  status: string;
};

const usdc = (stroops?: string) => (Number(stroops ?? 0) / 1e7).toFixed(2);

export function ApiTable({
  apis,
  busy,
  onOpen,
  onCollect,
}: {
  apis: ApiRow[];
  busy: string | null;
  onOpen: (api: ApiRow) => void;
  onCollect: (api: ApiRow) => void;
}) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-sm min-w-[680px]">
        <thead>
          <tr className="border-b border-[color:var(--line)]">
            <th className="label text-left font-normal px-4 py-3">name</th>
            <th className="label text-left font-normal px-4 py-3">url to share</th>
            <th className="label text-right font-normal px-4 py-3">per call</th>
            <th className="label text-right font-normal px-4 py-3">earned</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {apis.map((api) => {
            const waiting = Number(api.pending_stroops ?? 0) > 0;
            return (
              <tr
                key={api.id}
                onClick={() => onOpen(api)}
                className="border-b border-[color:var(--line)] last:border-0 cursor-pointer hover:bg-[color:var(--panel-2)]"
              >
                <td className="px-4 py-3">{api.name}</td>
                {/* The copy button is its own action; clicking it should not also open the row. */}
                <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                  <Copyable value={api.paid_url} label="paid url" />
                </td>
                <td className="px-4 py-3 num text-right">{usdc(api.price_stroops)}</td>
                <td
                  className="px-4 py-3 num text-right"
                  style={{ color: waiting ? 'var(--held)' : 'var(--faint)' }}
                >
                  {usdc(api.pending_stroops)}
                </td>
                <td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                  <button
                    onClick={() => onCollect(api)}
                    disabled={!waiting || busy !== null}
                    className="chip px-3 py-1.5 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {busy === `collect-${api.id}` ? 'paying out…' : 'collect'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
