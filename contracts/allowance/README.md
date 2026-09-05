# Allowance

On-chain spending limits for an AI agent.

The owner deposits a token and sets two rules: which addresses can receive it, and how much
can move in a rolling window. The agent then spends on its own, signing each payment, and
this contract checks every one against those rules before any token moves.

The constraint I started from is that a rule the agent can ignore does not ship. So there is
no service in front of this deciding anything. The contract holds the money and is its own
signer, a Soroban custom account, and the Soroban runtime calls into `__check_auth` here every
time the token is asked to move money out of it.

> Unaudited, and built for testnet. Do not put mainnet funds behind it.

## Build and test

From `contracts/`:

```bash
stellar contract build
cargo test
```

`stellar contract build` writes the deployable artifact to
`target/wasm32v1-none/release/allowance.wasm`, already optimized, at 14,682 bytes. A plain
`cargo build --release` gives 31,286 bytes from the same source. Size is rent for as long as
the code stays on the ledger, so it matters which command produced any number you are quoting.

## Deploy

The constructor takes everything at once and runs once. Nothing it sets can be changed
afterwards except the rules.

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/allowance.wasm \
  --source owner --network testnet \
  -- \
  --setup '{
    "owner_address": "GABC...",
    "agent_key":     "80ede8c6...db8bb04e",
    "spending":      { "token_address": "CDLZ...", "initial_deposit": "0" },
    "rules":         {
      "window_ledgers": 17280,
      "window_cap":     "50000000",
      "allowlist":      ["GXYZ..."]
    }
  }'
