# Agent identity: the key, not the account

**Status:** current. Draft for the unwritten `architecture.md`.

Explains why the contract stores a raw public key rather than an address, and why the web app
is nonetheless allowed to turn that key back into one.

## The two things an agent needs

An agent does two unrelated jobs, and it is worth keeping them apart in your head:

1. **It signs payment payloads.** The contract's `__check_auth` hands 32 bytes to
   `ed25519_verify`. That function knows nothing about accounts, balances or signers - it
   checks a signature against raw key bytes and nothing else.
2. **It submits transactions.** Only a Stellar *account* can do that, and only an account
   can hold the XLM the fees are paid from. A contract cannot submit a transaction, which
   is why a lapsed allowance can never revive itself - see `rent-and-revival.md`.

The contract only cares about (1). The owner only cares about (2) - they need somewhere to
send fee money. The question is whether one can be derived from the other.

## They are the same bytes

A `G...` address and an ed25519 public key are not two related values. They are **one
32-byte value in two wrappings**. StrKey is packaging:

```
raw key:  1c 4a … 7f                                (32 bytes)
StrKey:   [version byte][same 32 bytes][CRC16]       base32 →  "GBXY…4K7F"
```

So `StrKey.encodeEd25519PublicKey(key)` is a format change, like writing a phone number
with dashes. No lookup, no network call, no way to return the wrong bytes.

**The hazard is never in the conversion. It is in what you conclude from it.**

## The signature card

Imagine a bank that mints your account number *from your signature* the day you open the
account.

- Day one, the card in the drawer lists exactly one authorized signature: yours. The
  account number was computed from it.
- Later you can change the card - add a co-signer, or **strike your own name off entirely**.
- The account number never changes when you do.

That is a Stellar account. `create_account` gives the new account a **master key**, and the
master key *is* the key the address was derived from. `set_options` with `masterWeight: 0`
strikes it off the signer list while the address stays exactly as it was.

An address therefore records who could sign **on day one**. It is a fossil, not a live
reading.

## The direction asymmetry

| | You have | You compute | Sound? |
|---|---|---|---|
| **Forward** | the key | the address | **yes** |
| **Backward** | the address | the key | **no** |

### Forward is sound, and the reason is one-way

The account at `G(K)` is born with `K` as its master key. Changing the signers on it needs
a transaction signed by its *current* signers - which at birth is `K` alone. So the only
route from *"K controls this account"* to *"K does not"* runs **through K's own holder**.

Nobody can take the account away from outside. A stranger may `create_account` it and fund
it, but that is a gift, not a takeover: they still cannot touch the signer list.

### Backward is reading the fossil as if it were live

If the account has struck its master key off the card, verifying signatures against the
address's bytes accepts a key with **no authority over that account** and rejects the real
signers. This is verbatim the Rust SDK's own warning on `Address::to_payload`, which is why
that method sits behind the `hazmat-address` feature flag:

> the returned Ed25519 public key corresponds to the account's master key, which depending
> on the configuration of that account may or may not be a signer of the account. Do not
> use this for custom Ed25519 signature verification as a form of authentication

There is a second backward failure. A `C...` contract address also decodes to 32 bytes, but
those bytes are a **hash of code**. No private key for them exists anywhere. The Rust SDK
returns a typed `AddressPayload::ContractIdHash` so the mistake is hard to make there -
hand-decoding StrKey in JavaScript, it is easy.

## Where each direction lives here

- **The contract never converts.** It stores `agent_key` as `BytesN<32>` and passes it
  straight to `ed25519_verify`. The backward direction does not occur. *This is the reason
  the stored value is a key and not an `Address`* - storing an address would put the
  hazardous conversion in the one place that decides whether money moves.
- **The web app converts forward only.** It reads `agent_key` from the contract and encodes
  it to get somewhere to send fee money. Worst case if that were wrong: XLM lands somewhere
  useless. Nobody gains the ability to spend the allowance.

## What remains an assumption

Not a cryptographic one, a **product** one: the agent signs payment payloads and submits
transactions with the same keypair.

An agent that signed with one key and submitted from a different account would receive its
fee money at the wrong address - a support ticket, not a theft. The convention is enforced
by there being no way to express anything else: the constructor takes a key and no address,
so there is no second value that can disagree with the first.

## What this decided

The constructor originally took `native_address` and an `agent_address` and forwarded XLM
to the agent at deployment, so that creating an allowance was one signature. That is gone.

- The contract never touches the native asset, and stores no address for the agent.
- The owner funds the agent as an ordinary payment, from the app.
- The first top-up cannot be a plain `payment`: a brand-new agent account does not exist
  yet, and a payment to an unfunded address fails with `op_no_destination`. It has to be
  `create_account` with at least the base reserve. **A contract could never have done this
  correctly** - `create_account` is not an operation a contract can emit - so the old
  constructor would have failed silently for exactly the fresh agent it was meant to fund.

The UX cost is a second signature at setup. The app covers it by opening the edit overlay
immediately after creation, where the owner reviews the allowance and funds the agent, with
the address derived from the key the contract already holds.
