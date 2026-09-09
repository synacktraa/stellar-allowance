# Stellar Allowance

On-chain spending limits for AI agents that pay for API calls.

An owner deploys a contract that holds the money and sets the rules. The agent gets a key that
can ask the contract to pay, and the contract refuses anything outside those rules before any
tokens move.

> Unaudited, and built for testnet. Do not put mainnet funds behind it.

## See it work

[stellar-allowance.vercel.app](https://stellar-allowance.vercel.app) runs a full payment on
testnet in about two minutes and needs no wallet. It funds an owner, deploys an allowance, pays a
live x402 API, and shows two payments refused on chain.

## Give an agent an allowance

Create one at [the dashboard](https://stellar-allowance.vercel.app/dashboard) with Freighter. It
hands you two values, which are all the agent needs.

```bash
npm i @stellar-allowance/sdk
```

```ts
import { Allowance } from '@stellar-allowance/sdk';

const { fetch } = new Allowance();
const response = await fetch('https://api.example.com/paid');
```

```
STELLAR_ALLOWANCE_ID=C...        which allowance pays
STELLAR_ALLOWANCE_SECRET=S...    proof it may ask
```

`fetch` is the ordinary fetch with a 402 handled in the middle. Same arguments, same `Response`
back, and a URL that never asks for payment passes straight through.

## The repository

Two flows, one contract between them. The owner creates an allowance and can change its rules,
top it up, empty it or pause it. The agent can request a payment and nothing else: it cannot
change a rule, pay anyone off the list, or take money out.

![A map in two lanes, both ending at one contract. Creating and managing: the owner signs with
Freighter through the interface in web/, which deploys the allowance and sets its rules. Paying:
the agent uses the SDK to pay an x402 seller, a facilitator submits that payment, and the
allowance checks it before it moves.](assets/system.svg)

| | |
|---|---|
| [`contracts/allowance`](contracts/allowance) | the Soroban contract, and the design: `__check_auth`, the allowlist, the rolling window, storage and TTL |
| [`sdk`](sdk) | [`@stellar-allowance/sdk`](https://www.npmjs.com/package/@stellar-allowance/sdk) |
| [`web`](web) | the site and the dashboard |
| [`demo/seller`](demo/seller) | a live x402 API for the demo to pay |
| [`docs`](docs) | why each decision was made, dated, including the ones that turned out wrong |

Apache 2.0. Built by [synacktraa](https://github.com/synacktraa).
