# The contract, explained

What `contracts/contracts/allowance/src/lib.rs` does, why it's shaped that way, and the exact
commands used to test, deploy and run it.

Deployed: `CDVPL2TCXOGP7NHDD3XYAOKXFKFKAF6RZHBCOU6ACU4UIXIZTSWLH5AH` (testnet)

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

## 6. Testing

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

### The nine tests

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

Every refusal test asserts the balance too. "It returned an error" is not the same as "no money
moved", and only one of those is the actual requirement.

```bash
cargo test
```

---

## 7. Build, deploy, run

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

### Verified live

Six calls at 0.1 USDC against a 0.5 cap:

```
call 1..5  ->  paid
call 6     ->  REFUSED (window cap)

seller    0.5000000 USDC   exactly 5 × 0.1
agent     no trustline     cannot hold USDC at all
contract  1.5 USDC
window    5000000 used, at cap
```

---

## 8. Things worth remembering

| | |
|---|---|
| **Amounts are integers** | 7 decimals. `1000000` = 0.1 USDC. Never floats. |
| **`reference` is a `Symbol`** | max **32 chars**, `a-zA-Z0-9_`. A 64-char hex string will throw. |
| **Contracts hold USDC without trustlines** | balance lives in SAC storage. `G…` accounts still need one — and that's where a payout fails. |
| **Redeploy = new contract id** | script `build → deploy → init → deposit` as one command. |
| **Persistent entries get ~7 days TTL minimum** | not a concern inside a hackathon. |
| **Never emit an event inside `__check_auth`** | only relevant if you attempt the x402 stretch — its verifier rejects any non-transfer event. |
