# Docs

The rebuild started on 2026-09-04 with an empty tree, and everything here was written while it
was happening rather than afterwards. The dates in the filenames are the dates the decisions
were made.

Nothing has been rewritten to look better in hindsight. Where a plan turned out to be wrong it
still says what it said, and an **Outcome** at the top says what happened instead.

## The record

Every file says at the top what it is now: a **Status** line on the concepts and specs,
an **Outcome** section on the plans. `current` means it still describes the system.

### Concepts

One question per document. These and [the contract's own
README](../contracts/allowance/README.md) are where the design is written down.

| | |
|---|---|
| [`rolling-window.md`](rolling-window.md) | why spending is counted in a ring of slices rather than a counter or a list |
| [`agent-identity.md`](agent-identity.md) | why the contract stores a public key and not an address |
| [`rent-and-revival.md`](rent-and-revival.md) | what storage costs on Soroban, every number measured on testnet |

### Specs

| | |
|---|---|
| [`specs/2026-09-06-factory-design.md`](specs/2026-09-06-factory-design.md) | a contract that deploys allowances at derived addresses. Superseded. |
| [`specs/2026-09-06-no-factory.md`](specs/2026-09-06-no-factory.md) | why that contract was deleted the day it was built |
| [`specs/2026-09-06-sdk-design.md`](specs/2026-09-06-sdk-design.md) | the client package, its credential pair and its refusals |
| [`specs/2026-09-08-web-design.md`](specs/2026-09-08-web-design.md) | the interface. Its create flow was superseded. |

### Plans

Task by task, written before the work and frozen after it.

| | |
|---|---|
| [`plans/2026-09-06-factory.md`](plans/2026-09-06-factory.md) | allowance 0.2.0, then the factory |
| [`plans/2026-09-06-sdk.md`](plans/2026-09-06-sdk.md) | `@stellar-allowance/sdk`, in three phases |
| [`plans/2026-09-07-live-payment.md`](plans/2026-09-07-live-payment.md) | one real payment, against a live seller and a facilitator we do not run |
| [`plans/2026-09-08-web.md`](plans/2026-09-08-web.md) | the interface, in five phases |

---

## The timeline

### 2026-09-04, starting over

`e157598` empties the tree. The v1 code stays on `main`, unmerged, and the rebuild begins from
nothing.

I cut the scope on purpose: one contract, one client package, no server, no database, no
gateway and no payment splitter. What is left is the part a reviewer can verify on chain or
run locally.

### 2026-09-04 to 09-05, the contract, one rule per commit

31 commits, each one a failing test and then the code that passes it. There is no spec or plan
for this phase because the convention started later. The record is the commit range
`e157598..4137365` and [`contracts/allowance/README.md`](../contracts/allowance/README.md),
384 lines covering `__check_auth`, the allowlist, the window and TTL.

Two questions took long enough to become their own documents. A daily cap kept as a counter
with a nightly reset lets an agent spend twice the cap in two minutes, which is
[`rolling-window.md`](rolling-window.md). And the contract stores the agent's raw ed25519
public key rather than an address, because `ed25519_verify` knows nothing about accounts,
which is [`agent-identity.md`](agent-identity.md).

