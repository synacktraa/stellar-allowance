import { NextRequest, NextResponse } from 'next/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { withX402, x402ResourceServer } from '@x402/next';
import { ExactStellarScheme } from '@x402/stellar/exact/server';

const NETWORK = 'stellar:testnet';

// The payout address is public: this server only ever receives. It signs nothing, and the
// facilitator is what submits the transaction and pays the fee.
const PAY_TO = process.env.SELLER_PAYOUT_ADDRESS!;

// The quote is real. Payments settle on testnet because the allowance contract is unaudited,
// but the number being sold is the live XLM/USDC book on the public network.
const USDC_MAINNET_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ORDER_BOOK =
  'https://horizon.stellar.org/order_book' +
  '?selling_asset_type=native' +
  '&buying_asset_type=credit_alphanum4&buying_asset_code=USDC' +
  `&buying_asset_issuer=${USDC_MAINNET_ISSUER}&limit=1`;

const facilitator = new HTTPFacilitatorClient({
  url: process.env.FACILITATOR_URL!,
  // Keyed by path. A flat headers object throws rather than silently sending no auth.
  createAuthHeaders: async () => {
    const headers = { Authorization: `Bearer ${process.env.FACILITATOR_API_KEY}` };
    return { verify: headers, settle: headers, supported: headers };
  },
});

const server = new x402ResourceServer(facilitator).register(NETWORK, new ExactStellarScheme());

type Quote = {
  pair: string;
  bid: number;
  ask: number;
  mid: number;
  source: string;
  at: string;
};

type Unavailable = { error: string };

const handler = async (_request: NextRequest): Promise<NextResponse<Quote | Unavailable>> => {
  const response = await fetch(ORDER_BOOK, { cache: 'no-store' });
  if (!response.ok) {
    // Under 400 is what settles a payment, so an upstream failure is not charged for.
    return NextResponse.json({ error: 'the order book is unavailable' }, { status: 503 });
  }

  const book = await response.json();
  const bid = Number(book.bids?.[0]?.price);
  const ask = Number(book.asks?.[0]?.price);
  if (!bid || !ask) {
    return NextResponse.json({ error: 'the order book is empty' }, { status: 503 });
  }

  return NextResponse.json({
    pair: 'XLM/USDC',
    bid,
    ask,
    mid: Number(((bid + ask) / 2).toFixed(7)),
    source: 'Stellar DEX, horizon.stellar.org',
    at: new Date().toISOString(),
  });
};

// withX402 rather than paymentProxy: it settles only after the handler returns under 400, so
// the 503 above costs the caller nothing.
export const GET = withX402(
  handler,
  {
    '/api/quote': {
      accepts: { scheme: 'exact', network: NETWORK, price: '$0.01', payTo: PAY_TO },
      description: 'The live XLM/USDC mid price from the Stellar DEX',
    },
  },
  server,
);
