# Stellar Allowance

An AI agent that pays for things needs a wallet, and a wallet has no limits. This puts the money in
a contract the agent cannot spend from directly, and makes it ask for each purchase.

The owner sets three rules — most per purchase, most per rolling window, and which addresses may be
paid — and deposits against them. The agent holds no funds. A request that breaks a rule reverts,
so no money moves; the agent's own code has no say in it.

## Two contracts

**Allowance** — holds the owner's funds and enforces the three rules. One per agent owner.

**Splitter** — one per registered API. The gateway's 402 names the splitter as recipient, so
payment lands in a contract rather than a platform account. The developer's share and the platform
fee are fixed when it is created and `init` cannot be called twice, so the developer does not have
to trust anyone to forward their money. `flush()` is permissionless: the funds can only reach the
two addresses set at creation, so the developer can collect without waiting on the platform.

## Status

Both are live on Stellar testnet.

| | |
|---|---|
| Allowance | `CBOI5QMTUQK5AREMRIIKSUQ4P7XUPG7NKXTJDB3OFOXB6PVOMFC6JXYZ` |
| Splitter | `CCM5PU7RVHWKUZJWNJ4UC2T23EYJB4JXENZC5V2AEKSSPNUY42HLLS7B` |

Verified on-chain, in two runs.

Limits: six calls of 0.1 USDC against a 0.5 USDC window cap. Five paid, the sixth refused, and the
recipient received exactly 0.5 USDC. The agent's account holds no USDC trustline and cannot hold
the asset at all.

Split: two calls of 0.1 USDC paid into a splitter, then flushed. The developer received 0.18 and
the platform 0.02, and the splitter was left holding nothing. The flush was triggered by the agent,
not the platform, which is what permissionless means in practice.

## Layout

```
contracts/contracts/allowance/   spending rules, one per agent owner
contracts/contracts/splitter/    fee split, one per registered API
docs/CONTRACT.md                 design decisions, auth model, deploy sequence
```

## Build and test

```bash
cd contracts
cargo test                # 18 tests across both contracts, no network required
stellar contract build    # → target/wasm32v1-none/release/stellar_allowance.wasm
```

Tests use `register_stellar_asset_contract_v2` for a local USDC stand-in, so nothing touches the
network and no funding is needed.

## Deploy

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/stellar_allowance.wasm \
  --source-account owner --network testnet --alias allowance

stellar contract invoke --id <C...> --source-account owner --network testnet -- \
  init --owner <G...> --token <USDC_SAC> --agent <G...> --rules-file-path rules.json
```

`rules.json` must be written without a byte-order mark. See `docs/CONTRACT.md` for the full
sequence and the traps worth knowing before you hit them.

## Requirements

Rust 1.84+ with the `wasm32v1-none` target, and `stellar-cli` 27. The contract pins soroban-sdk 25,
which builds and deploys against a Protocol 27 host.
