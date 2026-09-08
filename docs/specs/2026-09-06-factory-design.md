# Factory design

**Status:** superseded by [`2026-09-06-no-factory.md`](2026-09-06-no-factory.md) on the day it
was approved. The factory was built through Task 12 of the plan and deleted before Task 13.
The address derivation defined here survived into the SDK as `deriveAllowanceAddress`.

## Why there is a factory at all

The v2 interface runs no server and keeps no database. That leaves one question with nowhere
to look up the answer: given an owner, which allowances do they have?

A deployed contract's address is `hash(networkId, deployer, salt)`. If the deployer is a
constant and the salt is derived from the owner, the address stops being a record to store and
becomes a value to compute. The factory exists to be that constant deployer.

Everything else the factory could do, it does not do. It keeps no registry, emits no events of
its own, holds no admin key and has no upgrade path.

## Prerequisite: allowance 0.2.0

Two changes to the allowance land before the factory, because the factory pins a wasm hash and
changing that hash afterwards costs a new factory and a new SDK release. Nothing is deployed to
testnet yet, so today they cost a re-tag.

**A name.** The interface has to show an owner something other than a contract ID. The database
this design removes was holding exactly two things, an index and a name, and only the index is
replaced by derivation. `localStorage` is not an answer because it is per device, and an owner
who opens the interface on a second device would see their allowances unnamed.

The name is a `String` in instance storage, capped at 32 characters, set at creation and
editable through `write`. Instance storage is read whole on every call including every payment,
so the cap is what keeps a label off the hot path. At the rate measured for the window entry,
0.0035 XLM per byte per year, a 32 character name costs about 0.17 XLM a year. A 256 character
description would cost about 1.0 and be read on every payment, which is why there is no
description field.

**Shorter field names.** `Setup.owner_address` becomes `owner` and `Spending.token_address`
becomes `token`, with `Config` following. The types already say `Address`, and the names are
carried in the contract spec and in every constructor argument.

## The address

The salt is the owner and an index, hashed together:

```rust
let salt: BytesN<32> = env
    .crypto()
    .sha256(&(setup.owner_address.clone(), index).to_xdr(&env))
    .into();
```

Two properties follow, and both are the reason for this shape rather than a simpler one.

**The owner cannot be forged.** The factory derives the salt from `setup.owner_address` and
then requires a signature from that same address. An attacker cannot land on somebody else's
address because they cannot authorize it, and any address they can create derives from their
own owner address. Without the owner in the salt, an address derived from an agent key alone
could be occupied by whoever learned that key first.

**The index makes the set enumerable.** With sequential indices, an owner's allowances are
found by computing addresses and asking the ledger which of them exist. That is what replaces
the database.

The factory requires auth on the address it derived the salt from rather than leaving that to
the allowance constructor, which demands one of its own. The two are not interchangeable: one
is about the salt, the other about what the contract stores. Creating below has the auth tree.

## Surface

```rust
__constructor(env: Env, allowance_wasm: BytesN<32>)
create(env: Env, setup: Setup, index: u32) -> Address
address_for(env: Env, owner: Address, index: u32) -> Address
allowance_wasm(env: Env) -> BytesN<32>
```

`create` deploys and runs the allowance constructor in the same invocation, so the owner signs
once for the deploy, the rules and the opening deposit together.

`address_for` computes without deploying. The interface will derive addresses locally, since
that is arithmetic and needs no network. This exists for clients that would rather call than
reimplement the contract ID preimage.

`allowance_wasm` is a getter with no setter anywhere in the contract.

## Creating

The owner's wallet invokes `factory.create`. Inside:

1. Require auth from `setup.owner_address`.
2. Derive the salt from that address and the index.
3. `env.deployer().with_current_contract(salt).deploy_v2(wasm_hash, (setup,))`.

The allowance constructor runs inside step 3 and moves the opening deposit, so the owner's
single signature covers the whole invocation tree.

Both the factory and the allowance constructor require auth from the owner, and neither
removes the other. Soroban authorizes per invocation frame, so the signed tree carries a node
for each:

```
factory.create                 [owner auth]
└── allowance.__constructor    [owner auth]
    └── token.transfer         [owner auth]   only when there is an opening deposit
```

