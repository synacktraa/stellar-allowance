# Stellar Allowance

An AI agent that pays for things needs a wallet, and a wallet has no limits. This puts the money in
a contract the agent cannot spend from directly, and makes it ask for each purchase.

The owner sets three rules — most per purchase, most per rolling window, and which addresses may be
paid — and deposits against them. The agent holds no funds. A request that breaks a rule reverts,
so no money moves; the agent's own code has no say in it.

## Status

The contract is live on Stellar testnet at
`CDVPL2TCXOGP7NHDD3XYAOKXFKFKAF6RZHBCOU6ACU4UIXIZTSWLH5AH`.

Verified on-chain: six calls of 0.1 USDC against a 0.5 USDC window cap. Five paid, the sixth
refused, and the recipient received exactly 0.5 USDC. The agent's account holds no USDC trustline
and cannot hold the asset at all.

## Layout

```
contracts/contracts/allowance/   the contract and its tests
docs/CONTRACT.md                 design decisions, auth model, deploy sequence
```

## Build and test

```bash
cd contracts
cargo test                # 9 tests, no network required
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
