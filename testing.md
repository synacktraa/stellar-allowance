# Testing

Two suites, and they are very different animals.

| | Contracts | Gateway |
|---|---|---|
| Where | `contracts/contracts/*/src/test.rs` | `web/tests/` |
| Runner | `cargo test` | `node --test` |
| Needs | nothing | a dev server, the database, testnet USDC |
| Time | seconds | about half a minute |

## Contracts

```bash
npm run contracts:test
```

18 tests, no network. A local USDC stand-in comes from
`register_stellar_asset_contract_v2`, so nothing is funded and nothing is deployed. These are the
tests that cover the rules themselves — the per-call cap, the window, the allowlist, revocation,
and who is allowed to change what.

Rust 1.84+ with the `wasm32v1-none` target.

## Gateway

```bash
npm run dev     # in another terminal
npm test
```

These are integration tests in the strict sense: a real HTTP server, the real database, and real
transactions on Stellar testnet. Nothing is stubbed.

That is deliberate rather than lazy. The gateway's decisions are made from three sources at
once — a request header, a database row, and the events of a transaction — and the interesting
bugs live in the disagreements between them. A stub of any one of those is a stub of the bug.

**What a run costs.** Each run registers a throwaway API, which deploys a real splitter contract,
and makes a couple of real payments — a few cents of testnet USDC, from the account in
`WALLET_AGENT_SECRET`. The API is archived afterwards; archived APIs are invisible to both the
gateway and the UI, and are left in place so a failed run stays inspectable. Top up from
<https://faucet.circle.com>.

**Environment.** Read from `web/.env.local`, the same file `npm run dev` uses, so a working dev
setup needs nothing extra. `TEST_ORIGIN` overrides the default `http://localhost:3000` if you want
to point the suite at a deployment.

If the server is not answering, the suite fails rather than skipping. A skipped suite and a green
suite look identical to anyone reading a summary.

## Not covered

No tests over the React components, and no browser automation. The interactive parts have been
verified by hand.

`npm run lint` currently reports four errors in `web/src/app/developer/page.tsx`,
`web/src/app/user/page.tsx`, and `web/src/components/DemoRunner.tsx`. They are React hook rules,
they predate the test suite, and none of them is a runtime fault.

## CI

There is none yet. The contract tests would run anywhere; the gateway tests need Supabase
credentials and a funded testnet account, so they need secrets before they can run on a push.
