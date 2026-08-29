# The contracts, explained

What the two contracts do, why they're shaped that way, and the exact commands used to test,
deploy and run them.

| | Purpose | Deployed (testnet) |
|---|---|---|
| **Allowance** | holds the owner's funds, enforces the rules | `CBOI5QMTUQK5AREMRIIKSUQ4P7XUPG7NKXTJDB3OFOXB6PVOMFC6JXYZ` |
| **Splitter** | receives a payment, pays 90/10 | `CCM5PU7RVHWKUZJWNJ4UC2T23EYJB4JXENZC5V2AEKSSPNUY42HLLS7B` |

Sections 1–5 cover the allowance; section 6 covers the splitter.

---

## 1. What it is

A contract that holds USDC on behalf of an **owner** and lets an **agent** spend it — but only
inside rules the owner set. The agent holds no funds of its own, so every payment it makes has to
pass through here.

Three roles, and they never overlap:

| Role | Can | Cannot |
|---|---|---|
| **owner** | deposit, withdraw, revoke | spend |
| **agent** | request a spend | withdraw, change rules |
| **contract** | move its own USDC | act without being invoked |

---

## 2. Storage

Two storage types, chosen deliberately.

```rust
enum DataKey {
    Owner, Agent, Token, Rules, Revoked,   // instance
    Window,                                 // persistent
}
```

**Instance storage** holds config — everything set once at `init` and rarely touched. It shares
one ledger entry with the contract, so it lives and dies with the contract.

**Persistent storage** holds the spend window, which changes on every call. It's a separate entry
with its own lifetime.

The split matters because instance storage is read in full on every invocation. Putting a growing
list in there would make every call more expensive over time.

### The three types

```rust
pub struct Rules {
    pub max_per_call: i128,     // most that may move in one call
    pub window_ledgers: u32,    // width of the rolling window
    pub window_cap: i128,       // most that may move across the window
    pub allowlist: Vec<Address>,
}

pub struct SpendEntry { pub amount: i128, pub ledger: u32 }

pub struct Window {
    pub history: Vec<SpendEntry>,
    pub cached_total: i128,     // sum of history, kept so we never re-add it
}
```

`cached_total` is not an optimisation you can skip. Without it, every call would sum the whole
history, and cost would grow with usage.

> **`soroban_sdk::Vec` is not `std::Vec`.** It's host-backed: `get(i)` returns `Option<T>` **by
> value**, and mutating a struct you read out of storage changes nothing until you `set()` it back.
> That's the classic lost hour — the window looks correct in code and never enforces anything.

---

## 3. The functions

### `init(owner, token, agent, rules)`

Sets everything once. Guarded so it can't be called twice:

```rust
if env.storage().instance().has(&DataKey::Owner) {
    return Err(AllowanceError::AlreadyInitialized);
}
owner.require_auth();
```

Without that guard anyone could re-initialise and make themselves the owner.

### `deposit(from, amount)`

```rust
let owner = require_owner(&env)?;
if from != owner { return Err(...); }
token::TokenClient::new(&env, &token_address)
    .transfer(&from, &env.current_contract_address(), &amount);
```

The owner signs once. Their signature covers both the outer `deposit` call **and** the nested SAC
`transfer` — one auth tree, one Freighter popup.

### `spend(to, amount, reference)` — the whole product

Order matters. Cheapest checks first, money last:

```
1  amount > 0
2  not revoked
3  agent.require_auth()
4  amount <= rules.max_per_call
5  to is on rules.allowlist
6  prune window; total + amount <= rules.window_cap
7  history not full
8  record the spend and persist
9  transfer, then emit SpendRecorded { to, reference, amount }
```

Any failure before step 9 reverts the whole transaction — the transfer never happens, the window
write is rolled back. There is no partial state.

`reference` is the challenge id the gateway put in its 402. It goes into the event so the gateway
can later read it back off the chain and prove *this* payment settles *that* request.

### `set_rules(rules)`

Replaces the rules. Owner only.

It deliberately leaves the spend window untouched. If a rule change reset the window, an agent
sitting at its cap could be handed a fresh one by any edit — including an edit that *lowers* the
cap, which is exactly when you least want it.

### `revoke()`

Sets one flag. Deliberately moves no money, so it cannot fail for balance reasons — which is what
you want from an emergency brake.

### `withdraw(to, amount)`

No rules apply. The rules constrain the agent; the owner owns the money.

**This was the first test written**, before any rule logic. A contract that accepts deposits and
can't return them is a shredder, and it's the one bug with no recovery path.

