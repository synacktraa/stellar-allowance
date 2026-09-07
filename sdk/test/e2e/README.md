# Live payment fixtures

Testnet. Public halves only: every secret lives in `.env.local`, which is gitignored.

Run by hand, not in CI. Plan: `docs/plans/2026-09-07-live-payment.md`.

## Accounts

| | address | |
|---|---|---|
| owner | `GDNP2DRYJGJ5XJJR6MVATHXZISCAL5IGWWYQ26NBD5G6VC6H57JU2UB5` | funded, 10000 XLM |
| seller payout | `GA4ND56VAGBNNSAEAKS2KYW6OZTUTOQ6MVLSQEXW4PV35LXUH3VTXJWV` | funded, 10000 XLM |
| agent | `GC2H2DNYHJJTTCCRO3HMSYE2RJISXD2NNZCI4IXQ6ZXDYJG6FSIJ5ZD7` | not an account |

The owner and the seller are CLI identities `e2e-owner` and `e2e-seller`.

The agent is a keypair, not an account. Horizon returns 404 for it, which is correct: it never
submits a transaction and never holds a balance. It only signs auth payloads, and what the
contract stores is the raw public key rather than the address:

```
agent_key = b47d0db83a5339885176cec9609a8a512b8f4d6e448e22f0f66e3c24de2c909e
```

An address can have its master key removed from its signers while keeping the same address, so
an address is no evidence of who holds a key. The 32 bytes are.

## Token

`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, the Stellar Asset Contract for
`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.

## Facilitator

`https://channels.openzeppelin.com/x402/testnet`, run by OpenZeppelin. Its `/supported` returns
one kind: `stellar:testnet`, scheme `exact`, x402Version 2, `areFeesSponsored: true`. Its
signer is `GCNJB6V5YIODDSSCWXZ2VOKMRPRVZ2V723RRQS6STXE6NWTGVOJY35CN`.

Keys come from `https://channels.openzeppelin.com/testnet/gen` and go in the `Authorization:
Bearer` header. `x-api-key` is rejected.

## Still to fill in

- allowance address
- seller URL
- the successful payment's transaction hash
- the three refusals, with the host messages they actually produced
