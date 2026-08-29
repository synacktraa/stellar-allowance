# Stellar Allowance

On-chain spending limits for AI agents that pay for API calls.

An agent that pays for things needs a wallet, and a wallet has no limits. When a request fails,
every HTTP library retries, and each retry is a real payment. Stellar Allowance puts the money in a
contract the agent cannot spend from. The agent has to ask for each purchase.

The owner sets three rules: most per purchase, most per rolling window, and which addresses may be
paid. The agent holds no funds and has no USDC trustline, so it cannot hold the asset at all. A
purchase that breaks a rule reverts, so no money moves. The rules are enforced by the network, not
by the agent's code.

The same deployment also lets an API owner charge per call. Point it at an API you already run, set
a price, and you get a URL that answers `402 Payment Required`, takes payment, and forwards the
request. Nothing about your API changes.

## Run it yourself

About fifteen minutes, no credit card. Everything is Stellar **testnet**.

You need Node 22+ and a free [Supabase](https://supabase.com) account. **You do not need Rust** —
the contracts are already compiled and uploaded to testnet, and every allowance and splitter is a
cheap instance created from the published hashes in `.env.example`.

**1. Install**

```bash
git clone https://github.com/synacktraa/stellar-allowance && cd stellar-allowance && npm run install:web
```

**2. Create a Supabase project** (free tier, no card) and copy three values into `web/.env.local`,
which you make by copying `web/.env.example`:

| Variable | Where it is in the dashboard |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → Data API → `service_role` key |
| `SUPABASE_DB_URL` | Project Settings → Database → Connection string (URI) |

**3. Create the accounts and the tables**

```bash
npm run setup && npm run migrate
```

`setup` creates four testnet accounts, funds them from friendbot, adds USDC trustlines where they
belong, and writes them all into `web/.env.local`. It is safe to re-run.

**4. Get testnet USDC.** Friendbot issues XLM but not USDC, so send some to the two addresses
`setup` printed, from [faucet.circle.com](https://faucet.circle.com) → Stellar Testnet. Five USDC
each is plenty.

**5. Start it, then seed the demo**

```bash
npm run dev
```

```bash
npm run seed-demo   # in a second terminal, then restart `npm run dev`
```

`seed-demo` registers the demo API, deploys the demo allowance, funds both agents, and writes the
two ids back to `.env.local`. The restart matters: the landing page reads those at build time.

To buy from an API using an agent you created in the UI, put its secret in `USER_AGENT_SECRET` and
its paid URL in `MY_API`, then:

```bash
npm run mine 7
```

It buys until a rule stops it, and prints which rule that was.

## Deploying

Any Next.js host works. On Vercel, set the root directory to `web` and copy every variable from
`web/.env.local` except `SUPABASE_DB_URL`, `OWNER_SECRET`, `USER_AGENT_SECRET` and `MY_API`, which
are only used by local scripts.

`DEMO_API_ID`, `ALLOWANCE_CONTRACT_ID` and `DEMO_AGENT_ADDRESS` are read at **build** time, so they
must exist before the first build or the landing page ships without its demo.

## The two contracts

**Allowance** — holds the owner's funds and enforces the three rules. One per agent owner. It is
created with a constructor rather than an `init` call, so the owner is named in the same
transaction that deploys it: there is no moment where it exists unowned, and the owner never needs
XLM to claim it. The platform deploys it and pays the fee. It cannot spend from it, change its
rules, or take it back.

**Splitter** — one per registered API. The gateway's 402 names the splitter as recipient, so
payment lands in a contract instead of a platform account. The developer's share and the platform
fee are fixed at creation and cannot be changed afterwards. `flush()` is permissionless: anyone can
trigger a payout, and it can only reach the two addresses set at creation. The developer does not
have to wait for the platform, or trust it to forward anything.

`docs/CONTRACT.md` covers the design decisions, the authorization model, the deploy sequence, and
what is deliberately not built yet.

## Verified on chain

Limits: six calls of 0.1 USDC against a 0.5 USDC window cap. Five paid, the sixth refused, and the
recipient received exactly 0.5 USDC.

Split: two calls of 0.1 USDC paid into a splitter, then flushed. The developer received 0.18 and
the platform 0.02, leaving the splitter holding nothing. The flush was triggered by the agent
rather than by the platform.

Timing: 4.6–9.0s per purchase, mean 6.9s. Quote 0.4–1.2s, pay 2.8–6.8s waiting for a ledger to
close, deliver 1.4–2.0s.

An API can opt out of that wait. With `optimistic` set, the agent sends the signed transaction
rather than a hash, and the gateway simulates it, submits it, and delivers on the network's
acceptance — about four seconds faster, at the cost of one free call on the rare transaction that
reverts after a clean simulation. Off by default, because it is the developer's money at risk.

The landing page replays one such run rather than performing a new one per visitor — a single
demo agent and a single allowance cannot serve two people at once, and every visit spent money
that only returned if a flush followed. `npm run record-demo` produces the recording, and every
receipt on the page is a transaction hash you can look up.

## Tests

```bash
npm run contracts:test    # 18 tests, no network, seconds
npm test                  # the gateway, against testnet — needs `npm run dev` running
```

The gateway tests are integration tests with nothing stubbed: real HTTP, the real database, real
payments. A run costs a few cents of testnet USDC. `testing.md` covers what each suite is for and
what it needs.

## Working on the contracts

Only needed if you change them. Rust 1.84+ with the `wasm32v1-none` target and `stellar-cli` 27.

```bash
npm run contracts:build
```

The contract tests use `register_stellar_asset_contract_v2` for a local USDC stand-in, so nothing
touches the network and no funding is needed. After rebuilding, upload the wasm and replace
`ALLOWANCE_WASM_HASH` / `SPLITTER_WASM_HASH` in `.env.local`.

## Layout

```
contracts/contracts/allowance/   spending rules, one per agent owner
contracts/contracts/splitter/    fee split, one per registered API
web/src/app/                     landing page, developer tab, agent-owner tab, gateway
web/src/app/api/pay/[apiId]/     the 402, payment verification, and the proxy
web/src/app/api/apis/resolve/    a paid URL to the address that would be paid
web/src/app/api/demo/qr/         the API sold in the demo, computed here rather than fetched
web/src/lib/verify.ts            reads payments back off the chain
web/scripts/                     setup, migrations, demo seeding, recording, a buying agent
web/src/lib/demo-run.json        the recorded run the landing page replays
web/tests/                       gateway tests, against a live server and testnet
supabase/migrations/             database schema
docs/CONTRACT.md                 design decisions and the deploy sequence
```

## Licence

[Apache 2.0](LICENSE).

Unaudited, and built for testnet. Do not put mainnet funds behind it.
