# @stellar-allowance/sdk

Pay x402 APIs from an allowance, with the limits enforced on chain.

```bash
npm i @stellar-allowance/sdk
```

```ts
import { Allowance } from '@stellar-allowance/sdk';

const { fetch } = new Allowance();
const response = await fetch('https://api.example.com/paid');
```

Two environment variables:

```
STELLAR_ALLOWANCE_ID=C...        which allowance pays
STELLAR_ALLOWANCE_SECRET=S...    proof it may ask
```

`fetch` is the ordinary fetch with a 402 handled in the middle. Same arguments, same `Response`
back, any method, and a URL that never asks for payment passes straight through. A request that
is paid for is sent twice, once to receive the 402 and once with the payment, and the body is
replayed on the second attempt.

## The pair is an id and a secret

It reads like a client id and client secret, and it differs in three ways worth knowing before
you put it in a `.env` file.

A stolen secret can pay allowlisted addresses up to the window cap and nothing else. The blast
radius is a number the owner set, enforced on chain rather than by this library.

There is no issuer. Nobody minted the pair, and revocation is `disable()`, signed by the owner.

The public half is readable. Anyone can look up the allowance and see its rules and what it has
spent.

**The secret cannot be rotated.** The agent's key is fixed when the allowance is created, so a
lost secret means withdrawing and creating a new allowance.

## When the allowance refuses

`AllowanceRefused` carries the rule that refused, read out of the contract's error:

| rule | |
|---|---|
| `allowlist` | the recipient is not one the owner approved |
| `window` | more than the rolling cap still allows |
| `stopped` | the owner has stopped this allowance |
| `not-set-up` | nothing is deployed at that address |
| `wrong-asset`, `not-a-transfer`, `malformed`, `invalid-amount` | the request is not a payment this allowance recognizes |

The first three are the ones an agent might act on.

```ts
import { Allowance, AllowanceRefused } from '@stellar-allowance/sdk';

const { fetch } = new Allowance();

try {
  const response = await fetch('https://api.example.com/paid');
  return await response.json();
} catch (error) {
  if (error instanceof AllowanceRefused && error.rule === 'window') {
    return cached;
  }
  throw error;
}
```

## Options

`new Allowance()` reads the environment. Pass values instead for a process holding more than
one allowance:

```ts
new Allowance({ id, secret });
```

The scheme is registered for one network, named by the caller and defaulting to
`stellar:testnet`. A seller asking for a different network is refused at selection, so which
chain an agent pays on is not something a 402 response decides.

```ts
new Allowance({ network: 'stellar:pubnet', rpc: { url } });
```

Mainnet needs `rpc.url`. SDF runs a public RPC for testnet and futurenet but not for
mainnet, so `@x402/stellar` has no default to fall back on. Third party providers are listed
at developers.stellar.org under Data / RPC / Providers.

`allowance.scheme` is the payment scheme, for registering on an `x402Client` of your own
instead of using `fetch`.

## Protocol version

x402 v2. The payment requirements arrive in the `Payment-Required` header rather than the
response body, which is where v1 put them.

A v1 402 is refused with `No client registered for x402 version: 1`. Stellar x402 starts at v2:
`@x402/stellar` ships no v1 implementation, v1 defines no Stellar network identifier, and the
facilitators running today advertise v2 only.

## What this package adds

`@x402/core`, `@x402/stellar` and `@x402/fetch` already implement x402 on Stellar. Selection,
policies, the 402 handling and the fetch wrapper come from them unchanged.

What they do not do is pay from a contract. `ClientStellarSigner` documents support for "both
classic (G) and contract (C) accounts", and the path behind it stops at
`Keypair.fromPublicKey`, which is an ed25519 account constructor:

```
raw 64 bytes, C address    -> Error: invalid version byte. expected 48, got 16
raw 64 bytes, G address    -> ok, signature scval type: scvVec
{ signatureScVal }, C addr -> ok, signature scval type: scvBytes len: 64
```

48 is the version byte for `G`, 16 for `C`. The third line is the route a custom account needs,
and it cannot be reached through `ExactStellarScheme`, so this package builds the payment
payload itself and signs the auth entry directly.

There is a second ordering constraint underneath. Simulation runs in one of two modes: with no
auth entries present it records what would be needed and verifies nothing, and with entries
present it enforces them. So the entry has to be signed, and in the transaction, before the
simulation that is supposed to check it. Signing it afterwards leaves an entry the host
enforces against a signature nobody wrote.

`x402Client`'s spend controls are off. They default to USDC only and $1 a payment, and an
allowance already holds one token the owner chose and one cap the owner set, both enforced by
the contract.

## Testing

```bash
npm test
```

29 tests, none of which touch the network. Node's own test runner, over the built output, so
what runs is what ships.

### The live payment

The end to end test is separate. It spends on testnet, depends on two live third parties, and
the allowance's own window cap would exhaust under a per-commit loop, so it never runs in CI.

```bash
npm run e2e:setup
npm run e2e
```

Setup creates fixtures that belong to whoever runs it: no funded address is shared. It creates
an owner account funded by friendbot, a USDC balance swapped from XLM on the testnet DEX, an
agent keypair, and an allowance deployed at the first free index. Every step checks whether it
is already done, so an interrupted run resumes.

Nothing here configures a facilitator. That belongs to the seller, which is the side that calls
it to verify and settle; a client only builds the payment and sends it in a header.

It reads the seller's 402 to learn which address to allowlist and which asset to hold, rather
than being told:

```bash
E2E_PAID_URL=https://xlm-quote-api.vercel.app/api/quote npm run e2e:setup
```

Setup asserts that the address the network deploys to is the address `deriveAllowanceAddress`
computed beforehand, and stops if they differ.

A successful run:

```
status 200
{"pair":"XLM/USDC","bid":0.1917265,"ask":0.1918408,"mid":0.1917836, ...}

settled by the facilitator
  success     true
  transaction 574370730f5f1616f56beec3b99c6714a1325aea8065e195fa8959a90e7c69a5
  payer       CD7MXKE263USEVT7ECVUAFH2PSDTHVKRNWHUOF5AQZNDNAVXWO43T4TC
```

The payer is the allowance contract. The agent's key holds no funds, pays no fee, and is never
a transaction source. The fee was paid by the facilitator.

`npm run e2e:refusals` proves each rule refuses, by changing the allowance rather than the
seller: an allowlist without the seller in it, a window cap below the price, and a disabled
allowance. Each case restores what it changed. Run it from a clean allowance, since it treats
whatever it finds as the state to restore to.

Everything setup writes lands in `test/e2e/.env.local`, which is gitignored. Secrets are never
printed.

## Testnet

The allowance contract is unaudited and built for testnet. Do not put mainnet funds behind it.

Not affiliated with the Stellar Development Foundation.
