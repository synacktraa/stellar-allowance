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
const paid = withX402(
  handler,
  {
    '/api/quote': {
      accepts: { scheme: 'exact', network: NETWORK, price: '$0.01', payTo: PAY_TO },
      description: 'The live XLM/USDC mid price from the Stellar DEX',
    },
  },
  server,
);

/**
 * What a browser has to be told before it will let a page read this.
 *
 * x402 carries everything that matters in headers, and a browser hides those from script
 * unless they are named here: the terms arrive on the 402 and the receipt on the paid 200, so
 * a page without `Expose-Headers` gets a response it can see and terms it cannot read. The
 * request carries a custom header too, which makes it preflighted rather than simple.
 *
 * Any origin, because the terms are public. Anyone can already read them with curl, and an
 * x402 seller exists to be found and paid.
 */
const EXPOSED = 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE';

function allow(request: NextRequest): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    // Echoed rather than listed: the payment header names belong to x402 and change with it,
    // and a preflight that names them is a preflight that goes stale.
    'Access-Control-Allow-Headers':
      request.headers.get('access-control-request-headers') ??
      'content-type, PAYMENT-SIGNATURE, X-PAYMENT',
    'Access-Control-Expose-Headers': EXPOSED,
    'Access-Control-Max-Age': '86400',
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const response = await paid(request);
  for (const [name, value] of Object.entries(allow(request))) response.headers.set(name, value);
  return response;
}

export function OPTIONS(request: NextRequest): Response {
  return new Response(null, { status: 204, headers: allow(request) });
}
