# How the rolling window works

**Status:** current. Draft for the unwritten `architecture.md`.

Written for someone reading the contract for the first time.

## What it has to do

The owner sets a rule like *"no more than 100 USDC per day."* The contract has to answer
one question on every payment: **how much has been spent in the last day?**

## Why not just a counter

Count spending and reset the counter at midnight, and you get this:

```
23:59  spend 100   →  at the cap
00:00  reset       →  counter back to 0
00:01  spend 100   →  at the cap
```

Two hundred in two minutes, and the rule was never broken as written. That is a **tumbling
window** - the agent didn't cheat, the boundary did.

A **rolling window** has no boundary to stand either side of. It asks "how much in the last
24 hours, measured from right now", so at 00:01 the previous night's 100 is still inside the
look-back.

## Why not a list of payments

The obvious way to roll is to keep every payment - `{ amount, ledger }` - and drop the ones
that have aged out. It is exact, and it grows forever. At 72 bytes each, an agent paying
once a minute carries 1,440 records a day; at 200 records the entry is larger than the
contract's own code, and its upkeep alone exceeds the fee ceiling the payment has to fit
inside. A busy agent's own bookkeeping prices it out of paying.

## Jars in a ring

So the contract does not remember payments. It remembers **totals per slice of time**.

Cut the window into slices - one per hour on a daily window - and keep one jar per slice.
Spending goes into whichever jar the current hour uses. The window total is the sum of the
jars. As time moves on, jars are reused, and a jar is emptied before it is written to again.

The whole example below uses **4 slices** and a **40-ledger** window, so every jar fits on
screen. Each slice is 10 ledgers. The cap is 100.

### Which jar is now

```rust
let slice = env.ledger().sequence() / width;   // 55 / 10 = 5
let here  = slice % SLOTS as u32;              // 5 % 5 = 0
```

Two steps, and they do different jobs:

- **`/ width`** - which 10-ledger block are we in? Ledger 55 is in block 5. Block numbers
  count up forever and never repeat.
- **`% SLOTS`** - which jar does block 5 use? With five jars, block 5 comes back round to
  jar 0. Jar numbers cycle.

### A walk through

| ledger | block | jar | what happens | jars afterwards | total |
|---|---|---|---|---|---|
| 5 | 0 | 0 | spend 30 → ok | `[30, 0, 0, 0, 0]` | 30 |
| 15 | 1 | 1 | wipe jar 1, spend 30 → ok | `[30, 30, 0, 0, 0]` | 60 |
| 25 | 2 | 2 | wipe jar 2, spend 30 → ok | `[30, 30, 30, 0, 0]` | 90 |
| 35 | 3 | 3 | wipe jar 3, spend 30 → **refused**, 120 > 100 | *unchanged* | 90 |
| 55 | 5 | 0 | wipe jars 3, 4, **0**, spend 30 → ok | `[30, 30, 30, 0, 0]` | 90 |
| 65 | 6 | 1 | wipe jar **1**, spend → 40 of headroom | `[30, 0, 30, 0, 0]` | 60 |

Two rows are worth reading slowly.

**Ledger 55.** Block 4 was skipped entirely, so three jars need wiping - 3, 4 and 0. Jar 0
still held the 30 from ledger 5. Emptying it *is* how that spending ages out. Nothing
subtracted it and nothing checked its date; the hand came round and the jar was emptied
before reuse.

**Ledger 65.** Jar 1 held the 30 from ledger 15, now 50 ledgers old and outside the window.
Wiped. The total drops to 60 - and checking by hand: at ledger 65 the window covers ledger
25 onwards, which is the payment at 25 and the payment at 55. Sixty. The jars agree.

**Note that the jar being wiped is always the jar being written to.** That is not luck: jar 1
served block 1 and now serves block 6, and they are exactly `SLOTS` blocks apart, which is
exactly how long a jar's contents stay relevant. So the contract never searches for expired
payments, never compares dates and never sorts. It walks forward to the jar it needs and
finds that emptying it *is* the expiry. That is why the cost never grows - there is nothing
to scan.

### Wiping, in code

```rust
if slice > window.head {                                     // did the block change?
    let stale = (slice - window.head).min(SLOTS as u32);     // how many jars went by
    for n in 1..=stale {
        window.slots.set((window.head + n) % SLOTS as u32, 0);
    }
    window.head = slice;
}
```

`head` is the block last written to. `slice - head` is how many blocks have gone by, which
is how many jars need emptying. `.min(SLOTS)` covers a long absence: if 900 blocks passed,
emptying all the jars once is the same as emptying them 900 times.

A refused payment writes nothing - the `set` is never reached and the transaction reverts -
so `head` stays where it was.

## Why one more jar than there are slices

`SLOTS = SLICES + 1`, and the reason is that the block you are standing in has barely
started.

At ledger 55 the five jars hold blocks 1-5, which is ledgers **10 to 59**. The oldest thing
remembered is 45 ledgers old, comfortably older than the 40-ledger window.

With only four jars we would hold blocks 2-5 = ledgers **20 to 59**. The oldest thing
remembered would be 35 ledgers old, and the payment at ledger 15 would have vanished while
still inside a 40-ledger window.

```
four jars:   ledger 20 |--------------| 55     35 ledgers - too short
five jars:   ledger 10 |------------------| 55  45 ledgers - long enough
window:                        40 ledgers
```

Getting this wrong is not cosmetic. A window that is one slice short lets an agent spend
about **4% over the cap**. The extra jar costs ~22 bytes and moves the error to the other
side, so the window is never shorter than the owner asked for - the agent is refused
slightly early rather than slightly late.

That is the trade the design makes everywhere it can: **when rounding, round toward
refusing.**

## What it costs

25 numbers and a marker: **548 bytes**, whether the agent pays once or a million times.
A per-payment list passes that size at seven payments and never stops growing.
