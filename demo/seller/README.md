# A paid API

An x402 API that sells one number: the live XLM/USDC mid price from the Stellar DEX. It
answers 402 until it is paid and 200 once it is.

Live at [xlm-quote-api.vercel.app/api/quote](https://xlm-quote-api.vercel.app/api/quote).

```bash
curl -i https://xlm-quote-api.vercel.app/api/quote
```

```
HTTP/1.1 402 Payment Required
payment-required: eyJ4NDAyVmVyc2lvbiI6Miwi...
```

The requirements are in the `payment-required` header. x402 v2 puts them there; the JSON body
is the v1 form. Decoded, that header asks for 100000 stroops of USDC on `stellar:testnet`.

Paid, it answers:

```json
{
  "pair": "XLM/USDC",
  "bid": 0.1908358,
  "ask": 0.1909939,
  "mid": 0.1909148,
  "source": "Stellar DEX, horizon.stellar.org",
  "at": "2026-09-07T09:47:42.070Z"
}
```

The quote is real. Payments settle on testnet because the allowance contract is unaudited, and
the number being sold is the live book on the public network.

## Why it exists

It gives [Stellar Allowance](../../README.md) something to pay that is not itself. The client
under test is ours; the server here is `@x402/stellar`'s own reference implementation, and the
facilitator that verifies and settles is OpenZeppelin's. A payment that lands proves the three
work together.

## How it is built

`withX402` wraps the route handler rather than proxying it, so settlement happens only after
the handler returns under 400. When the order book is unavailable the handler answers 503 and
the caller is not charged.

`SELLER_PAYOUT_ADDRESS` is a public address. This server receives and never signs: the
facilitator submits the transaction and pays the fee, so no Stellar secret key exists in the
deployment.

The `areFeesSponsored` flag in the 402 comes from the facilitator's `/supported`, not from
configuration here. With a bad facilitator key the route returns 500 rather than a 402, so a
facilitator outage takes the endpoint down rather than degrading it.

## Running it

```bash
npm install
npm run dev
```

Three environment variables, in `.env.local`:

```
FACILITATOR_URL        https://channels.openzeppelin.com/x402/testnet
FACILITATOR_API_KEY    from https://channels.openzeppelin.com/testnet/gen
SELLER_PAYOUT_ADDRESS  a funded testnet account with a USDC trustline
```

The payout account needs the trustline before the first payment. An account cannot receive an
asset it has no trustline for, and it will not have a balance to give the omission away.

## CORS

The 402 carries no `access-control-allow-origin`, so a browser cannot read it cross-origin.
This does not affect an agent, which has no origin. It does mean a browser-based interface
cannot inspect a stranger's 402 and needs the address entered by hand.

Not affiliated with the Stellar Development Foundation.