### `remaining()` / `spent_in_window()`

Read-only. They prune **in memory** and return without persisting. If a view wrote, every balance
check would become a state-changing transaction that costs a fee.

---

## 4. Authorization — why the transfer needs no signature

Two different mechanisms are at work, and confusing them wastes hours.

**Transaction Invoker** — when the agent is the transaction source, `agent.require_auth()` is
satisfied by the transaction's own signature. No separate auth entry, no nonce, no expiry. This is
why `--source-account agent` just works from the CLI.

**Contract Invoker** — when your contract calls the SAC:

```rust
token.transfer(&env.current_contract_address(), &to, &amount);
```

the SAC internally calls `require_auth` on the `from` address, which *is* your contract. The host
reasons: this contract made the call, therefore it authorized it. **No signature exists or is
needed.** A contract has no private key and cannot produce one.

These don't collide — they authorize different addresses at different depths of the call tree.

> Contract Invoker auth is **one level deep only**. Contract → SAC is one hop, which is fine here.
> Add another hop and you'd need `authorize_as_current_contract`.

---

## 5. The rolling window

```rust
fn prune(env: &Env, mut window: Window, window_ledgers: u32) -> (Window, i128) {
    let sequence = env.ledger().sequence();
    if sequence > window_ledgers {
        let cutoff = sequence - window_ledgers;
        while let Some(entry) = window.history.get(0) {
            if entry.ledger <= cutoff {
                window.cached_total -= entry.amount;
                window.history.pop_front();
            } else { break; }
        }
    }
    (window, window.cached_total)
}
```

Entries are appended in ledger order, so the oldest is always at the front. Pruning stops at the
first entry still inside the window — it never scans the whole list.

**Rolling, not tumbling.** Entries expire individually by age. The tempting shortcut — "reset the
counter when the period ends" — is a *tumbling* window, and it lets an agent spend the cap at
23:59 and the cap again at 00:01. Don't ship that and call it a rolling limit.

### The bug this exposed

The first version used `saturating_sub`:

```rust
let cutoff = env.ledger().sequence().saturating_sub(window_ledgers);
```

`Env::default()` starts at ledger **0**. So `0.saturating_sub(60)` clamps to `0`, and an entry
written at ledger 0 satisfies `0 <= 0` and gets pruned immediately. The window silently never
accumulated anything — four tests failed with `spent_in_window() == 0`.

The correct rule: **if the chain is younger than the window, nothing can have aged out yet.**
Hence the `if sequence > window_ledgers` guard.

This would have passed unnoticed on testnet, where sequence numbers are in the millions. It only
showed up locally — which is a decent argument for having local tests at all.

---

## 6. The splitter

One per registered API. The gateway's 402 names the splitter as the recipient, so an agent's
payment lands in a contract instead of an account the platform controls.

```rust
init(developer, platform, token, fee_bps)   // fixed at creation, cannot be called twice
flush() -> (i128, i128)                     // pays out the whole balance, 90/10
balance() / config()
```

### Why it exists

The first design had the platform receive 100% and forward 90%. That works, and it costs three
things:

| | Platform forwards | Splitter |
|---|---|---|
| Custody | platform holds the money briefly | never touches it |
| Trust | developer trusts the platform to forward | reads the contract |
| Allowlist | every API resolves to one address | each API has its own |

The third is the one that surprised us. Because a spending allowlist works on addresses, and every
API's 402 named the same platform address, the allowlist could not tell APIs apart at all. Giving
each API its own splitter makes per-API restriction real rather than cosmetic.

### `flush()` is permissionless

Anyone can call it. There is nothing to guard: the funds can only reach the two addresses fixed at
creation, and the ratio is fixed too. What it buys is that the developer can collect without
waiting on the platform to act, which matters if the platform is down or uninterested.

Verified on testnet by having the **agent** call it — not the platform.

### Rounding

```rust
let platform_amount = total * fee_bps / BPS_DENOMINATOR;   // rounds down
let developer_amount = total - platform_amount;            // takes the remainder
```

Integer division means the fee rounds down and the odd unit goes to the developer. The tests pin
this at 100,001 stroops specifically, so the behaviour is a decision rather than whatever the
arithmetic happened to do.

### One consequence to design around

Sending tokens to a contract **does not run any of its code**. A SAC transfer just credits the
balance. So the splitter cannot pay out on receipt — something has to call `flush()`.