```

| field | |
|---|---|
| `owner_address` | the only account that can withdraw, change the rules, or stop the agent |
| `agent_key` | the agent's ed25519 public key as 32 bytes of hex, not a `G...` address |
| `token_address` | the asset this allowance spends, and the only one it will authorize |
| `initial_deposit` | moved from the owner into the contract in the same transaction. `0` is a legitimate deployment: rules now, funding later |
| `window_ledgers` | width of the rolling window. 17,280 is roughly a day |
| `window_cap` | most that can move across that whole window |
| `allowlist` | the only addresses the agent can pay |

`agent_key` is hex because `ed25519_verify` takes key bytes, not an identifier. A `G...`
address is the same 32 bytes wrapped in StrKey, so
`StrKey.decodeEd25519PublicKey(g).toString("hex")` converts one into the other.

Read it back with a call that costs nothing. The CLI will tell you it is read-only:

```bash
stellar contract invoke --id $CONTRACT --source owner --network testnet -- get_config
```

## How a payment gets authorized

The agent never calls this contract. It signs an authorization entry for a call to the
**token**, and the token asking to move money is what pulls this contract in.

![The agent signs a payload hash; the facilitator sends the transfer; the token asks the
Soroban runtime to authorize it; the runtime calls __check_auth on the allowance, which
verifies and applies the rules before any tokens move.](assets/payment-flow.svg)

The **facilitator** is whoever submits the transaction and pays its fee. The **Soroban
runtime** is not a party at all. It is the chain executing the call, and it is what turns a
token's `require_auth` into a call to `__check_auth` here. The SDK and the protocol docs call
it the host.

Two things follow from that shape. The agent's signature covers a call it does not make, so
this contract has to inspect what it is being asked to authorize rather than trust its own
arguments. And the signed entry is separable from the transaction, so whoever submits it pays
the fee. An agent can spend without ever holding gas.

### What `__check_auth` does not cover

I assumed for a while that `__check_auth` was the gate on everything this contract does. It is
not. It runs only when the contract authorizes itself inside somebody else's transaction,
which is the payment path above and nothing else.

Call `withdraw` on this contract directly and `__check_auth` never fires. The runtime treats a
direct invocation as authorized by whoever submitted it, so the function body runs with no
signature check at all unless the function does the checking itself.

So every owner function starts by loading the owner and demanding a signature:

```rust
fn require_owner(env: &Env) -> Result<Address, AllowanceError> {
    let owner: Address = read_value(env, &DataKey::Owner)?;
    owner.require_auth();
    Ok(owner)
}
```

That is not defense in depth, it is the only defense. A custom account that leaves it out has
a `withdraw` anyone can call, with `__check_auth` sitting in the same file looking like it
covers that.

## What the agent signs

This cost me more time than anything else in the contract.

The runtime builds a 32-byte payload hash from the network id, a nonce, an expiration ledger
and the whole invocation tree, then hands it to `__check_auth`. A signature over it cannot be
replayed onto a different call, a different network, or a second time. The payload is never
transmitted. Both sides derive it independently.

What the agent signs is the raw 32 bytes of that hash, with nothing wrapped around them. The
SDK's own `testutils::ed25519::Sign` helper signs the XDR encoding of an `ScVal` instead, so a
signature made with it will never verify here. My tests sign with `ed25519-dalek` directly for
that reason.

## Checking what the signature covers

A signature authorizes a whole invocation tree, so `__check_auth` loops over all of it. A rule
applied to the first entry and skipped on the next is not a rule.

For each call in the tree, in order, cheapest first:

| check | if it fails |
|---|---|
| the agent has not been stopped | `Disabled` |
| the signature verifies against the stored agent key | host abort, no contract error |
| the context is a contract call | `MalformedCall` |
| the function is `transfer` | `NotATransfer` |
| it has three arguments | `MalformedCall` |
| it is addressed to this allowance's token | `WrongAsset` |
| the recipient is on the allowlist | `RecipientNotAllowed` |
| the running total stays within the cap | `ExceedsWindow` |

Two of those took me a while to get right.

**Which asset is moving lives in `call.contract`, not in the arguments.** I missed this at
first. Without that check an amount is a bare number, and a cap of 50,000,000 is a real limit
in USDC and a rounding error in something else.

**The cap is measured against the window, not against the call.** The running total starts at
whatever the window already holds, so a single payment larger than the whole budget is refused
even when nothing has been spent yet.

### Why the error codes start at 101

```rust
pub enum AllowanceError {
    NotInitialized = 101,
    RecipientNotAllowed = 102,
    MalformedCall = 103,
    ...
}
```

A contract error carries no record of which contract raised it. The token is in the call tree
of every payment, and the Stellar Asset Contract uses 1 through 13 for its own errors. If mine
started at 1 as well, my client library would read the token's failures as my rule violations.

SAC 10 is `BalanceError`, which is the commonest real failure there is. Overlapping numbers
would have the library telling an owner "recipient not allowed" when the truth was "not enough
money".

## The allowlist

An agent's instructions come from text it reads. A web page, an API response, a document
somebody else wrote. That is the prompt injection problem, and for an agent that can pay
people it has a specific shape: the text tells it to send the money somewhere else, and a
good enough prompt will get it to try.

A spending cap does not help with this. A payment to an attacker's address that sits inside
the cap is a completely ordinary payment as far as a limit is concerned. The agent stays
under budget and the money is still gone.

The allowlist is the part that survives the agent being convinced. `rules.allowlist` holds
the only addresses this contract will authorize a payment to. The recipient is read out of
`args[1]` and checked against that list inside `__check_auth`, and anything else is refused
with `RecipientNotAllowed`.

What matters is where that check runs. Not in the agent's prompt, not in middleware, and not
in the facilitator. It runs on chain, in the transaction that moves the money, and the only
way to change the list is `write()`, which demands the owner's signature. An agent can be
talked into wanting to pay someone. Being allowed to is not up to the agent.

This does not make the agent trustworthy and is not meant to. If an address on the list turns
out to be malicious, or the agent is talked into buying something worthless from a seller
that is on the list, the money still moves. Bounding that is the cap's job.

## The rolling window

The allowlist settles who can be paid. The cap settles how much, and that turned out to be
the harder of the two. "100 per day" does not mean what it sounds like.

A counter that resets on a boundary can be spent twice over, minutes apart:

```
23:59   spend 100   ->  at the cap
00:00   reset       ->  counter back to zero
00:01   spend 100   ->  at the cap
```

Two hundred in two minutes and the rule was never broken as written. What I actually want is
"no more than 100 in any 24 hours, measured from right now", which has no boundary to stand
either side of.

The exact way to do that is to keep every payment as `{ amount, ledger }` and drop the ones
that have aged out. That works and it grows without limit. At 72 bytes per receipt, an agent
making a thousand payments a day is renting 72KB of ledger space to answer one question.

### What is stored instead

Spending is remembered per slice of time, not per payment. The window is divided into
`SLICES = 24` equal slices and the contract keeps one running total per slice:

```rust
const SLICES: u32 = 24;
const SLOTS: usize = SLICES as usize + 1;

