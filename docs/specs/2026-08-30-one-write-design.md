# One write: a single signature per intent

**Status:** approved · 2026-08-30
**Branch:** `feat/one-write`, on top of `refactor/user-tab` (#9). **#9 must merge first.**

---

## The problem

Creating a *usable* allowance costs two Freighter confirmations. Stellar permits a transaction
that calls a smart contract to do exactly one thing, so creating the contract and putting money
into it cannot share a transaction.

Today the first one is hidden — the platform deploys the contract and pays for it, so no prompt
reaches the owner. But it arrives **empty**, and filling it is a second prompt. That second prompt
is the one people forget, and the symptom arrives much later, as an agent whose calls fail for a
reason nobody connects back to a missed deposit.

## The answer

**The owner deploys their own contract, and the constructor does everything.** A deploy-with-
constructor is a single host function invocation, so one signature can create the contract, record
the agent, set the rules, pull the USDC in, and push XLM to the agent's account.

Nothing exists until that signature. Cancel the prompt and there is no half-made contract, nothing
to track, and nothing to clean up.

## Two facts established by spike, not assumed

**A constructor can move the deployer's money.** First proved with a throwaway probe contract,
then with the real one: a single signed transaction deployed an allowance, pulled 0.10 USDC into
it, and funded a **brand-new agent account that did not exist beforehand**, all in one operation.

```
agent account exists beforehand: false
status       : SUCCESS
contract USDC   : 1000000n (matches)
agent XLM       : 5.0000000 (account created by the constructor)
```

This is what the whole design rests on, and it is measured rather than inferred.

**The native SAC creates accounts.** A `transfer` through the native asset contract to a freshly
generated, never-funded address succeeded, and the account existed afterwards with a real sequence
number. So funding the agent does not need the classic `CreateAccount` operation, which could
never have shared a transaction with a Soroban call.

Two supporting measurements:

- **The whole thing costs the owner 0.0198032 XLM in fees.** Measured from a settled transaction,
  not simulated: one deploy that also created a brand-new agent account and moved USDC. The owner
  sends 5 XLM to the agent in that same action, so fees are 0.4% of what they were spending
  anyway. The constructor docblock's claim that platform-paid deployment removes an XLM barrier
  describes a barrier that is not there.
- **Resources are not a constraint.** A USDC transfer, an XLM transfer, and a rules write sum to
  1,118,226 instructions against a 400,000,000 per-transaction limit — 0.28%, and pessimistic,
  since one invocation pays contract-load overhead once rather than three times.

---

## The contract

```rust
__constructor(env, owner, token, native, agent, rules, usdc_in, xlm_to_agent)

write(env, rules: Option<Rules>, usdc_in: i128, xlm_to_agent: i128)
withdraw(env, amount: i128)
revoke(env) / resume(env)
owner(env) / agent(env)                    // public, so the ownership claim is checkable
spend(env, to, amount, reference)          // the agent's only call, unchanged
```

### The constructor

Sets owner, token, native, agent and rules, then moves the money. `require_auth()` on the owner
covers both nested transfers through the auth tree, so it stays one signature.

**The agent is immutable by construction.** Not a runtime guard that has to be read and trusted:
there is simply no function that can change it. That is a stronger guarantee and a shorter audit.

**`native`** is the native XLM asset contract. A Soroban contract can only move a token by calling
a token contract, and soroban-sdk exposes no host function returning the native one — so it has to
be told, once, at construction rather than on every call where it could be passed wrongly.

**`usdc_in` and `xlm_to_agent` may both be zero.** "Set it up now, fund it Monday" stays possible.
The UI discourages it rather than the contract forbidding it.

### `write` — edits only

Everything the owner changes afterwards, in one invocation and therefore one confirmation: change
the rules, add USDC, and top up the agent's XLM together instead of three times.

`rules: None` means *leave them alone*, never *clear them* — the Save button sends a diff, and an
edit that only added credits must not rewrite the allowlist. `write(None, 0, 0)` is a legal no-op,
because Save may find nothing on-chain to send when only the name changed.

**No `owner` parameter.** It is loaded from storage via `require_owner()`, as `revoke` already
does, and used as the `from` of both transfers. `deposit(from, amount)` used to take a `from` only
to check it against the owner the contract already knew — an argument that can be wrong for no
benefit.

**No `agent` parameter.** It cannot change, so it cannot be written.

**Ordering:** rules first, then USDC, then XLM. Money moves last, so a rejected rule change cannot
leave funds sitting against rules that were never applied.

### `withdraw` loses its destination

The destination is the stored owner, always.

Freighter renders a Soroban invocation as a contract call, not as *"sending 100 USDC to G…"*. A
signature over a caller-supplied destination is therefore not meaningful review of that
destination. Fixed, the worst this path can do is return the owner their own money.

Given up deliberately: an owner who removes their USDC trustline while the contract holds a
balance cannot withdraw. Self-inflicted, and re-adding the trustline is one free transaction.

### `revoke` stays separate, and gains `resume`

It moves no money and therefore cannot fail for balance reasons, which is what an emergency brake
needs. It should also never require finding it inside a form.

Stopping had no way back, found in the click-through. A brake you cannot release is not a brake —
recovering meant a new allowance, a new agent key and moving the money across. `resume` restores
only what the rules already allowed, and leaves the spend window alone so the round trip cannot
be used to clear a cap.

### `deposit` and `set_rules` are deleted

Subsumed by `write`. Removing them is the point: money then leaves the contract through exactly
two named paths — `withdraw` and `spend` — and an auditor can establish that from the function
list alone.

### Errors and events

The error enum is unchanged. No `AgentAlreadySet` is needed: the agent cannot be written twice
because it cannot be written at all after construction.

Events are emitted conditionally, so existing consumers are unaffected: `Deposited` when
`usdc_in > 0`; `Withdrawn` and `AgentRevoked` untouched; `SpendRecorded` untouched, since the
gateway reads it to bind a payment to a challenge. No event for the XLM leg — the native SAC emits
its own, and duplicating it would make our topics ambiguous about which asset moved.

---

## What the platform stops doing

It no longer deploys allowances or pays for them. That removes a cost that scaled with signups and
the spam vector that came with it. Splitters are unaffected; developers still get those for free.

**`POST /api/allowances` becomes a recording endpoint, not a deploying one.** The client submits
the deploy itself and then reports the resulting contract id.

**It must verify before recording.** Read the contract on chain and confirm it exists, that its
owner is the caller, and that its agent matches what was claimed. Without that check, anyone could
`POST` arbitrary contract ids and attach rows to other people's addresses.

**`GET /api/allowances/params`** returns the values a client needs to build the deploy — the
allowance WASM hash, the USDC asset contract, and the native asset contract. None are secret; they
live server-side today and should keep a single source.

---

## What no longer needs building

All of this existed only to handle a contract the platform created before the owner signed:

- blank contracts, and reusing them
- a `token_address` column, and matching reuse against it
- a nullable `agent_address`, and the migration for it
- a `not finished` row state and a finish-setup action
- `AgentAlreadySet`, and the once-guard behind it
- **no database migration at all** — every row still has an agent from the moment it exists

---

## UI

### Creating

1. Generate the agent keypair in the browser
2. **Show the secret and require acknowledgement** — before the signature, not after
3. Build the deploy transaction, sign it in Freighter, submit it
4. `POST` the contract id to record it

The secret comes before the signature because it is the only copy. Showing someone a key only on
success is the wrong way round.

### Editing — one Save

```
research                                          [ stopped ]

  credits          1.20 USDC
  add                [ 5.00 ]      ──┐
                                     │
  agent's XLM      4.83              │
  top up             [ 2.00 ]      ──┼─→  one write(), one prompt
                                     │
  can pay          [ allowlist ]   ──┤
  rate limit       [ 0.50 / 15 min ]─┘

  name             [ research ]      →  off-chain, challenge signature

                              [ save changes ]
  ─────────────────────────────────────────────
  withdraw  [ 1.00 ]  [ withdraw ]   →  its own action, own confirm
  stop this allowance                →  its own action, own confirm
```

Save sends only what changed, and is disabled when nothing did. It covers the name too — renaming
cannot ride in `write`, since the contract has no name field and should not grow one, so renaming
*and* changing a rule costs two signatures, one of them a free, instant, non-transaction challenge.

Create and edit are the **same form**. Creation is the constructor; editing is `write`. One
component, which kills the class of bug where the two dialogs disagree about what a rule means.

### Labels carry the additive/absolute split

Amounts are **additive** — "add 5.00" puts five more in. Rules are **absolute** — the rate limit
*is* 0.50 per 15 minutes. Unlabelled, people type their target balance into the add field.

### An unfunded allowance must look wrong

`usdc_in: 0` is legal, so prefill the amount at creation to make the funded path the default path,
and show `0.00` credits in the warning colour with `needs funding` — the treatment low XLM already
gets in the table.

---

## Tasks

Contract first, in Rust, each test written before the code it tests.

### 1 — Constructor takes native and the amounts

`contracts/contracts/allowance/src/lib.rs`, `test.rs`

Add `DataKey::Native`. Constructor becomes
`(owner, token, native, agent, rules, usdc_in, xlm_to_agent)`, calls `owner.require_auth()`, then
transfers USDC in and XLM to the agent.

Update `setup()` in `test.rs` to register a second stand-in asset for XLM and pass the new
arguments. New tests:

- `constructor_pulls_usdc_and_funds_the_agent` — one deploy, both balances land
- `constructor_with_zero_amounts_creates_an_empty_allowance` — legal, no transfers
- `constructor_refuses_negative_amounts`

Verify: `cd contracts && cargo test`

### 2 — `write` for edits

Replace `deposit` and `set_rules` with
`write(rules: Option<Rules>, usdc_in: i128, xlm_to_agent: i128)`.

Tests:

- `none_rules_leave_the_existing_ones_untouched` — a deposit-only write must not clear the allowlist
- `an_empty_write_is_a_no_op` — `write(None, 0, 0)` succeeds and changes nothing
- `write_adds_usdc_and_tops_up_xlm_together`
- `write_refuses_negative_amounts`

Verify: `cd contracts && cargo test`

### 3 — `withdraw(amount)`

Drop the `to` parameter; send to the stored owner. Test: `withdraw_always_goes_to_the_owner`.

Then fix every existing caller in `test.rs`: `withdraw(&owner, &n)` becomes `withdraw(&n)`,
`deposit(&owner, &n)` becomes `write(&None, &n, &0)`, and `set_rules(&r)` becomes
`write(&Some(r), &0, &0)`.

Verify: `cd contracts && cargo test` — **11 existing plus 9 new, 0 failures.**

### 4 — Build and deploy the WASM

`stellar contract build`, upload, set `ALLOWANCE_WASM_HASH` in `web/.env.local`.
Environment values go file to CLI to Vercel, never through a conversation.

### 5 — API

`web/src/app/api/allowances/route.ts`, new `params/route.ts`

`GET /api/allowances/params` returns wasm hash, token, native.

`POST` takes `{ owner, contract_id, agent, name }`, reads the contract on chain, and refuses
unless owner and agent match. Tests:

- `records an allowance the caller actually owns`
- `refuses a contract id owned by somebody else`
- `refuses a contract id that does not exist`

Verify: `cd web && npm test`

### 6 — Web library

`web/src/lib/freighter.ts`

Add `deployAllowance(address, { agent, rules, usdcIn, xlmToAgent })` building
`Operation.createCustomContract` with constructor args. Add `write`. Change `withdraw` to one
argument. Delete `createAgentAccount`, `deposit`, `setRules`, `sendAgentXlm`.

Verify: `npx tsc --noEmit` — remaining errors only in the pages, fixed next.

### 7 — UI

`web/src/app/user/page.tsx`, `web/src/components/AllowanceTable.tsx`

Creation signs the deploy; the secret is revealed before the signature. The dialog gets one Save
built on a `diff()` returning `undefined` for anything untouched. `needs funding` styling on empty
rows; prefilled amount at creation.

Verify in the browser: change **only the name** and press Save, then confirm from the network tab
that **no contract call was made**. That is the path most likely to regress.

### 8 — Remaining callers

Nothing may still call a removed function. `web/scripts/seed-demo.mjs` funds the demo allowance
with a single `write`. Re-seed, then buy one call through the gateway to confirm it settles.

### 9 — Verify

- `cd contracts && cargo test` — 0 failures
- `cd web && npm test` — 0 failures, **0 skipped; a skipped test is a failing test**
- `npm run lint && npm run build` — 0 errors
- Update `docs/CONTRACT.md`, which documents the old function surface
- **Manual click-through with a real wallet.** Freighter is a browser extension and cannot be
  automated. Exercise: create (one prompt, arrives funded), Save with several fields changed at
  once (one prompt), Save with only the name changed (no contract call), withdraw, stop.

---

## Out of scope

- **The client SDK** (`@stellar-allowance/client`). Separate branch, and it must be published to
  npm before the copy-paste snippet can reference it.
- **Merging `withdraw` into `write`.** No flow deposits and withdraws in one transaction, so it
  buys nothing and costs a direction parameter on every call that moves no USDC.
- **Putting the name on chain.** Renaming is free and instant off-chain; on chain it would cost a
  fee and could fail.

## Known risk

**Closed.** Rust tests use `register_stellar_asset_contract_v2` as a stand-in for XLM, which may
not model account creation the way the real native SAC does — so a passing Rust test was never
proof for the real network. Settled directly: the real contract, deployed by a real account,
created a never-before-existing agent account and moved USDC in the same operation
(`531bf252c5fd229ec6cc54cb90b5195da547174b7c7bb5d5568399da730dfeb4`).

What task 9's click-through still confirms is the *browser* path — that Freighter signs this
transaction shape and the UI submits it correctly. The contract itself is proven.