The gateway does it immediately after verifying a payment, in the same request. If that call
fails, the money is still safe in the splitter and the next `flush()` pays out everything
accumulated, which is why one of the tests covers two payments arriving before any flush.

## 7. Testing

### The harness

```rust
let env = Env::default();
env.mock_all_auths();
env.ledger().set_sequence_number(1_000_000);

let token = env.register_stellar_asset_contract_v2(token_admin);
let contract = env.register(Allowance, ());
let client = AllowanceClient::new(&env, &contract);

StellarAssetClient::new(&env, &token.address()).mint(&owner, &10_000_000);
```

Four lines give you a working USDC stand-in with no network, no funding, no trustlines.
`AllowanceClient` is generated by `#[contractimpl]` — you never write it.

- `mock_all_auths()` makes every `require_auth()` pass. Fine for logic tests; use `mock_auths()`
  when you specifically want to test that the *wrong* signer is rejected.
- `set_sequence_number()` fast-forwards ledgers — the only way to test that the window rolls.

### Errors vs panics

```rust
client.spend(...)                       // panics on error
client.try_spend(...).unwrap_err().unwrap()   // gives you the typed error
```

Use `try_*` whenever you're asserting a *refusal*, so you check it failed for the right reason
rather than any reason.

### The eleven allowance tests