pub struct Window {
    pub slots: Vec<i128>,   // one running total per slice
    pub head: u32,          // the slice most recently written
}
```

Three lines of arithmetic do the whole thing:

```rust
let width = (window_ledgers / SLICES).max(1);   // ledgers per slice
let slice = env.ledger().sequence() / width;    // which slice we are in
let here  = slice % SLOTS as u32;               // which slot that is
```

The slots are a ring. When the ledger advances into a new slice, every slot between the old
head and the new one is zeroed on the way past. Aging out is not a scan, a comparison, or a
stored date, and it costs nothing extra because the write was happening anyway.

![Seven consecutive slices with the amount spent in each. A bracket shows the window at slice
24 holding slices 20 to 24, and a second bracket shows it at slice 26 holding slices 22 to 26.
Under each slice is its slot number, so the slots repeat: slice 25 lands in slot 0 where slice
20 was, and slice 26 lands in slot 1 where slice 21 was.](assets/rolling-window.svg)

*Drawn with 4 slices and 5 slots rather than 24 and 25, so the repeat is visible.*

The two slices that left the window were never deleted. The slot a new slice lands in is the
slot holding the slice exactly one full turn older, which is the one that just aged out.
Writing the new total and forgetting the old one are the same write.

Look at what the totals do. Two more payments were made and less is counted than before.

The entry is the same size after a million payments as after one, and answering "how much has
been spent" is a sum over a fixed number of slots.

### Why there is one more slot than there are slices

`SLOTS` is 25, not 24. I had this wrong at first and the tests did not catch it, because
nothing about it looks wrong.

The slice you are currently in has only partly elapsed. With exactly 24 slots the oldest slot
gets dropped while part of the time it covers is still inside the window I promised. The
remembered span comes out at 23 to 24 hours instead of 24, spending ages out slightly early,
and an agent can spend about 4% over the cap across a day without any rule appearing to fail.

The extra slot makes the span err long instead, 24 to 25 hours. The window is never shorter
than promised, only sometimes a little longer.

That is the rule I ended up following everywhere: when rounding, round toward refusing. The
same choice shows up in `width`, where `.max(1)` gives a window narrower than 24 ledgers one
ledger per slice, which is wider than asked for rather than a division by zero.

### Reading it costs nothing

`spent_in_window()` has to age the ring forward before it can answer, and aging it is a write.
Saving that write would bill the owner a transaction every time a dashboard showed a balance,
so the read rolls a copy and stores nothing. A test asserts the stored `head` and `slots` are
untouched afterwards. Making the getter persist its roll fails that test.

## Storage and TTL

The question I asked next was what happens if nobody touches an allowance for a week. The
answer was worse than I expected.

Soroban charges rent, and entries that stop paying it are archived. They are still on the
ledger but unreadable until someone pays to restore them. An archived allowance refuses every
payment, with an error that mentions neither rent nor time.

This contract's data sits in three entries, each on its own clock:

| entry | what is in it | who keeps it alive |
|---|---|---|
| contract instance | `Owner`, `Token`, `AgentKey`, `Rules`, `Disabled` | the payment path |
| persistent entry | `Window` | the payment path |
| contract code | the wasm itself | nobody, from in here |

Instance storage is not a fourth entry. Everything written through `env.storage().instance()`
lives inside the contract instance entry, which is why that entry is read and written whole.

I measured all of this on testnet rather than reading it, and the part that surprised me is
that nothing is wound by use. Invoking the contract extends nothing. Writing to an entry
extends nothing. The clocks run down from the moment each entry was created, and only an
explicit extension moves them.

### Extending the right entry

Nearly every Soroban example reaches for this:

```rust
env.storage().instance().extend_ttl(threshold, extend_to);
```

It reads as "extend my instance storage", it is documented under instance storage, and it also
extends the contract code entry. The code is roughly a hundred times the size of the instance
and rent scales with size:

| extending by one hour | stroops | against the facilitator's 50,000 ceiling |
|---|---|---|
| contract instance | 15,273 | inside it |
| contract code | 155,916 | 3.1x over |

A payment that quietly tries to extend the code is a payment that gets refused for costing too
much, and the error says nothing about TTL or rent. The narrow call is the one I use:

```rust
env.deployer().extend_ttl_for_contract_instance(
    env.current_contract_address(), TTL_THRESHOLD, TTL_TARGET,
);
env.storage()
    .persistent()
    .extend_ttl(&DataKey::Window, TTL_THRESHOLD, TTL_TARGET);
```

Two entries, two calls, and the code left alone.

### Seven days, not thirty

```rust
const TTL_TARGET: u32 = 120_960;              // testnet's minPersistentTTL, 7 days
const TTL_THRESHOLD: u32 = TTL_TARGET - 720;  // roughly one hour of drain
```

Both entries go back to seven days, which is what a new entry is born with. Thirty was
tempting, but rent is charged on the ledgers added, so the first payment past the threshold
would pay for twenty-three extra days at once, several times over the fee ceiling. And if the
agent is high-frequency the number barely matters, while if it is low-frequency there is no
reason to buy it a month.

The threshold is what makes this nearly free. `extend_ttl` writes nothing when the entry is
already above it, so only the first payment after each hour of drain does any work, and it
buys back that hour for around 2,600 stroops.

### What lapsing costs

Measured on testnet:

| restoring | stroops | against the 50,000 ceiling |
|---|---|---|
| contract instance | 57,133 | 1.14x over |
| contract code | 4,274,783 | 85.5x over |
| both | 4,320,225 | 86.4x over |

In absolute terms these are small. 4,274,783 stroops is about 0.43 XLM. The problem is that
both are more than a facilitator will pay for a single transaction, so a lapsed allowance
cannot revive itself while being used. The restore has to go out as its own transaction first.

A contract cannot submit a transaction. That is why the agent needs XLM of its own, and it is
the only thing it needs XLM for. Spending is paid for by the facilitator.

The code entry is a separate problem and not the owner's. It is shared by every contract
deployed from that hash, it costs about 51 XLM a year at 14,682 bytes, and no payment can
carry it. Keeping it alive is an operational job for whoever publishes the contract. Restoring
and extending are permissionless, so that can be done centrally for every allowance at once.
