# Testing

Two suites, and they are very different animals.

| | Contracts | Recording | Gateway |
|---|---|---|---|
| Where | `contracts/contracts/*/src/test.rs` | `web/tests/recording.test.mjs` | `web/tests/*.test.mjs` |
| Runner | `cargo test` | `node --test` | `node --test` |
| Needs | nothing | nothing | a dev server, the database, testnet USDC |
| Time | seconds | instant | under a minute |

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

**One file at a time.** The runner is pinned to `--test-concurrency=1`, and it has to be. Every test
file registers an API, which deploys a splitter from the platform account, and every payment is
signed by the wallet agent — so two files running at once put two transactions on one Stellar
account and they collide on its sequence number. The symptom is not a clean failure but a
`hookFailed: deploy timed out` and a suite reported as *cancelled*. Chain tests that share a
signing key are serial whether you plan for it or not.

If the server is not answering, the suite fails rather than skipping. A skipped suite and a green
suite look identical to anyone reading a summary.

## The recording

`web/tests/recording.test.mjs` checks `src/lib/demo-run.json`, the run the landing page replays.
No network, no chain, no server — it runs anywhere, and it runs as part of `npm test`.

The page stopped performing a live run because a single demo agent and a single allowance cannot
serve two visitors at once: their transactions collide on one account's sequence number, and they
spend from shared balances. Replaying a recording fixes that, but only honestly if the recording
stays a real run — a plausible number typed by hand would look exactly like a measured one.

So these tests check the properties a real run cannot violate: both columns start with the same
balance, every delivery carries a 64-character transaction hash, every refusal states a reason and
carries no payment, and the closing balance equals the start minus the price times the deliveries.
That last one is the load-bearing check; editing any figure by hand breaks the arithmetic.

Re-record with `npm run record-demo`, which needs `DEMO_RECORDER_SECRET` set and about 1.4 USDC,
most of which flushes back.

## A note on the demo allowance

`tests/optimistic.test.mjs` spends from the demo allowance, because the allowance path is the only
one that can carry a reference on chain and that is the allowance whose owner key is available.

Its window cap is **0.50 USDC per 15 minutes**, so a handful of runs in quick succession exhaust
it and the delivery test fails with `Error(Contract, #7)` — over the window cap. That is the
contract behaving correctly; the test is simply queued behind it.

`seed-demo` creates allowances with a ~2 minute window for exactly this reason. The deployed demo
allowance predates that and still has 15. Shortening it would make the suite runnable
back-to-back; until then, wait for the window rather than reading `#7` as a failure.

The four refusal tests do not spend anything and do not need window budget — they send envelopes
that were never simulated, because the gateway refuses them before it would simulate.

## Not covered

No tests over the React components, and no browser automation. The interactive parts have been
verified by hand.

`npm run lint` currently reports four errors in `web/src/app/developer/page.tsx`,
`web/src/app/user/page.tsx`, and `web/src/components/DemoRunner.tsx`. They are React hook rules,
they predate the test suite, and none of them is a runtime fault.

## CI

There is none yet. The contract tests would run anywhere; the gateway tests need Supabase
credentials and a funded testnet account, so they need secrets before they can run on a push.
