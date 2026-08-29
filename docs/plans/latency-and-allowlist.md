# Latency and the allowlist

Three pull requests, in order. Each ships and is tested before the next one starts.

None of them changes a contract. No new wasm, no new hashes, and every allowance already
deployed keeps working — `set_rules` already accepts everything these need.

## Where the time goes

Measured over a real run: **4.6–9.0s per purchase, mean 6.9s.**

| Step | Time | Whose |
|---|---|---|
| Quote (402) | 0.4–1.2s | ours |
| Pay | 2.8–6.8s | Stellar's ledger close |
| Deliver | 1.4–2.0s | ours |

Only the middle figure is fixed by the protocol. Stellar closes a ledger every ~5s and no code
changes that. But *waiting* for it is a choice, and PR C is about not waiting.

---

## PR A — honour the quoted price

The gateway verifies a payment against the API's **current** price:

```ts
verifyPayment(txHash, { minAmountStroops: BigInt(api.price_stroops) })
```

The challenge row already recorded the price it quoted:

```ts
await supabase.from('challenges').insert({ amount_stroops: api.price_stroops, ... })
```

**The failure:** a seller raises the price between the quote and the payment. The buyer pays the
old price, the gateway compares against the new one, delivery is refused — and the money is
already in the seller's splitter. Paid, nothing received, nothing to reclaim.

**The change:** compare against `challenge.amount_stroops`. Add the column to the challenge
select. A quote then holds until `expires_at`, which is what a quote is for.

Smallest item here, and a correctness fix independent of everything else — which is why it goes
first.

**Test:** register an API at 0.01, take a quote, raise the price to 0.02, pay 0.01, ask for
delivery. Expect 200. Today that is a 402 and a lost payment.

---

## PR B — the allowlist stops being a menu

### Why the current picker is wrong

Step 03 lists every registered API with checkboxes. Registration is open and free, so an attacker
can register an API, receive a splitter that pays them 90%, and appear in that list looking exactly
like everyone else. **Presenting it as a menu implies a vetting we do not perform.**

Nothing except the owner's intent separates "an API I meant to use" from "an API someone
registered to rob me". No contract rule recovers that, and a curated list only moves the trust to
us. So intent has to be captured — the question is only how to stop it feeling like configuration.

### The change

Step 03 asks **"Which API will this agent be calling?"** and takes the paid URL — the one the
developer gave them, from outside this app. The platform resolves URL → `api` row → splitter and
writes that address to the contract.

The trust decision then sits where it actually happened: with whoever handed over the URL. An
unknown URL is rejected loudly rather than quietly ignored.

### And the same input in step 05

`set_rules` replaces the whole `Rules` struct, allowlist included, and
`owner_can_change_the_rules` covers it. Step 05 edits only the three numbers, so an allowlist
cannot be changed after creation.

Worse: `update rules` sends whatever the picker last held and **reports success**. An owner who
believes they added an API is told it worked, and discovers otherwise through a `#6` refusal much
later. That bug is the reason this is grouped with the rewrite rather than deferred — it is the
same component, built once and used in both steps.

**Test:** resolve a known URL to the right splitter; reject an unknown one; create an allowance
from a URL and confirm on-chain that the allowlist holds the matching splitter; add a second URL
to a live allowance and confirm the contract's list grew.

---

## PR C — stop waiting for the ledger

### The insight

The rules run during **simulation**, not at apply time. By the time `prepareTransaction` returns,
the per-call cap, the window and the allowlist have all been checked. A refusal is already known.

So the agent can hand the gateway a *signed, simulated* transaction rather than a hash. The
gateway re-simulates it, confirms recipient, amount and reference, **delivers**, then submits and
monitors in the background.

This is card authorization: the shop hands over the coffee at auth, not at settlement.

**Measured, once built.** The estimate above — "about a tenth of a second" — was wrong:

| | |
|---|---|
| Gateway re-simulation | **482ms** |
| Submission to `PENDING` | ~300ms |
| Ledger wait removed | ~5000ms |

The delivery call grows by roughly 0.8s and loses a 5s wait: **about four seconds saved per
purchase, not 5.5.** Neither step is optional. The agent's own simulation is a claim by the
sender, and `PENDING` is the only thing proving the signature, sequence number and fee are
good — none of which simulation looks at.

### What it costs, precisely

A transaction that simulates cleanly can still revert when applied, because simulation reads state
*now* and the ledger applies it ~5s later. Two purchases in flight from one agent can both see the
same headroom and only one can have it; an owner can revoke inside the gap.

A revert after delivery means **the developer served one call for free.** So:

- **Opt-in per API.** It is the developer's money at risk, so it is the developer's switch. Never
  a global default.
- **Revert tracking.** An agent whose transactions bounce drops back to confirm-first until it
  settles clean again.
- Exposure is bounded to one call's price, and is always detectable.

Sequential agents never hit this. It is a concurrency hazard, not a common case.

### Then the quote round trip (item 4)

The 402 is not only a price — it issues a single-use, expiring `reference`, which is why a cached
quote is useless and the round trip is currently mandatory.

Letting the client generate its own reference (a UUID), with the gateway creating the challenge
row on the paid request instead of before it, removes it. Worth doing here and not alone: it is a
protocol change, and it only pays off once PR C has already removed the larger wait.

**Test:** deliver against a signed-but-unsettled transaction and confirm the body arrives before
the ledger closes; confirm the transaction is submitted and lands; force a revert with two
concurrent spends over one window cap and confirm the agent is demoted to confirm-first.

---

## Deliberately not doing: payment channels

Deposit once into a per-seller escrow, then each call is an off-chain signed voucher carrying a
cumulative total. Settle periodically. Latency becomes an HTTP round trip — sub-second.

**Skipped, not rejected.** Between settlements the rate limiting is enforced off-chain, which
turns the guarantee from *"every purchase obeys the rules"* into *"at most X can leave this
channel"*. That is still true and still useful, but it is a smaller claim than the one this
project makes, and no user is asking for sub-second yet.

Revisit when someone is.
