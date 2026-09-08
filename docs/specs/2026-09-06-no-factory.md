# No factory

**Status:** current.

**Supersedes** `2026-09-06-factory-design.md`, which describes a contract that was built,
tested and then argued out of existence on the same day.

The branch is deleted and its tip is tagged `factory-experiment`.

## What settled it

The interface should let an owner choose which allowance version to create, defaulting to the
newest. A factory pins exactly one wasm hash and has no setter, so those two cannot both exist:

- One factory, one version, and an owner cannot deliberately stay on an older allowance.
- One factory per version, and an owner's allowances derive from different factory addresses,
  so finding them means knowing which factory made which. That is the scattering the index in
  the salt exists to avoid, arriving from another direction.
- A factory that takes the wasm hash as an argument pins nothing and guarantees nothing.

## What the factory turned out not to buy

Every property it was justified by works without it, because the deployer becomes the owner
rather than a contract.

| | with a factory | interface creates directly |
|---|---|---|
| address derivation | `hash(network, factory, salt)` | `hash(network, owner, salt)` |
| what the client needs | factory address, owner, index | owner, index |
| enumeration | probe indices | identical |
| squat-proofing | `create` demands owner auth | creating from an address demands that address's auth |
| rent | ~0.4 plus ~14 XLM a year | none |
| admin key | a question to answer | not a question |

The security argument does not survive either. When the deployer is the owner, only the owner
can create at their own derived addresses, so a hostile contract sitting at one would have been
put there by the owner. There is no third party to distrust.

What a factory would genuinely have offered is a **stable reference**: one address an owner
checks once, instead of a wasm hash that changes every release. That is real but thin, and it
only ever helps someone who reads what they are signing, who could read a hash instead.

## What replaces it

Nothing on chain. The interface builds the create itself, exactly as the current product
already does in `web/src/lib/deploy.ts`, with two changes: the salt becomes
`sha256(owner ‖ index)` rather than random, and the deployed version is shown to the owner
before they sign, with a link to its release.

Verification stays where it already was, and it is stronger than address provenance because it
reaches source rather than another contract:

```bash
stellar contract info build --wasm allowance.wasm
```

That resolves through the `source_repo` meta to the GitHub attestation, and prints the commit
and the workflow file that produced those exact bytes.

## Findings that outlive the factory

These were established while building it and belong to the interface now.

**One request answers three questions.** Compute addresses locally for a window of indices,
then send them as one `getLedgerEntries`. Measured on testnet, 2026-09-06:

```
 15 keys -> ok, 442ms   (cold)
 50 keys -> ok, 269ms
100 keys -> ok, 278ms
200 keys -> ok, 300ms
201 keys -> ERROR: key count (201) exceeds maximum supported (200)
```

Latency is flat in batch size, so one wide request beats several narrow ones and pagination is
a rendering concern rather than a fetching one.

**Three states come back distinguishable.**

| in the response | means | index |
|---|---|---|
| absent | never deployed | free |
| present, `liveUntilLedgerSeq` in the future | live | taken |
| present, `liveUntilLedgerSeq` 0 or past | archived, restorable | taken |

Presence is occupancy, so an archived allowance cannot be handed out as a free index. The next
free index is the first absent one. Enumeration scans the whole window rather than stopping at
the first gap.

**The version comes back in the same response.** Each instance entry carries its executable's
wasm hash, so no second call is needed to know which allowance version an address runs. Turning
that hash into a version number is better done by reading the `version` meta off the code entry
than by shipping a table in the interface, because a table goes stale on a release and the meta
never does.

**Contract type fields are encoded by name and sorted.** `stellar contract info interface` on
two binaries declaring `Rules` in different orders prints the same alphabetical listing, and
reordering a declaration changes no behavior. Names and types have to match across any two
declarations of the same type. Order does not.