Merged as [#12](https://github.com/synacktraa/stellar-allowance/pull/12).

### 2026-09-05, measuring instead of reading

[`rent-and-revival.md`](rent-and-revival.md). Every TTL and rent figure was measured against
testnet rather than taken from documentation, and two of them contradicted what I expected:
using a contract extends no clock at all, and `stellar contract build` already emits the
optimized artifact, so `--optimize` on top of it changes nothing. The window's 24 slices in 25
slots came out of these numbers.

### 2026-09-05, releasing the wasm so it can be checked

A tag builds the contract in CI and publishes it with a GitHub build attestation, so
`stellar contract info build --wasm` resolves the deployed bytes back to the commit and the
workflow that produced them. This is the verification that later made the factory unnecessary.

### 2026-09-06, allowances get names

Seven commits, released as 0.2.0 and merged as
[#13](https://github.com/synacktraa/stellar-allowance/pull/13). It was written as Phase 1 of
the factory plan, because a factory pins one wasm hash and every allowance change after that
costs a new factory.

### 2026-09-06, the factory, built and deleted

Designed in [`factory-design.md`](specs/2026-09-06-factory-design.md). I built it through
Task 12 and deleted it the same day. [`no-factory.md`](specs/2026-09-06-no-factory.md)
records what settled it: the interface should let an owner choose which allowance version to
create, and a factory pins exactly one hash with no setter, so both cannot be true.

The address derivation survived it. `sha256(owner ‖ index)` as the salt, with the owner as the
deployer instead of a contract, gives the same property the factory existed for: an allowance
is found by computing its address, never by looking it up. It is `deriveAllowanceAddress` in
the SDK now.

The branch tip is tagged `factory-experiment`. Nothing was thrown away.

### 2026-09-06, hooks

Path-filtered pre-commit and pre-push, so a change under `sdk/` does not run the contract
suite. Merged as [#14](https://github.com/synacktraa/stellar-allowance/pull/14).

### 2026-09-06 to 09-08, the SDK

[`sdk-design.md`](specs/2026-09-06-sdk-design.md), then
[the plan](plans/2026-09-06-sdk.md), 19 commits, merged as
[#15](https://github.com/synacktraa/stellar-allowance/pull/15).

What made the package necessary: `@x402/core`, `@x402/stellar` and `@x402/fetch` already
implement x402 on Stellar, and none of them can pay from a contract. `ClientStellarSigner`
documents support for contract accounts, and the path behind it calls `Keypair.fromPublicKey`,
an ed25519 account constructor, which throws on a `C` address. The SDK builds the payment
payload itself and signs the auth entry directly.

### 2026-09-07, one real payment

[The live payment plan](plans/2026-09-07-live-payment.md). A seller on Vercel, OpenZeppelin's
facilitator, and an agent paying from an allowance it does not own. It settled as
`574370730f5f1616f56beec3b99c6714a1325aea8065e195fa8959a90e7c69a5`, with the allowance
contract as the payer and the facilitator paying the fee.

Running the plan is what found the two bugs in it, both recorded in
[its outcome](plans/2026-09-06-sdk.md#outcome). Neither was reachable from a unit test, and
the build and simulate path had no test at all until the live run gave it one.

All three refusal rules were then proven on chain, each by changing the allowance rather than
the seller, so the failures come from the contract and not from a seller that was asked for
the wrong thing.

### 2026-09-08, two claims that did not survive checking

The SDK README said there is no public Soroban RPC for mainnet, and that recording simulation
calls `__check_auth` with no signature to pass. Both were wrong. SDF publishes no mainnet RPC
but third parties do, and recording simulation does not call `__check_auth` at all: it reports
an entry with `signature=scvVoid` and verifies nothing.

Settling them took a replay script that printed what simulation returns at each step, rather
than another reading of the types. Both corrections are in `3eed51e`.

### 2026-09-08 to 09-09, the interface

[`web-design.md`](specs/2026-09-08-web-design.md), then [the plan](plans/2026-09-08-web.md),
merged as [#16](https://github.com/synacktraa/stellar-allowance/pull/16).

The landing page and the live demo went as planned. The create page did not. It was built as
specified, looked at once and thrown out, because a form asking an owner to find the next free
index is the contract's arithmetic handed to the reader. What replaced it asks the chain for 60
derived addresses in one call and lists what answers, which is a table, and the free index falls
out of the same read rather than being a question.

The allowlist changed with it. An owner adds an API URL, the interface fetches its 402 and takes
the payout address out of the offer, so what gets typed is the thing being bought and the address
is derived instead of transcribed.

### 2026-09-09, on npm

`@stellar-allowance/sdk` 0.1.0, then 0.1.1 with a corrected README, released as the tags
`sdk-v0.1.0` and `sdk-v0.1.1` through
[#17](https://github.com/synacktraa/stellar-allowance/pull/17) and
[#18](https://github.com/synacktraa/stellar-allowance/pull/18).

The release workflow refuses a tag naming a version npm has never heard of, so the publish comes
first and the tag records it. Only the account holder can publish, and a release pointing at an
install that fails is worse than no release.

---

## What is not here yet

- **`architecture.md`.** The concept docs above and the contract's README carry the design
  between them. Whether a fourth document adds anything is undecided.
- **The two upstream issues** in the SDK design's last section, still unfiled.
- **Archival.** An allowance left idle for 120,960 ledgers stops answering the interface's read,
  and nothing yet tells an owner that is what happened to it.