| | Asserts |
|---|---|
| 1 | deposit then withdraw returns every unit ← written first |
| 3 | spend under all limits pays the seller |
| 4 | over `max_per_call` → `ExceedsPerCall`, and **nothing moves** |
| 5 | unlisted recipient → `RecipientNotAllowed` |
| 6 | 5 calls fit, the 6th → `ExceedsWindow` ← the demo |
| 7 | advance 61 ledgers, window clears, spending resumes |
| 8 | revoked agent → `Revoked` |
| 8b | owner can still withdraw after revoke (money isn't stranded) |
| 9 | views return the same answer twice (reads don't write) |
| 10 | owner can change rules; the old recipient stops working |
| 11 | changing rules preserves spend history |

Every refusal test asserts the balance too. "It returned an error" is not the same as "no money
moved", and only one of those is the actual requirement.

### The seven splitter tests

Same principle applied to payouts: asserting the *ratio* would pass while a unit was silently
retained, so every payout test also checks the contract is left empty and that both recipient
balances sum to what went in.

Covered: the 90/10 split, rounding at 100,001 stroops, permissionless flush, two payments arriving
before any flush, flushing an empty contract, re-initialisation by a third party, and a fee above
100%.

```bash
cargo test          # 18 tests across both contracts, no network required
```

### What the gateway sells

A paid endpoint accepts `GET` and `POST`. A query string is forwarded to the origin; a POST body
is forwarded with its content type, capped at 64KB.

A POST sends its body twice — once to be refused with the 402, once with the payment. That is
inherent to the pattern rather than a quirk of this implementation: the first call cannot be
served, so whatever it carried has to come again.

**The quote is not bound to the body.** The price is per call, not per byte, so a quote taken for
one body and spent on another costs the developer nothing. That stops being true the day pricing
is metered, and then the body's hash belongs in the challenge row.

### The gateway is tested differently

The contracts can be tested in a vacuum because they *are* the whole system inside the transaction.
The gateway is not: it decides using an HTTP header, a database row, and a transaction's events at
once, and the bugs live in the disagreements between the three. So `web/tests/` runs against a real
server, the real database and real testnet payments, and stubs none of them.

That is the first suite there, and it exists because of one such disagreement: the gateway checked
a payment against the API's price *now* rather than the price it had quoted, so a price rise
between quote and payment left the buyer paid and undelivered. See `testing.md`.

---

## 8. Build, deploy, run

```bash
stellar contract build
# → target/wasm32v1-none/release/stellar_allowance.wasm (9.5 KB)

stellar contract deploy \
  --wasm target/wasm32v1-none/release/stellar_allowance.wasm \
  --source-account owner --network testnet --alias allowance
```

Deploy uploads the wasm **and** creates an instance. For many users you upload once and deploy
instances from the same wasm hash — that's why per-user mandates are cheap.

### init

```bash
stellar contract invoke --id <C...> --source-account owner --network testnet -- \
  init --owner <G...> --token <USDC_SAC> --agent <G...> --rules-file-path rules.json
```

> **BOM trap.** PowerShell's `Out-File -Encoding utf8` writes a UTF-8 BOM (`EF BB BF`). The CLI's
> JSON parser fails on it and reports "check for missing quotes around strings", which sends you
> hunting a syntax error that doesn't exist. Write JSON with
> `[System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))`.

### deposit and spend

```bash
stellar contract invoke --id <C...> --source-account owner  --network testnet -- \
  deposit --from <G...> --amount 20000000        # 2 USDC — 7 decimals

stellar contract invoke --id <C...> --source-account agent --network testnet -- \
  spend --to <G...> --amount 1000000 --reference call1
```

Note the `--source-account` differs: **owner** deposits, **agent** spends. That difference is what
`require_auth` is checking.

### The splitter

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/stellar_allowance_splitter.wasm \
  --source-account platform --network testnet --alias splitter

stellar contract invoke --id <C...> --source-account platform --network testnet -- \
  init --developer <G...> --platform <G...> --token <USDC_SAC> --fee_bps 1000

stellar contract invoke --id <C...> --source-account agent --network testnet -- flush
```

Note the last one: `--source-account agent`. Any account can flush.

### Verified live

**Limits.** Six calls at 0.1 USDC against a 0.5 cap:

```
call 1..5  ->  paid
call 6     ->  REFUSED (window cap)

seller    0.5000000 USDC   exactly 5 × 0.1
agent     no trustline     cannot hold USDC at all
window    5000000 used, at cap
```

**Split.** Two calls of 0.1 USDC into a splitter, then flushed by the agent:

```
flush -> ["1800000","200000"]

seller    +0.18   (90%)
platform  +0.02   (10%)
splitter   0      nothing left behind
```

---

## 9. Not built yet

Three gaps, all in the contracts, in order of cost.

### Refuse a duplicate reference — ~20 minutes

`spend` accepts any `reference`, including one already used. The gateway does track consumed
references, but that protects the *gateway* from delivering twice; it does nothing for the buyer.

The failure: the agent submits `spend`, its RPC call times out, and it does not know whether the
payment landed. It retries. Money moves twice, the gateway delivers once, and neither side's error
handling sees a problem.

Storing used references in the contract makes payment itself idempotent. One persistent key, one
check, two tests.

### Sub-budgets for delegated agents — ~2 hours

One agent address today. An agent that spawns sub-agents has no way to give each a slice: either
they share one key and one limit, or they get separate allowances and separate deposits.

Shape: several agent addresses, each with its own per-call and window caps, all drawing on one
balance and all counting toward a shared parent window. Nothing in this space does this.

### Rollback — the interesting one, and not simply a feature

The agent pays, the gateway forwards, the upstream returns a 500. The buyer paid for nothing.

Whether a refund is even possible depends entirely on timing:

| | Refundable? |
|---|---|
| Payment sitting in the splitter, not yet flushed | yes — nobody owns it yet |
| Already flushed to the developer | no — it is theirs, and USDC on testnet is not clawback-enabled |

So a refund path requires **delaying settlement**: the splitter holds funds for N ledgers before
`flush()` will release them. That is a real trade, and it should be stated as one —

> Instant payout or refunds. Not both.

Even with the delay, the hard part remains. The chain can prove a payment happened; nothing on
chain can prove *delivery*, because delivery is an HTTP response. Any refund rule needs someone to
attest that the thing was not delivered.

The least-bad design found so far: the gateway signs a delivery receipt on success, and if no
receipt exists when the settlement window closes, the payer can reclaim. It still trusts the
gateway to sign honestly, but the incentive points the right way — a gateway that withholds
receipts blocks its own fee too, and a gateway that is simply down refunds everyone, which is the
correct outcome anyway.

This is the same shape as the constraint that produced the custom settlement leg: the system models
money precisely and delivery not at all.

## 10. Things worth remembering

| | |
|---|---|
| **Amounts are integers** | 7 decimals. `1000000` = 0.1 USDC. Never floats. |
| **`reference` is a `Symbol`** | max **32 chars**, `a-zA-Z0-9_`. A 64-char hex string will throw. |
| **Contracts hold USDC without trustlines** | balance lives in SAC storage. `G…` accounts still need one — and that's where a payout fails. |
| **Redeploy = new contract id** | script `build → deploy → init → deposit` as one command. Drain the old one first — `withdraw` exists for exactly this. |
| **Sending tokens to a contract runs no code** | the splitter can't act on receipt; something must call `flush()`. |
| **Persistent entries get ~7 days TTL minimum** | not a concern inside a hackathon. |
| **Never emit an event inside `__check_auth`** | only relevant if you attempt the x402 stretch — its verifier rejects any non-transfer event. |
