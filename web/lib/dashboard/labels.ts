import type { Offer } from '../x402/offer';

// The chain stores payout addresses. It has never heard of a URL, and never will: a contract
// cannot fetch one, so a URL could only ever be checked by software an attacker might influence.
// The addresses are the guarantee; these labels are a convenience, kept in this browser so the
// table can say xlm-quote-api.vercel.app instead of GA4N…XJWV.
//
// A label that is missing costs nothing. The row falls back to the address, which is the thing
// that was actually enforced.

const KEY = 'stellar-allowance:labels';

export interface Label {
  url: string;
  host: string;
  path: string;
  amount: string;
}

type Labels = Record<string, Label>;

const read = (): Labels => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Labels;
  } catch {
    return {};
  }
};

export const labelsFor = (addresses: string[]): Record<string, Label | undefined> => {
  const all = read();
  return Object.fromEntries(addresses.map((address) => [address, all[address]]));
};

export function remember(offer: Offer): void {
  try {
    const all = read();
    all[offer.payTo] = {
      url: offer.url,
      host: offer.host,
      path: offer.path,
      amount: String(offer.amount),
    };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // A browser that refuses storage loses the labels and keeps the addresses. Nothing breaks.
  }
}