One wallet prompt covers the tree, so the owner still signs once. The two calls guarantee
different things. The factory's proves the owner authorized the address the salt was derived
from. The allowance's proves the owner authorized the address stored as its owner. Those
coincide only while the two `Setup` declarations agree.

`deploy_v2` fails if the address is taken. The interface picks a free index before submitting,
so this is not the normal path. When it does happen, the interface increments and retries
rather than re-reading the ledger first, because a collision is rare and already detected.

## Finding

Addresses are computed locally for indices `0..PROBE_WINDOW`, then looked up in one
`getLedgerEntries` request. Measured on testnet, 2026-09-06:

```
 15 keys -> ok, 442ms   (cold)
 50 keys -> ok, 269ms
100 keys -> ok, 278ms
200 keys -> ok, 300ms
201 keys -> ERROR: key count (201) exceeds maximum supported (200)
```

Latency is flat in batch size. The round trip dominates, and absent keys cost nothing to look
up, so one wide request beats several narrow ones. `PROBE_WINDOW` is 60: four pages of fifteen,
well inside the limit, and one edit to raise. A second window is fetched only if all 60 come
back present.

Three states are distinguishable in that one response, measured against real testnet contracts:

| in the response | means | index |
|---|---|---|
| absent | never deployed | free |
| present, `liveUntilLedgerSeq` in the future | live | taken |
| present, `liveUntilLedgerSeq` 0 or past | archived, restorable | taken |

Presence is occupancy. An archived allowance does not read as a free index, so it cannot be
handed out twice.

Two rules come from this and they are not the same rule:

- **The next free index** is the first absent one.
- **Enumeration** scans the whole window and does not stop at the first gap, in case an index
  was ever assigned by something other than the interface.

Each returned entry carries the executable's wasm hash, so the version of every allowance and
whether it needs restoring are known from the same request. Since every derived address can
only have been created by the factory, anything present at one is an allowance.

## What it stores

One value, the allowance wasm hash, written by the constructor. Nothing per owner and nothing
per allowance. The factory's rent is therefore flat: one instance entry and one code entry
regardless of how many allowances exist. A stub carrying this exact surface builds to 2,902
bytes, which puts code rent near 10 XLM per year rather than the 46 that
`docs/rent-and-revival.md` estimated from a 13 KB placeholder, plus about 0.4 for the
instance.

## Immutability

The factory has no admin key and no upgrade path. Nobody runs infrastructure for this project,
so there is nobody to hold a key, and a key that could repoint the wasm hash would decide what
code every future allowance runs.

The cost is that a new allowance version means a new factory and a new SDK release. Addresses
derive from the factory, so allowances created by an earlier factory keep deriving from the
earlier address. That is accepted for a proof of concept.

## Types

`create` takes the allowance's `Setup` struct, and the factory defines it locally rather than
importing the allowance crate. That is not a preference. Importing it does not build:

```
warning: Linking globals named '__constructor': symbol multiply defined!
error: failed to load bitcode of module "allowance.allowance.<hash>-cgu.0.rcgu.o"
```

`#[contractimpl]` exports `__constructor` as a wasm symbol and both crates have one. Importing
the allowance crate for its types drags its exported contract functions into the factory's
binary, and the link collides. Avoiding that would mean feature-gating `#[contractimpl]` in the
allowance crate, or moving the shared types into a third crate. Both change the allowance
source, which changes its wasm hash, which voids the attestation on the released 0.1.0.

So `Setup`, `Spending` and `Rules` are declared again in the factory. The XDR encoding is
structural, so identical field names in identical order encode identically. The cost is that
the two declarations can drift, which is the reason the factory requires auth on the address it
derived the salt from rather than trusting the constructor to check the same one.

## Tests

One red-green cycle each, in this order:

1. A created allowance lands at the address `address_for` predicted.
2. The constructor ran: `get_config` on the new allowance returns what was passed to `create`.
3. Creating twice at the same index fails.
4. Creating at index 1 for the same owner succeeds and gives a different address.
5. `create` with another owner's address fails without that owner's signature.
6. `allowance_wasm` returns what the constructor was given.

Cycle 5 is the one that matters. It is the test for the property the salt exists to provide.

## Not included

No events, no registry, no per-owner counter, no fee sponsorship, no admin, no upgrade. The
factory learns nothing when an allowance is created and forgets nothing, because it never knew.
