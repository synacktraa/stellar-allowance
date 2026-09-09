import { NETWORK_ID, USDC_SAC } from '../demo/params';

// One seller's price for one URL, as the allowlist needs it: an address to allow, and enough
// detail for the owner to recognise what they are allowing.
export interface Offer {
  url: string;
  host: string;
  path: string;
  amount: bigint;
  asset: string;
  payTo: string;
  network: string;
}

export type Resolution = { ok: true; offer: Offer } | { ok: false; reason: string };

interface Accepts {
  network?: unknown;
  asset?: unknown;
  amount?: unknown;
  payTo?: unknown;
}

// An owner allowlists a URL; the chain only understands addresses. This is where one becomes
// the other, and every reason it can fail is one the owner can act on.
export function pickOffer(
  url: string,
  requirements: { accepts?: unknown },
  want: { network: string; asset: string } = { network: NETWORK_ID, asset: USDC_SAC },
): Resolution {
  const accepts = Array.isArray(requirements.accepts) ? (requirements.accepts as Accepts[]) : [];
  if (accepts.length === 0) return { ok: false, reason: 'this URL does not ask for payment' };

  const payable = accepts.find(
    (offer) => offer.network === want.network && offer.asset === want.asset && offer.payTo,
  );
  if (!payable) {
    const networks = accepts.some((offer) => offer.network === want.network);
    return {
      ok: false,
      reason: networks ? 'it does not take USDC on testnet' : 'it does not take Stellar testnet',
    };
  }

  const { pathname, host } = new URL(url);
  return {
    ok: true,
    offer: {
      url,
      host,
      path: pathname,
      amount: BigInt(String(payable.amount ?? 0)),
      asset: String(payable.asset),
      payTo: String(payable.payTo),
      network: String(payable.network),
    },
  };
}
