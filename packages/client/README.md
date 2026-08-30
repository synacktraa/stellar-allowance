# @stellar-allowance/client

Let an AI agent pay for API calls without giving it your wallet.

The agent gets a secret key that **holds no money and cannot move any**. It can only ask an
allowance contract to pay, and the contract checks every request against rules you set: who may be
paid, how fast, how much. A stolen key reaches nothing — and neither does a prompt telling your
agent to pay somebody you never approved.

```bash
npm i @stellar-allowance/client
```

```js
import { Allowance } from '@stellar-allowance/client';

const allowance = new Allowance();   // reads STELLAR_ALLOWANCE_SECRET

const res = await allowance.fetch('https://…/api/pay/abc123?text=hello');
const data = await res.json();
```

**No configuration.** There is no contract id to set — the allowance is found from the agent's own
key, and the network, the RPC and the limits come from whichever gateway issued the URL.

Pass the key directly if you would rather not use the environment:

```js
new Allowance(mySecret);
```

## It is `fetch`

Same arguments, same `Response` back. A URL that never asks for payment is passed straight
through, and nothing is signed.

```js
await allowance.fetch(url);                                    // GET
await allowance.fetch(url, { method: 'POST', body });          // POST
await allowance.fetch(url, { method: 'DELETE' });              // anything else
```

```js
res.ok · res.status · res.headers · res.json() · res.text()    // a real Response
```

## When your rules say no

A refusal is not an HTTP error. It is your own contract declining, and the useful part is *which*
rule stopped it.

```js
import { Allowance, AllowanceRefused } from '@stellar-allowance/client';

try {
  await allowance.fetch(url);
} catch (error) {
  if (error instanceof AllowanceRefused) {
    console.error(error.rule, '—', error.message);
  }
}
```

| `error.rule` | what happened |
|---|---|
| `allowlist` | asked to pay somebody the owner never approved |
| `rate-limit` | over the cap for the current window |
| `per-call` | one call worth more than the rate limit allows |
| `empty` | the allowance has no credits left |
| `stopped` | the owner stopped it |

**`allowlist` is the one worth catching by name.** That is an agent being told — by a prompt, a
poisoned search result, a compromised tool — to send money somewhere unvetted, and being refused
by the network rather than by its own good judgement.

Nothing moves when a rule refuses. The check runs during simulation, so no transaction is ever
submitted and no fee is paid.

## Bodies have to be replayable

Answering a 402 means sending the same request **twice** — once to be told the price, once with the
payment. So a body must be something that can be sent again: a string, a `Buffer`, a typed array.

A `ReadableStream` reads once and is refused with an explanation rather than half-sent. A `Request`
object is refused for the same reason.

Oversized bodies are refused **before** anything is paid for, against the limit the gateway
publishes.

## Options

Both optional. The default is to derive everything from the URL.

```js
new Allowance(secret, {
  contractId: 'C…',   // skip the lookup — self-hosted gateway, or already known
  rpcUrl: 'https://…' // override the RPC the gateway names
});
```

## What the agent needs

- **`STELLAR_ALLOWANCE_SECRET`** — its key, `S…`, given to you once when the allowance was created
- **a little XLM** in the agent's own account, for transaction fees. Not money it can spend; its
  owner tops this up. Running out looks like a refusal, so check it first when calls stop working.

## Testnet

Unaudited, and built for testnet. Do not put mainnet funds behind it.

A community project. Not affiliated with the Stellar Development Foundation.

[Source](https://github.com/synacktraa/stellar-allowance) · Apache-2.0
