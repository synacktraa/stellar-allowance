# One write: a single signature per intent

**Status:** approved for planning · 2026-08-30
**Branches from:** `refactor/user-tab` (#9), because the dialog it rewrites lands there first.

---

## Goal

Creating an allowance costs one Freighter prompt and arrives funded. Editing one costs one
Freighter prompt no matter how many things changed.

Today creation is one prompt but arrives empty, so the first useful state is two prompts away —
and the second prompt is the one people forget, which surfaces later as an agent whose calls fail
with no obvious cause. Editing is one prompt *per field group*: changing a rate limit and adding
credits is two.

## Why this is worth a contract change

There are no users and this is testnet, so a redeploy costs nothing but the work. The product is
about to be shown to the Stellar Ambassador programme and the Community Fund, and the surface
being shown is a security surface. Getting from four owner-facing functions to three, with money
leaving through exactly two named paths, is worth more than the change costs.

The ordering the product leads with is unchanged and constrains everything below:

1. The agent holds no money at all
2. Payment goes to a splitter, not to us
3. The owner chooses who may be paid — the anti-prompt-injection control
4. …and may cap the rate

---

## Two facts established by spike, not assumed

**The native SAC creates accounts.** A `transfer` through the native Stellar Asset Contract to a
freshly generated, never-funded G-address succeeded on testnet, and the account existed
afterwards with a real sequence number. So classic `CreateAccount` is *not* the only way to bring
an account into existence, and funding the agent does not have to be a classic operation.

This is what makes the whole design possible. A transaction carrying a Soroban operation may
carry nothing else, so as long as one half was classic, "fund the agent and deposit USDC" could
never be one signature.

**Resources are not a constraint.** Measured on testnet, per invocation:

| piece | instructions | % of the 400,000,000 limit |
|---|---:|---:|
| XLM SAC transfer | 221,019 | 0.06% |
| USDC SAC transfer | 252,672 | 0.06% |
| `set_rules` (storage write) | 644,535 | 0.16% |
| sum | 1,118,226 | 0.28% |

358x headroom, and the sum is pessimistic — one real invocation pays contract-load and auth
overhead once rather than three times. Footprint is 5 read-write entries and ~1KB written, both
far below their limits. The splitter's `flush` already does two token transfers in one
invocation, so the pattern is shipped and running.

---

## The contract

### Owner-facing surface

```rust
write(env, agent: Option<Address>, rules: Option<Rules>, usdc_in: i128, xlm_to_agent: i128)
withdraw(env, amount: i128)
revoke(env)
```

`spend` is unchanged. The read-only getters are unchanged.

### `write`

Does every inbound thing in one invocation:

- `agent: Some(a)` — sets the agent. **Rejected if `Agent` is already set.** This is what makes
  creation and editing the same call: the first write names the agent, later ones cannot rename it.
- `rules: Some(r)` — replaces the rules. `None` means *leave them alone*, never *clear them*.
- `usdc_in > 0` — moves USDC from the owner into the contract.
- `xlm_to_agent > 0` — moves XLM from the owner to the agent's account, via the native SAC,
  creating that account if it does not exist yet.

All four are independently optional. `write(None, None, 0, 0)` is a no-op and must not error —
the UI's Save button computes a diff and may legitimately have nothing on-chain to send.

**No `owner` parameter.** The owner is loaded from storage via `require_owner()`, exactly as
`set_rules` and `revoke` already do, and used as the `from` of both transfers. The auth tree
covers the nested SAC transfers, so it stays one signature. This deletes an existing wart:
`deposit(from, amount)` took a `from` only to validate it against the owner the contract already
knew.

**Ordering inside the call:** validate, then set agent, then set rules, then move USDC, then move
XLM. Money moves last so a rejected rule change cannot leave funds stranded against rules that
were never applied.

### `withdraw`

Loses its `to` parameter. The destination is the stored owner, always.

A Soroban invocation does not render legibly in Freighter — the owner sees a contract call, not
"you are sending 100 USDC to G…". So a signature over a free destination is not meaningful review
of that destination. With the destination fixed, the worst this path can do is return the owner
their own money.

Given up deliberately: an owner who removes their USDC trustline while the contract holds a
balance cannot withdraw. Self-inflicted, and re-adding the trustline is one free transaction.

### `revoke`

Unchanged. It stays its own function rather than folding into `write` because it moves no money
and therefore cannot fail for balance reasons — which is the property an emergency brake needs.

### Functions removed

`deposit` and `set_rules` are subsumed by `write`. Removing them is the point: after this change,
money leaves the contract through exactly two named paths — `withdraw` and `spend` — and an
auditor can establish that by reading a function list.

### Errors

Reuse the existing enum. One addition:

```rust
AgentAlreadySet = 9,
```

`AlreadyInitialized = 1` already exists but means the constructor case; a second agent write is a
different mistake and deserves its own code so the UI can say which.

`HistoryFull = 8` is unchanged. `#10`, referenced in the snippet's error translation, is a token
contract error (insufficient balance), not ours.

### Events

Emitted conditionally, so existing consumers are unaffected:

- `Deposited` when `usdc_in > 0`
- `SpendRecorded` — untouched; the gateway reads it to bind a payment to a challenge
- `Withdrawn`, `AgentRevoked` — untouched

No event for the XLM transfer: the native SAC emits its own, and duplicating it in our topic
space would make our events ambiguous about which asset moved.

---

## Deployment, and the blank that can be left behind

The constructor keeps `owner` and `token` and **loses `agent` and `rules`**, which move to the
first `write`.

```rust
__constructor(env, owner: Address, token: Address)
```

The property the current docblock claims — *"there is no moment where the contract exists
unowned"* — survives exactly as written. That sentence is part of the security story being shown
to reviewers and is not traded away.

**The order reverses.** Today the owner signs first (funding the agent) and the platform deploys
second. Now the platform deploys first, because `write` needs something to write to. A cancelled
Freighter prompt therefore leaves a deployed contract that is owned, empty, and has no agent.

That contract is not garbage. It is the owner's own half-finished allowance:

- Nothing can spend from it — there is no agent.
- Nobody else can take it — the owner is already set.
- Finishing it is one `write` with a freshly generated agent key.

**Blank reuse, scoped to the owner.** Before deploying, the create route looks for a contract this
owner already has with no agent. If one exists, it is reused and no deploy happens. This caps
blanks at one per owner, permanently.

This is reuse without reassignment. The contract is already theirs, so no ownership ever changes
hands, no ownership window opens, and no one else receives a contract someone else started.

**Reuse must match on token.** The constructor's `token` is immutable and there is no getter for
it, so it cannot be verified from outside. Record `token_address` on the row at deploy, written
from the same env value passed to the constructor in the same request, and filter the reuse query
on it. A mismatch means deploy fresh. Without this, a change to `USDC_SAC` — a testnet reset, a
different issuer, eventually mainnet — would silently hand someone an allowance denominated in an
asset they did not choose.

**Accepted race:** two tabs creating at once can slip past the check and produce two blanks.
Bounded, harmless, and self-healing — the next create reuses one.

---

## Database

```sql
alter table allowances alter column agent_address drop not null;
alter table allowances add column token_address text;
```

`agent_address is null` means *deployed, not yet funded* — the same fact the contract stores by
having no `Agent`, so the two cannot drift.

Backfill `token_address` for existing rows from the current `USDC_SAC`, since every existing
contract was deployed against it.

---

## API

**`POST /api/allowances`** — no longer takes rules or an agent. It deploys (or reuses a blank) and
returns the contract id. The owner's `write` is what makes it real.

**`GET /api/allowances?owner=`** — returns `funded: boolean` per row, derived from
`agent_address is not null`.

**`GET /api/allowances?agent=`** — unchanged. This is what the client SDK uses to find its
allowance from the agent's key alone; unfunded rows have no agent and so never match.

**`PATCH /api/allowances/[contractId]`** — unchanged. Renaming stays off-chain and stays a
challenge signature.

The route no longer needs to wait for the agent's account to exist before deploying, because the
account is created by the first `write`.

---

## UI

### One dialog for create and edit

Creation is the first `write` — the same form, with the agent field populated and the rest empty.
One component, which removes the class of bug where the create and edit dialogs disagree about
what a rule means.

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

**Save sends only what changed.** Untouched rules go as `None`, an empty amount goes as `0`.
Disabled when nothing changed.

**Save covers the name too.** Renaming cannot ride in `write` — the contract has no name field and
should not grow one — so a Save that also renames costs two signatures, one of them a free,
instant, non-transaction challenge. Worth it for Save to mean *save everything*.

**Withdraw and stop stay outside Save.** Withdraw is a different contract function and cannot be
in the same call; putting the exit inside a general Save would also hide it. Stop is the emergency
brake and must never require finding it inside a form.

### Labels must carry the additive/absolute split

Amounts are **additive** — "add 5.00" puts five more in. Rules are **absolute** — the rate limit
*is* 0.50 per 15 minutes. Unlabelled, people type their target balance into the add field. The
labels carry this; the placeholder is not enough.

### Unfunded allowances must look unfinished

USDC at creation is optional — `usdc_in: 0` is legal, and "set it up now, fund it Monday" is a
real workflow. But the failure it invites is an agent whose calls fail for a reason nobody
connects to a forgotten deposit.

So: prefill the USDC amount at creation, so the funded path is the default path. And when credits
are `0.00`, show it in the warning colour with `needs funding`, the same treatment low XLM already
gets in the table. The contract already refuses with a token error the SDK translates, so the
agent's log names it too.

A row with no agent shows `not finished` with a **finish setup** action, which is the same dialog
with the same Save.

### Callers that must move with it

`deposit` and `set_rules` disappear, so every caller changes in the same commit:
`web/src/lib/freighter.ts` (the wrappers), `web/src/app/user/page.tsx` (the dialog),
`web/src/app/api/allowances/route.ts` (creation), `web/src/app/page.tsx` (the landing page's
references), and `web/scripts/seed-demo.mjs` (which funds the demo allowance). Nothing may be
left calling a function the deployed contract no longer has.

### `createAgentAccount` is deleted

It exists only to create the agent's account with a classic operation. The first `write` does that
now.

---

## Testing

Per the inverted pyramid: contract tests in Rust, integration tests against real testnet, and the
existing suite must stay at zero failures and zero skips.

### Rust — `contracts/contracts/allowance/src/test.rs`

- `write` sets the agent on first call
- `write` rejects a second agent with `AgentAlreadySet`
- `write` with `rules: None` leaves existing rules untouched
- `write` with everything empty is a no-op and does not error
- `write` moves USDC in and XLM out in one invocation
- `write` applies rules before moving money — a rejected rule change moves nothing
- `withdraw` sends to the stored owner
- `withdraw` cannot be called by a non-owner
- `spend` still refuses everything it refused before (regression across all five rules)

### Integration — `web/tests/`

- creating an allowance deploys once and returns a contract with no agent
- creating twice after abandoning reuses the blank rather than deploying again
- a blank deployed against a different token is not reused
- the first `write` creates the agent's Stellar account from nothing
- `GET ?agent=` does not match an unfunded allowance
- a funded allowance is spendable end to end through the gateway

Chain tests share a signing key and stay serial (`--test-concurrency=1`).

---

## Rollout

The contract changes, so `ALLOWANCE_WASM_HASH` changes and every existing allowance stays on the
old code. With no users, the fleet is: the demo allowance and whatever exists from testing.

1. Build and test the contract in Rust
2. Deploy the new WASM to testnet, update `ALLOWANCE_WASM_HASH`
3. Migrate the schema
4. Ship the API and UI together — they cannot be split, since the old UI calls functions the new
   contract does not have
5. Re-seed the demo allowance
6. Manual click-through with a real wallet, which is the only way the signing paths get exercised

The recorded landing-page demo replays a static JSON file and is unaffected.

---

## Out of scope

- **A pool of pre-deployed blank contracts.** Would remove deploy latency from create, but
  requires contracts born unowned and therefore gives up the "never unowned" property. Not worth
  it at zero users. Revisit only if create latency becomes a real complaint.
- **Merging `withdraw` into `write`.** No flow deposits and withdraws in one transaction, so it
  buys nothing and costs a direction parameter on every call that moves no USDC at all.
- **Merging `revoke` into `write`.** It moves no money and so cannot fail for balance reasons.
  That is the property an emergency brake needs.
- **Putting the name on chain.** Renaming is free and instant off-chain. On chain it would cost a
  fee and could fail.
- **The client SDK** (`@stellar-allowance/client`). Separate branch, separate PR, and it must be
  published to npm before the copy-paste snippet can reference it.
