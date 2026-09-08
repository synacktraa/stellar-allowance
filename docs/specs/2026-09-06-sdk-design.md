# SDK design

**Status:** implemented in [#15](https://github.com/synacktraa/stellar-allowance/pull/15),
merged 2026-09-08. The public surface shipped as described here. "How a payment flows" did
not: steps 3 to 5 read the auth entries out of a simulation and sign them afterwards, and the
outcome on [the SDK plan](../plans/2026-09-06-sdk.md#outcome) records why that order fails.
The two upstream issues in the last section are still unfiled.

Directory `sdk/`, published as `@stellar-allowance/sdk`. Not `client`: there is no
Stellar Allowance server for it to be a client of.

## What it does, and what it inherits

Three packages published on 2026-09-04 already implement x402 on Stellar:

| | |
|---|---|
| `@x402/core` | `x402Client`, payment policies, spend controls |
| `@x402/stellar` | `ExactStellarScheme`, `ClientStellarSigner`, the network helpers |
| `@x402/fetch` | the fetch wrapper |

`@x402/stellar` takes a signer by interface, and its `ClientStellarSigner` documents support
for "both classic (G) and contract (C) accounts", with `signTransaction` optional because a
contract client submits nothing. The type is right. The path behind it does not run.

**Measured 2026-09-06 against `@x402/stellar` 2.25.0 and `@stellar/stellar-sdk` 16.3.0.**
`ExactStellarScheme` signs through `AssembledTransaction.signAuthEntries`, which wraps the
signer callback so it always resolves to raw signature bytes, and passes those to
`authorizeEntry`. `authorizeEntry` reads the address off the auth entry and calls
`Keypair.fromPublicKey` on it, an ed25519 account constructor:

```
raw 64 bytes, C address -> Error: invalid version byte. expected 48, got 16
raw 64 bytes, G address -> ok, signature scval type: scvVec
```

48 is the version byte for `G`, 16 for `C`. Every contract account fails there, before a rule
of this project is reached at all.

One return shape does work. A signer callback that resolves to `{ signatureScVal }` skips the
account branch and writes the value straight into the credentials:

```
{ signatureScVal }, C address -> ok, signature scval type: scvBytes len: 64
```

`scvBytes` of 64 is what `__check_auth` declares as its `Signature`. But `signAuthEntries`
base64-decodes its callback result into a `Buffer` before `authorizeEntry` sees it, so that
shape cannot be returned through `ExactStellarScheme`.

**So this package builds the payload itself** and calls `authorizeEntry` directly. That is one
class implementing `SchemeNetworkClient`, which is `scheme`, `createPaymentPayload` and an
optional `findDefaultAsset`. Selection, policies, the 402 handling and the fetch wrapper are
still inherited, and so are the Stellar helpers `@x402/stellar` exports:
`getNetworkPassphrase`, `getRpcUrl`, `getRpcClient`, `getEstimatedLedgerCloseTimeSeconds`,
`handleSimulationResult`, `convertToTokenAmount` and the address validators.

**An allowance is the signer.** That is still the whole of what is new. It costs one more class
than planned because the seam upstream left for it is one layer higher than its own types
suggest.

## The credential pair

An agent is configured with two values and derives nothing at runtime:

```
STELLAR_ALLOWANCE_ID=C...        which allowance pays
STELLAR_ALLOWANCE_SECRET=S...    proof it may ask
```

The names describe the pair rather than the material. `STELLAR_ALLOWANCE_SECRET` holds the
agent's ed25519 secret seed, so `AGENT_SECRET_KEY` would be the more exact description of the
bytes. It would also break the pair: two variables sharing a prefix read as one credential, and
two that do not read as two unrelated settings. An agent holds one key and pays from one
allowance, so there is nothing the exact name would disambiguate.

The shape is `client_id` and `client_secret`, with three differences worth stating in the
README because they are the argument for the product:

- A stolen secret can pay allowlisted addresses up to the window cap and nothing else. The
  blast radius is a number the owner set, enforced on chain.
- There is no issuer. Nobody minted the pair, and revocation is `disable()`, signed by the
  owner.
- The public half is readable. Anyone can look up the contract and see its rules and what it
  has spent.

Where the analogy fails: **the secret cannot be rotated.** `agent_key` is fixed by the
constructor, so a lost secret means withdrawing and creating a new allowance. That belongs in
the interface at the moment the secret is shown, not only in documentation.

## Why two values rather than one

The address is `hash(networkId, deployer, salt)`. For an agent to compute it from its own key,
the key must be an input to that hash, which means either the agent is the deployer or the salt
is keyed on the agent. Both were tested and closed:

- **Agent as deployer** requires the agent's account to exist. Measured on testnet: an unfunded
  address fails with `Error(Auth, InvalidAction)`, `"trying to get non-existing value for
  account"`, and the same code succeeds once friendbot has funded it. Creating the account is a
  second transaction, because a Soroban transaction carries only its one host-function
  operation. Two prompts to create an allowance, which is a regression against a property the
  product already shipped.
- **Salt keyed on the agent** requires a constant deployer, which is a factory, which was
  dropped for reasons in `2026-09-06-no-factory.md`.

A contract generating the agent key does not help either. Contract storage is public and the
SDK's own PRNG documentation says it is "unsuitable for generating secrets", so a
contract-generated secret is public the moment it exists. And the address is fixed before the
constructor runs, so nothing a contract produces can feed back into where that contract is.

The general rule: to find something from a secret, the secret has to be an input to that
thing's identity. Two values is the floor.

## Public surface

The package serves two readers, and they share nothing. The agent's half never needs the
owner. The interface's half never needs the secret.

### For an agent

```ts
import { Allowance } from '@stellar-allowance/sdk';

const allowance = new Allowance();          // reads the environment
const res = await allowance.fetch('https://api.example.com/paid');
```

```
STELLAR_ALLOWANCE_ID=C...        which allowance pays
STELLAR_ALLOWANCE_SECRET=S...    proof it may ask
```

A class rather than two functions because `fetch` and `signer` take the same two values, and
constructing them separately means passing the same pair twice. `new Allowance({ id, secret })`
overrides the environment for anyone holding more than one.

`allowance.fetch` is the ordinary fetch with a 402 handled in the middle. Same arguments, same
`Response` back, and a URL that never asks for payment passes through untouched. It is bound in
the constructor so it survives being pulled off the instance:

```ts
const { fetch } = new Allowance();
```

`allowance.signer` is the `ClientStellarSigner` that `fetch` is built on, for anyone wiring
`x402Client` themselves rather than taking the composed version.

### For an interface

```ts
import { deriveAllowanceAddress } from '@stellar-allowance/sdk';

const address = deriveAllowanceAddress({ owner, index: 0 });
```

Pure computation. No network, no secret, no instance. Exported because a dashboard has to
compute these addresses, and the alternative is every dashboard reimplementing a contract ID
preimage hash, which is how the no-database design stops being something others can build on.

It stays out of the README's narrative, which is written for the agent's reader. It belongs in
the reference documentation instead: present, easy to find, and not competing for attention
with the thing most readers came for.

**`AllowanceRefused`** carries a `rule`, as the previous package did. The discriminants moved:
the contract now numbers its errors from 101, clear of the Stellar Asset Contract's 1 to 13.

Options are objects rather than positional. Every argument is a string, and `(owner, index)` or
`(id, secret)` are pairs a caller can swap without a type error.

## How a payment flows

1. The seller answers a request with 402 and a set of payment requirements.
2. `@x402/fetch` hands them to `x402Client`, which selects one and asks the registered scheme
   for a payload.
3. The scheme builds the `transfer(from, to, amount)` invocation against the token contract,
   with `from` set to the allowance, and simulates it to get the authorization entries.
4. `authorizeEntry` runs over each entry the allowance owns. It sets the expiration ledger,
   builds the `HashIdPreimage` from the network id, the nonce, the expiration and the whole
   invocation tree, and hands back the 32-byte hash of it.
5. The agent's ed25519 key signs those 32 bytes, and the signature goes into the credentials as
   `scvBytes`.
6. The signed transaction goes back in the payment header. The seller's facilitator submits it
   and pays the fee, so the agent needs no XLM.
7. The token calls `require_auth` on `from`. `from` is a contract, so the host calls
   `__check_auth` on the allowance, which checks the asset, the recipient and the window before
   anything moves.

Steps 1, 2, 6 and 7 are inherited or on chain. Steps 3 through 5 are this package.

A signature over that payload cannot be replayed onto a different call, a different network or
a second time, because all three are inputs to the hash. It is never transmitted: the host
rebuilds it from the transaction and compares.

## Refusals

The contract's discriminants map to rules a caller might reasonably branch on:

| code | error | rule |
|---|---|---|
| 101 | `NotInitialized` | `not-set-up` |
| 102 | `RecipientNotAllowed` | `allowlist` |
| 103 | `MalformedCall` | `malformed` |
| 104 | `WrongAsset` | `wrong-asset` |
| 105 | `NotATransfer` | `not-a-transfer` |
| 106 | `ExceedsWindow` | `window` |
| 107 | `Disabled` | `stopped` |
| 108 | `InvalidAmount` | `invalid-amount` |
| 109 | `NameTooLong` | `name-too-long` |

`allowlist`, `window` and `stopped` are the three an agent might act on. The rest indicate a
malformed request or an allowance that was never set up.

The code is parsed rather than substring-matched. The previous package documented why:
`/#1/.test(detail)` matches inside `#10`, and now inside `#101` through `#109` as well,
reporting the wrong rule with complete confidence.

## Testing

Node's own test runner over `.mjs` files, as the previous package used. No new tooling.

The parts that need no network are the parts worth testing hardest, and they are exported for
that reason:

- **Derivation.** `deriveAllowanceAddress` against fixtures from `stellar contract id wasm`,
  so the preimage is checked against SDF's own Rust implementation rather than against itself.
- **Refusal parsing.** Every discriminant, plus the `#1` inside `#101` case that the naive
  regex gets wrong.
- **Signing.** The signer produces a `signatureScVal` of 64 bytes that `ed25519_verify` accepts
  over the payload hash, checked with the Stellar SDK's own `Keypair.verify`, no RPC.
- **The scheme's signing step.** `authorizeEntry` is called with a hand-built auth entry for a
  C address, which is how the upstream break above was found. This test is the regression guard
  for it, and it fails the day the copied scheme can be deleted.

One end-to-end test against testnet, run by hand rather than in CI, since it needs a funded
account, a deployed allowance and a live facilitator.

## Not in this package

No allowance creation. That is the web interface's job, because it needs Freighter.

No agent key generation. The interface generates the keypair and displays the secret once.

No enumeration. The interface probes; the SDK is handed a contract id.

No spend controls of its own. `@x402/core` offers client-side ones, and a rule the agent could
ignore does not belong in an agent. The window and the allowlist are on chain.

## Upstream

Two issues to file against `x402-foundation/x402`, both from the measurement above.

`AssembledTransaction.signAuthEntries` should forward a `{ signatureScVal }` result from its
callback instead of base64-decoding every result to a `Buffer`. `authorizeEntry` already
accepts that shape; only the wrapper drops it. That belongs in `@stellar/stellar-sdk`.

`ExactStellarScheme` should accept an `authorizeEntry` override, which `signAuthEntries`
already takes as an option. Either fix makes the copied scheme here deletable.
